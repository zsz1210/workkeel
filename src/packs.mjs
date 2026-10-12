import fs from "node:fs/promises";
import path from "node:path";
import { KNOWN_PACKAGE_NAMES, PACKS_ROOT, TEMPLATE_VERSION } from "./constants.mjs";
import {
  atomicCreate,
  atomicWrite,
  formatJson,
  pathExists,
  readJson,
  rollbackFileChanges,
  sha256,
  sha256File
} from "./files.mjs";

const PACK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function safePackPath(relativePath) {
  return (
    typeof relativePath === "string" &&
    relativePath.startsWith(".agents/skills/") &&
    !relativePath.includes("\\") &&
    path.posix.normalize(relativePath) === relativePath &&
    !relativePath.split("/").includes("..")
  );
}

function versionParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/.exec(String(value));
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  parts.push(match[4] === undefined ? 2 : match[4] === 'beta' ? 1 : 0, Number(match[5] ?? 0));
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function comparePackVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

function compatible(manifest) {
  const minimum = manifest.compatibility.temple.min;
  const maximum = manifest.compatibility.temple.max_exclusive;
  const againstMinimum = comparePackVersions(TEMPLATE_VERSION, minimum);
  const againstMaximum = comparePackVersions(TEMPLATE_VERSION, maximum);
  return againstMinimum !== null && againstMaximum !== null && againstMinimum >= 0 && againstMaximum < 0 &&
    Number(process.versions.node.split(".")[0]) >= manifest.compatibility.node.min_major;
}

function validateManifest(manifest, sourcePath) {
  const valid =
    manifest?.schema_version === "temple.pack/v2" &&
    PACK_ID_PATTERN.test(manifest.id ?? "") &&
    typeof manifest.version === "string" &&
    manifest.version.length > 0 &&
    typeof manifest.display_name === "string" &&
    typeof manifest.description === "string" &&
    manifest.enabled_by_default === false &&
    Array.isArray(manifest.skills) &&
    manifest.skills.length > 0 &&
    new Set(manifest.skills).size === manifest.skills.length &&
    manifest.skills.every((skill) => PACK_ID_PATTERN.test(skill)) &&
    Array.isArray(manifest.references) &&
    Array.isArray(manifest.scripts) &&
    Array.isArray(manifest.assets) &&
    [manifest.references, manifest.scripts, manifest.assets].every((values) => new Set(values).size === values.length) &&
    manifest.references.every((value) => safePackPath(value) && value.includes("/references/")) &&
    manifest.scripts.every((value) => safePackPath(value) && value.includes("/scripts/")) &&
    manifest.assets.every((value) => safePackPath(value) && value.includes("/assets/")) &&
    Array.isArray(manifest.files) &&
    new Set(manifest.files).size === manifest.files.length &&
    manifest.files.every(safePackPath) &&
    manifest.skills.every((skill) => manifest.files.includes(`.agents/skills/${skill}/SKILL.md`)) &&
    JSON.stringify([...new Set([
      ...manifest.skills.map((skill) => `.agents/skills/${skill}/SKILL.md`),
      ...manifest.references,
      ...manifest.scripts,
      ...manifest.assets
    ])].sort()) === JSON.stringify([...manifest.files].sort()) &&
    Array.isArray(manifest.dependencies?.packs) &&
    manifest.dependencies.packs.every((value) => PACK_ID_PATTERN.test(value)) &&
    Array.isArray(manifest.dependencies?.capabilities) &&
    manifest.dependencies.capabilities.every((value) => PACK_ID_PATTERN.test(value)) &&
    Array.isArray(manifest.dependencies?.executables) &&
    manifest.dependencies.executables.every((entry) =>
      typeof entry?.name === "string" && entry.name.length > 0 && typeof entry?.range === "string" && typeof entry?.required === "boolean"
    ) &&
    typeof manifest.provenance?.origin === "string" &&
    typeof manifest.provenance?.repository === "string" &&
    typeof manifest.provenance?.license === "string" &&
    typeof manifest.provenance?.source === "string" &&
    versionParts(manifest.compatibility?.temple?.min) !== null &&
    versionParts(manifest.compatibility?.temple?.max_exclusive) !== null &&
    Number.isInteger(manifest.compatibility?.node?.min_major);
  if (!valid) throw new Error(`Invalid optional pack manifest: ${sourcePath}`);
  if (!compatible(manifest)) {
    throw new Error(`Optional pack ${manifest.id} is incompatible with Temple ${TEMPLATE_VERSION} or Node ${process.versions.node}`);
  }
  return manifest;
}

export function packLockMetadata(manifest) {
  return {
    manifest_schema: manifest.schema_version,
    skills: manifest.skills,
    managed_files: manifest.files,
    references: manifest.references,
    scripts: manifest.scripts,
    assets: manifest.assets,
    dependencies: manifest.dependencies,
    provenance: manifest.provenance,
    compatibility: manifest.compatibility
  };
}

export async function readPackDefinition(packId) {
  if (!PACK_ID_PATTERN.test(packId ?? "")) throw new Error(`Invalid pack ID: ${packId ?? "missing"}`);
  const root = path.join(PACKS_ROOT, packId);
  const manifestPath = path.join(root, "manifest.json");
  if (!(await pathExists(manifestPath))) throw new Error(`Unknown optional pack: ${packId}`);
  const manifest = validateManifest(await readJson(manifestPath), manifestPath);
  if (manifest.id !== packId) throw new Error(`Pack directory and manifest ID differ: ${packId}`);
  const files = [];
  for (const relativePath of manifest.files) {
    const sourcePath = path.join(root, relativePath);
    if (!(await pathExists(sourcePath))) throw new Error(`Pack ${packId} is missing source file: ${relativePath}`);
    files.push({ relativePath, sourcePath });
  }
  return { manifest, root, files };
}

export async function listPackDefinitions() {
  if (!(await pathExists(PACKS_ROOT))) return [];
  const entries = await fs.readdir(PACKS_ROOT, { withFileTypes: true });
  const definitions = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    definitions.push(await readPackDefinition(entry.name));
  }
  return definitions;
}

async function readCurrentLock(target) {
  const lockPath = path.join(target, "temple.lock");
  if (!(await pathExists(lockPath))) throw new Error("temple.lock is missing; run temple init before managing packs");
  const lock = await readJson(lockPath);
  if (!KNOWN_PACKAGE_NAMES.has(lock.template?.name)) throw new Error("temple.lock belongs to an unknown template");
  if (lock.template?.version !== TEMPLATE_VERSION) {
    throw new Error(`Installed organization version is ${lock.template?.version ?? "unknown"}; run temple upgrade before managing packs`);
  }
  return { lock, lockPath };
}

function installedPack(lock, packId) {
  return (lock.optional_packs ?? []).find((entry) => entry.id === packId);
}

function managedFileMap(lock) {
  return new Map((lock.managed_files ?? []).map((entry) => [entry.path, entry.sha256]));
}

export async function listPackState(target) {
  const { lock } = await readCurrentLock(target);
  const installed = new Map((lock.optional_packs ?? []).map((entry) => [entry.id, entry]));
  return (await listPackDefinitions()).map(({ manifest }) => ({
    id: manifest.id,
    display_name: manifest.display_name,
    description: manifest.description,
    available_version: manifest.version,
    enabled_by_default: false,
    installed: installed.has(manifest.id),
    installed_version: installed.get(manifest.id)?.version ?? null,
    skills: manifest.skills,
    references: manifest.references,
    scripts: manifest.scripts,
    assets: manifest.assets,
    dependencies: manifest.dependencies,
    provenance: manifest.provenance,
    compatibility: manifest.compatibility
  }));
}

export async function planPackInstall(target, packId) {
  const [{ lock, lockPath }, definition] = await Promise.all([readCurrentLock(target), readPackDefinition(packId)]);
  const existing = installedPack(lock, packId);
  if (existing && existing.version !== definition.manifest.version) {
    throw new Error(`Pack ${packId} is ${existing.version}; run temple upgrade to reach ${definition.manifest.version}`);
  }

  const conflicts = [];
  const actions = [];
  const managed = managedFileMap(lock);
  for (const file of definition.files) {
    const destinationPath = path.join(target, file.relativePath);
    if (!(await pathExists(destinationPath))) {
      if (existing) conflicts.push(`installed pack file is missing: ${file.relativePath}`);
      else actions.push({ type: "copy-pack-file", path: file.relativePath });
      continue;
    }
    const [sourceHash, installedHash] = await Promise.all([sha256File(file.sourcePath), sha256File(destinationPath)]);
    if (existing) {
      const expectedHash = managed.get(file.relativePath);
      if (!expectedHash || installedHash !== expectedHash) conflicts.push(`installed pack file changed: ${file.relativePath}`);
      else if (sourceHash === installedHash) actions.push({ type: "skip-identical", path: file.relativePath });
      else conflicts.push(`pack source changed without an upgrade: ${file.relativePath}`);
    } else {
      conflicts.push(
        managed.has(file.relativePath)
          ? `managed file blocks optional pack: ${file.relativePath}`
          : `untracked file blocks optional pack: ${file.relativePath}`
      );
    }
  }
  actions.push({ type: existing ? "skip-installed-pack" : "update-lock", path: "temple.lock" });
  return { target, lock, lockPath, definition, existing, actions, conflicts };
}

export async function executePackInstall(plan) {
  if (plan.conflicts.length > 0) throw new Error(`Pack installation stopped before writing:\n- ${plan.conflicts.join("\n- ")}`);
  if (plan.existing) return plan.lock;

  const changes = [];
  try {
    for (const action of plan.actions.filter((entry) => entry.type === "copy-pack-file")) {
      const source = plan.definition.files.find((file) => file.relativePath === action.path).sourcePath;
      const destination = path.join(plan.target, action.path);
      const content = await fs.readFile(source);
      await atomicCreate(destination, content);
      changes.push({ path: destination, before: null, afterHash: sha256(content) });
    }

    const packPaths = new Set(plan.definition.manifest.files);
    const managedFiles = (plan.lock.managed_files ?? []).filter((entry) => !packPaths.has(entry.path));
    for (const relativePath of plan.definition.manifest.files) {
      managedFiles.push({ path: relativePath, sha256: await sha256File(path.join(plan.target, relativePath)) });
    }
    managedFiles.sort((left, right) => left.path.localeCompare(right.path));
    const timestamp = new Date().toISOString();
    const optionalPacks = [
      ...(plan.lock.optional_packs ?? []).filter((entry) => entry.id !== plan.definition.manifest.id),
      {
        id: plan.definition.manifest.id,
        version: plan.definition.manifest.version,
        installed_at: timestamp,
        ...packLockMetadata(plan.definition.manifest)
      }
    ].sort((left, right) => left.id.localeCompare(right.id));
    const lock = {
      ...plan.lock,
      capabilities: { ...(plan.lock.capabilities ?? {}), optional_packs: true },
      optional_packs: optionalPacks,
      managed_files: managedFiles
    };
    if (JSON.stringify(await readJson(plan.lockPath)) !== JSON.stringify(plan.lock)) {
      throw new Error("temple.lock changed after pack installation planning");
    }
    await atomicWrite(plan.lockPath, formatJson(lock));
    return lock;
  } catch (error) {
    try {
      await rollbackFileChanges(changes);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Pack installation failed and rollback was incomplete");
    }
    throw error;
  }
}

export async function planPackRemove(target, packId) {
  const { lock, lockPath } = await readCurrentLock(target);
  const existing = installedPack(lock, packId);
  if (!existing) throw new Error(`Optional pack is not installed: ${packId}`);
  const definition = await readPackDefinition(packId);
  const managed = managedFileMap(lock);
  const conflicts = [];
  const actions = [];
  if (JSON.stringify(existing.managed_files ?? []) !== JSON.stringify(definition.manifest.files)) {
    conflicts.push(`installed pack metadata differs from the known manifest: ${packId}`);
  }
  for (const relativePath of definition.manifest.files) {
    const destinationPath = path.join(target, relativePath);
    if (!(await pathExists(destinationPath))) conflicts.push(`installed pack file is missing: ${relativePath}`);
    else if (!managed.has(relativePath) || (await sha256File(destinationPath)) !== managed.get(relativePath)) {
      conflicts.push(`installed pack file changed: ${relativePath}`);
    } else actions.push({ type: "remove-pack-file", path: relativePath });
  }
  actions.push({ type: "update-lock", path: "temple.lock" });
  return { target, lock, lockPath, definition, existing, actions, conflicts };
}

export async function executePackRemove(plan) {
  if (plan.conflicts.length > 0) throw new Error(`Pack removal stopped before writing:\n- ${plan.conflicts.join("\n- ")}`);
  const removedPaths = new Set(plan.actions.filter((entry) => entry.type === "remove-pack-file").map((entry) => entry.path));
  const managed = managedFileMap(plan.lock);
  const changes = [];
  try {
    for (const relativePath of removedPaths) {
      const targetPath = path.join(plan.target, relativePath);
      const expectedHash = managed.get(relativePath);
      if (!expectedHash || (await sha256File(targetPath)) !== expectedHash) {
        throw new Error(`Installed pack file changed before removal: ${relativePath}`);
      }
      const before = await fs.readFile(targetPath);
      await fs.unlink(targetPath);
      changes.push({ path: targetPath, before, afterHash: null });
    }
    const optionalPacks = (plan.lock.optional_packs ?? []).filter((entry) => entry.id !== plan.existing.id);
    const lock = {
      ...plan.lock,
      capabilities: { ...(plan.lock.capabilities ?? {}), optional_packs: true },
      optional_packs: optionalPacks,
      managed_files: (plan.lock.managed_files ?? []).filter((entry) => !removedPaths.has(entry.path))
    };
    if (JSON.stringify(await readJson(plan.lockPath)) !== JSON.stringify(plan.lock)) {
      throw new Error("temple.lock changed after pack removal planning");
    }
    await atomicWrite(plan.lockPath, formatJson(lock));
    return lock;
  } catch (error) {
    try {
      await rollbackFileChanges(changes);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Pack removal failed and rollback was incomplete");
    }
    throw error;
  }
}

export function formatPackPlan(plan, verb) {
  const lines = [`Optional pack ${verb} plan for ${plan.target}`, `- pack: ${plan.definition.manifest.id}@${plan.definition.manifest.version}`];
  const counts = new Map();
  for (const action of plan.actions) counts.set(action.type, (counts.get(action.type) ?? 0) + 1);
  for (const [type, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) lines.push(`- ${type}: ${count}`);
  if (plan.conflicts.length > 0) lines.push("Conflicts:", ...plan.conflicts.map((conflict) => `- ${conflict}`));
  return lines.join("\n");
}

export async function packSourcesForLock(lock) {
  const definitions = [];
  const sources = new Map();
  const conflicts = [];
  const seen = new Set();
  for (const entry of lock.optional_packs ?? []) {
    if (seen.has(entry.id)) {
      conflicts.push(`duplicate optional pack in temple.lock: ${entry.id}`);
      continue;
    }
    seen.add(entry.id);
    try {
      const definition = await readPackDefinition(entry.id);
      definitions.push({ definition, installed: entry });
      for (const file of definition.files) {
        if (sources.has(file.relativePath)) conflicts.push(`optional packs overlap managed path: ${file.relativePath}`);
        else sources.set(file.relativePath, file.sourcePath);
      }
    } catch (error) {
      conflicts.push(error.message);
    }
  }
  return { definitions, sources, conflicts };
}
