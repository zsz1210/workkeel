import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { formatJson, pathExists, readJson, sha256File } from "./files.mjs";

export const ARCHIFY_CONTRACT = Object.freeze({
  tag: "v2.16.0",
  commit: "c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de",
  repository: "tt-a1i/archify",
  license: "MIT",
  downstream_patches: Object.freeze([
    Object.freeze({
      id: "fast-uri-3.1.7-security-override",
      kind: "npm-lock-override",
      package: "fast-uri",
      from: "3.1.5",
      to: "3.1.7",
      package_json: "archify/package.json",
      lockfile: "archify/package-lock.json",
      lock_entry_from: "node_modules/ajv/node_modules/fast-uri",
      lock_entry_to: "node_modules/fast-uri",
      expected_resolved: "https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.5.tgz",
      expected_integrity: "sha512-gHwA1O9LDIcKunMKhObS/HimwtehO1nPUECKAu5TpKgaO19fcWEl4bliWe1jWxVFvIXztJjjQ4L8XQ1EU9f7Jw==",
      resolved: "https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.7.tgz",
      integrity: "sha512-dOvZVzjdZdz7phd9v6jCbwxrBW3fK6n8Rc0CtdmM4bumzMnxywBYhuph6J819RRw/ku+rLbelwfMunktuzVVHg==",
      license: "BSD-3-Clause"
    })
  ])
});

const STATUS_SCHEMA = "temple.archify-adapter-status/v1";
const MANIFEST_SCHEMA = "temple.archify-adapter/v1";
const REQUIRED_FILES = ["LICENSE", "archify/SKILL.md", "archify/bin/archify.mjs", "archify/schemas/architecture.schema.json"];

function adapterRoot(target, contract) {
  return path.join(target, ".ai-org/adapters/archify", contract.tag);
}

function manifestPath(target, contract) {
  return path.join(adapterRoot(target, contract), "manifest.json");
}

function gitRevision(source) {
  const result = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Archify source must be a local Git checkout");
  return result.stdout.trim().toLowerCase();
}

function assertCleanSource(source) {
  const result = spawnSync(
    "git",
    ["-C", source, "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching", "--", "LICENSE", "archify"],
    { encoding: "utf8" }
  );
  if (result.status !== 0) throw new Error("Unable to verify the Archify source working tree");
  if (result.stdout.trim()) throw new Error("Archify source working tree is not clean within LICENSE and archify");
}

function safeInstalledPath(value, expectedPrefix) {
  if (typeof value !== "string" || !value.startsWith(expectedPrefix) || value.includes("\\")) return false;
  const suffix = value.slice(expectedPrefix.length);
  return suffix.length > 0 && path.posix.normalize(suffix) === suffix && suffix !== ".." && !suffix.startsWith("../");
}

async function collectRegularFiles(root, relative = "") {
  const output = [];
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const child = path.posix.join(relative.split(path.sep).join("/"), entry.name);
    const absolute = path.join(root, ...child.split("/"));
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Archify source contains a symbolic link: ${child}`);
    if (stat.isDirectory()) output.push(...await collectRegularFiles(root, child));
    else if (stat.isFile()) output.push(child);
    else throw new Error(`Archify source contains an unsupported file type: ${child}`);
  }
  return output;
}

function notInstalled() {
  return {
    schema_version: STATUS_SCHEMA,
    status: "not_installed",
    usable: false,
    reason: "optional adapter is not installed",
    external_action_performed: false
  };
}

function contractPatches(contract) {
  return contract.downstream_patches ?? [];
}

async function applyDownstreamPatches(staging, contract) {
  for (const patch of contractPatches(contract)) {
    if (patch.kind !== "npm-lock-override") throw new Error(`Unsupported Archify downstream patch kind: ${patch.kind}`);
    if (patch.package_json !== "archify/package.json" || patch.lockfile !== "archify/package-lock.json") {
      throw new Error(`Archify downstream patch ${patch.id} targets an unsupported file`);
    }

    const packagePath = path.join(staging, ...patch.package_json.split("/"));
    const packageDocument = await readJson(packagePath);
    if (packageDocument.overrides?.[patch.package] !== patch.from) {
      throw new Error(`Archify downstream patch ${patch.id} package override precondition failed`);
    }
    packageDocument.overrides[patch.package] = patch.to;
    await fs.writeFile(packagePath, formatJson(packageDocument));

    const lockPath = path.join(staging, ...patch.lockfile.split("/"));
    const lockDocument = await readJson(lockPath);
    const lockEntry = lockDocument.packages?.[patch.lock_entry_from];
    if (
      lockEntry?.version !== patch.from ||
      lockEntry?.license !== patch.license ||
      lockEntry?.resolved !== patch.expected_resolved ||
      lockEntry?.integrity !== patch.expected_integrity
    ) {
      throw new Error(`Archify downstream patch ${patch.id} lockfile precondition failed`);
    }
    if (patch.lock_entry_from !== patch.lock_entry_to && lockDocument.packages?.[patch.lock_entry_to] !== undefined) {
      throw new Error(`Archify downstream patch ${patch.id} lockfile destination already exists`);
    }
    lockEntry.version = patch.to;
    lockEntry.resolved = patch.resolved;
    lockEntry.integrity = patch.integrity;
    delete lockDocument.packages[patch.lock_entry_from];
    lockDocument.packages[patch.lock_entry_to] = lockEntry;
    lockDocument.packages = Object.fromEntries(
      Object.entries(lockDocument.packages).sort(([left], [right]) => left.localeCompare(right))
    );
    await fs.writeFile(lockPath, formatJson(lockDocument));
  }
}

export async function installArchifyAdapter(target, source, { contract = ARCHIFY_CONTRACT } = {}) {
  const sourceRoot = path.resolve(source);
  if (!(await pathExists(sourceRoot))) throw new Error(`Archify source does not exist: ${sourceRoot}`);
  const revision = gitRevision(sourceRoot);
  if (revision !== contract.commit) throw new Error(`Archify source revision ${revision} does not match pinned commit ${contract.commit}`);
  assertCleanSource(sourceRoot);
  for (const required of REQUIRED_FILES) {
    if (!(await pathExists(path.join(sourceRoot, required)))) throw new Error(`Archify source is missing required file: ${required}`);
  }
  const license = await fs.readFile(path.join(sourceRoot, "LICENSE"), "utf8");
  if (contract.license === "MIT" && !/MIT License/i.test(license)) throw new Error("Archify source LICENSE does not contain the expected MIT license text");

  const destination = adapterRoot(target, contract);
  if (await pathExists(destination)) {
    const existing = await inspectArchifyAdapter(target, { contract });
    if (existing.usable) return readJson(manifestPath(target, contract));
    throw new Error(`Existing Archify adapter is invalid: ${existing.reason}`);
  }

  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  const staging = path.join(parent, `.temple-staging-${process.pid}-${Date.now().toString(36)}`);
  try {
    await fs.mkdir(staging);
    await fs.copyFile(path.join(sourceRoot, "LICENSE"), path.join(staging, "LICENSE"));
    await fs.cp(path.join(sourceRoot, "archify"), path.join(staging, "archify"), { recursive: true, dereference: false, errorOnExist: true });
    await applyDownstreamPatches(staging, contract);
    const relativeFiles = await collectRegularFiles(staging);
    const files = await Promise.all(relativeFiles.map(async (relativePath) => ({
      path: `.ai-org/adapters/archify/${contract.tag}/${relativePath}`,
      sha256: await sha256File(path.join(staging, ...relativePath.split("/")))
    })));
    const installedAt = new Date().toISOString();
    const manifest = {
      schema_version: MANIFEST_SCHEMA,
      adapter: "archify",
      status: "installed",
      provenance: {
        repository: contract.repository,
        tag: contract.tag,
        commit: contract.commit,
        license: contract.license,
        source_kind: contractPatches(contract).length > 0
          ? "local-exact-git-checkout-with-reviewed-downstream-patches"
          : "local-exact-git-checkout",
        downstream_patches: contractPatches(contract)
      },
      installed_at: installedAt,
      files,
      isolation_root: `.ai-org/adapters/archify/${contract.tag}`,
      automatic_network_access: false,
      external_action_performed: false
    };
    await fs.writeFile(path.join(staging, "manifest.json"), formatJson(manifest));
    await fs.rename(staging, destination);
    return manifest;
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function inspectArchifyAdapter(target, { contract = ARCHIFY_CONTRACT } = {}) {
  const manifestFile = manifestPath(target, contract);
  if (!(await pathExists(manifestFile))) return notInstalled();
  let manifest;
  try {
    manifest = await readJson(manifestFile);
  } catch (error) {
    return { schema_version: STATUS_SCHEMA, status: "invalid", usable: false, reason: error.message, external_action_performed: false };
  }
  const invalid = (reason) => ({
    schema_version: STATUS_SCHEMA,
    status: "invalid",
    usable: false,
    reason,
    provenance: manifest.provenance ?? null,
    external_action_performed: false
  });
  if (manifest.schema_version !== MANIFEST_SCHEMA || manifest.adapter !== "archify" || !Array.isArray(manifest.files)) {
    return invalid("adapter manifest is invalid");
  }
  for (const key of ["repository", "tag", "commit", "license"]) {
    if (manifest.provenance?.[key] !== contract[key]) return invalid(`provenance ${key} does not match the pinned contract`);
  }
  if (JSON.stringify(manifest.provenance?.downstream_patches ?? []) !== JSON.stringify(contractPatches(contract))) {
    return invalid("provenance downstream patches do not match the pinned contract");
  }
  const expectedPrefix = `.ai-org/adapters/archify/${contract.tag}/`;
  if (new Set(manifest.files.map((file) => file.path)).size !== manifest.files.length) return invalid("manifest contains duplicate file entries");
  for (const file of manifest.files) {
    if (!safeInstalledPath(file.path, expectedPrefix) || !/^[0-9a-f]{64}$/.test(file.sha256 ?? "")) return invalid("manifest contains an unsafe file entry");
    const absolute = path.join(target, ...file.path.split("/"));
    if (!(await pathExists(absolute))) return invalid(`installed file is missing: ${file.path}`);
    if ((await sha256File(absolute)) !== file.sha256) return invalid(`digest mismatch: ${file.path}`);
  }
  for (const required of REQUIRED_FILES) {
    if (!manifest.files.some((entry) => entry.path.endsWith(`/${required}`))) return invalid(`required file is not recorded: ${required}`);
  }
  let actualFiles;
  try {
    actualFiles = (await collectRegularFiles(adapterRoot(target, contract))).filter((file) => file !== "manifest.json").sort();
  } catch (error) {
    return invalid(error.message);
  }
  const recordedFiles = manifest.files.map((file) => file.path.slice(expectedPrefix.length)).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(recordedFiles)) return invalid("adapter contains unrecorded or missing files");
  return {
    schema_version: STATUS_SCHEMA,
    status: "installed",
    usable: true,
    reason: "pinned isolated adapter passed provenance and digest checks",
    provenance: manifest.provenance,
    files: manifest.files,
    external_action_performed: false
  };
}
