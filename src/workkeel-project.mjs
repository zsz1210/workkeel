import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { assertSafeTarget, durableAtomicCreate, formatJson, sha256 } from "./files.mjs";
import { withProjectMutationLock } from "./project.mjs";
import { readTaskContractInput, readTaskFile } from "./task-contract.mjs";
import { PACKAGE_NAME, TEMPLATE_VERSION } from "./constants.mjs";

export const WORKKEEL_PACKAGE = PACKAGE_NAME;
export const TASK_PROJECT_SCHEMA = "workkeel.project/v1";
const exec = promisify(execFile);
async function assertGitRoot(target) {
  let root;
  try { root = (await exec("git", ["-C", target, "rev-parse", "--show-toplevel"])).stdout.trim(); }
  catch { throw new Error("Task-first coordination requires an initialized Git repository"); }
  if (await fs.realpath(root) !== await fs.realpath(target)) throw new Error("Task-first project must be the Git repository root");
}
export const identifier = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$" };
const ids = { type: "array", items: identifier, minItems: 1, uniqueItems: true };
export const policySchema = {
  type: "object", additionalProperties: false,
  required: ["schema_version", "principals", "agents", "approvers", "review_separation"],
  properties: {
    schema_version: { const: "workkeel.task-policy/v1" }, principals: ids, approvers: ids,
    agents: { type: "array", minItems: 1, items: {
      type: "object", additionalProperties: false, required: ["agent_id", "principal_id"],
      properties: { agent_id: identifier, principal_id: identifier }
    } },
    review_separation: { enum: ["distinct-agent", "distinct-principal"] }
  }
};
const validate = new Ajv({ strict: true, allErrors: true }).compile(policySchema);
export function assertPolicy(policy) {
  if (!validate(policy)) throw new Error("Invalid task policy; use explicit Principals, Agents, approvers and review separation");
  if (new Set(policy.agents.map(a => a.agent_id)).size !== policy.agents.length ||
      policy.agents.some(a => !policy.principals.includes(a.principal_id)) ||
      policy.approvers.some(id => !policy.principals.includes(id))) throw new Error("Policy identities must be unique and reference registered Principals");
}
export function assertActor(policy, actor) {
  if (!actor || Object.keys(actor).sort().join(",") !== "agent_id,principal_id" ||
      !policy.agents.some(a => a.agent_id === actor.agent_id && a.principal_id === actor.principal_id)) throw new Error("Actor must match a registered Agent and Principal; attribution is not authentication");
}
export function assertApprover(policy, actor) {
  assertActor(policy, actor);
  if (!policy.approvers.includes(actor.principal_id)) throw new Error("Operation requires an explicitly registered approving Principal");
}
export async function existsEntry(target, relative) {
  try { await fs.lstat(path.join(target, relative)); return true; }
  catch (e) { if (e.code === "ENOENT") return false; throw e; }
}
export async function safeDirectory(target, relative, { create = false } = {}) {
  let current = await fs.realpath(target);
  if (relative === ".") return current;
  if (!/^[A-Za-z0-9._/-]+$/.test(relative) || relative.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Unsafe internal directory");
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (create) await fs.mkdir(current).catch(e => { if (e.code !== "EEXIST") throw e; });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Project directories must not contain symlinks or non-directories");
  }
  return current;
}
export async function readTaskProject(target) {
  await assertGitRoot(target);
  const input = await readTaskContractInput(target, "workkeel.lock");
  const p = input.document;
  if (!p || Object.keys(p).sort().join(",") !== "cli,legacy_manifest,policy,schema_version" || p.schema_version !== TASK_PROJECT_SCHEMA ||
      p.cli?.package_name !== WORKKEEL_PACKAGE || p.cli.version !== TEMPLATE_VERSION) throw new Error("Task-first project pin is unsupported; use the recorded Workkeel version");
  assertPolicy(p.policy);
  if (p.legacy_manifest !== null && (!Array.isArray(p.legacy_manifest) || p.legacy_manifest.some(x =>
    typeof x.path !== "string" || !/^[a-f0-9]{64}$/.test(x.sha256)))) throw new Error("Invalid legacy history manifest");
  return { ...p, digest: input.digest };
}

// Historical append-only journals are hashed in bounded chunks; they are never
// interpreted as authority JSON or passed through the 1 MiB contract reader.
export async function readLegacyDigest(target, ref) {
  if (ref !== ".ai-org/events/events.jsonl") return (await readTaskFile(target, ref)).bytes_digest;
  const directory = await safeDirectory(target, ".ai-org/events"), name = path.join(directory, "events.jsonl");
  const file = await fs.open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat(), limit = 8 * 1024 * 1024;
    if (!before.isFile() || before.size > limit) throw Error("Legacy journal exceeds its 8 MiB archive bound");
    const hash = createHash("sha256"), decoder = new TextDecoder("utf-8", { fatal: true }), chunk = Buffer.alloc(64 * 1024);
    let size = 0;
    while (true) {
      const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, limit + 1 - size), null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) throw Error("Legacy journal exceeds its 8 MiB archive bound");
      const bytes = chunk.subarray(0, bytesRead);
      decoder.decode(bytes, { stream: true });
      hash.update(bytes);
    }
    decoder.decode();
    const after = await file.stat(), entry = await fs.lstat(name);
    if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || before.dev !== entry.dev || before.ino !== entry.ino ||
        entry.isSymbolicLink() || await fs.realpath(name) !== name) throw Error("Legacy journal changed during read");
    return hash.digest("hex");
  } finally { await file.close(); }
}

async function readLegacyJson(target, ref) {
  const { content, bytes_digest } = await readTaskFile(target, ref);
  let document;
  try { document = JSON.parse(content); } catch { throw Error("Contract input is not valid JSON"); }
  return { document, digest: bytes_digest };
}

export async function previewLegacyMigration(target, policy, { retentionRef = null } = {}) {
  await assertGitRoot(target);
  assertPolicy(policy);
  if (await existsEntry(target, "workkeel.lock")) throw new Error("Project is already in task-first mode");
  const collaboration = (await readTaskContractInput(target, ".ai-org/project/collaboration.json")).document;
  if (collaboration.schema_version !== "temple.collaboration/v2" || collaboration.profile !== "solo" ||
      collaboration.actor_policy?.ordinary_development !== "attributed" ||
      (collaboration.authority_grants?.length ?? 0) || (collaboration.sponsorships?.length ?? 0) ||
      (collaboration.principals?.length ?? 0) || collaboration.bootstrap_owner ||
      collaboration.recovery?.status && collaboration.recovery.status !== "not_configured") throw new Error("Team, verified-identity and configured governance migrations are not supported; retain legacy mode");
  for (const name of ["policies.json", "workflow.json", "collaboration-profiles.json", "high-assurance.json"]) {
    const ref = `.ai-org/core/${name}`;
    const current = (await readTaskContractInput(target, ref)).document;
    const shipped = JSON.parse(await fs.readFile(fileURLToPath(new URL(`../project-overlay/${ref}`, import.meta.url)), "utf8"));
    if (JSON.stringify(current) !== JSON.stringify(shipped)) throw new Error("Customized or older core policy requires a reviewed migration; retain legacy mode");
  }
  const retained = new Map(), extraPins = [];
  if (retentionRef !== null) {
    const { document: retention, digest } = await readLegacyJson(target, retentionRef);
    if (Object.keys(retention).sort().join(",") !== "approval_ref,approved_by,open_work_items,schema_version" ||
        retention.schema_version !== "workkeel.legacy-retention/v1" ||
        !policy.approvers.includes(retention.approved_by) || !Array.isArray(retention.open_work_items) ||
        !retention.open_work_items.length || retention.open_work_items.length > 1000) throw Error("Invalid explicit legacy retention request");
    const approval = await readTaskFile(target, retention.approval_ref);
    if (!approval.content.trim()) throw Error("Legacy retention requires recorded approval");
    extraPins.push({ path: retentionRef, sha256: digest }, { path: retention.approval_ref, sha256: approval.bytes_digest });
    for (const item of retention.open_work_items) {
      if (!item || Object.keys(item).sort().join(",") !== "id,sha256" || !/^WI-[A-Za-z0-9-]+$/.test(item.id) ||
          !/^[a-f0-9]{64}$/.test(item.sha256) || retained.has(item.id)) throw Error("Invalid or duplicate retained Work Item");
      retained.set(item.id, item.sha256);
    }
  }
  const directory = await safeDirectory(target, ".ai-org/work-items"), retainedOpen = [];
  for (const [ref, field, terminal] of [
    [".ai-org/project/runtime-workers.json", "workers", ["completed", "failed", "cancelled"]],
    [".ai-org/project/tasks.json", "tasks", ["completed", "archived"]]
  ]) if (await existsEntry(target, ref)) {
    const registry = (await readTaskContractInput(target, ref)).document;
    if (!Array.isArray(registry[field]) || registry[field].some(entry => !terminal.includes(entry.status))) throw new Error("Migration requires all legacy runtimes to be stopped and reconciled");
  }
  const manifest = [];
  for (const entry of (await fs.readdir(directory)).sort()) {
    // Legacy init installs this explanatory file beside records. Preserve and
    // pin it as history, never parse it as a task or ignore arbitrary entries.
    if (entry === "README.md") {
      const ref = `.ai-org/work-items/${entry}`;
      manifest.push({ path: ref, sha256: await readLegacyDigest(target, ref) });
      continue;
    }
    if (!entry.endsWith(".json")) throw new Error("Unexpected entry in legacy Work Item store");
    const ref = `.ai-org/work-items/${entry}`;
    const { document: item, digest } = await readLegacyJson(target, ref);
    const terminal = ["done", "concluded", "cancelled"].includes(item.state);
    if (item.schema_version !== "temple.work-item/v1" || item.id !== entry.slice(0, -5) ||
        item.claim?.status === "active" || item.workflow_profile === "high-assurance") throw new Error("Migration requires terminal legacy work or explicitly retained inactive work, without active claims or High-Assurance history");
    if (!terminal) {
      if (!["intake", "spec", "design", "build", "test", "eval", "independent_qa", "release_gate", "blocked"].includes(item.state) ||
          retained.get(item.id) !== digest) throw Error("Migration requires terminal work or an exact approved retention entry");
      retainedOpen.push({ id: item.id, state: item.state, disposition: "unfinished-read-only-history" });
      retained.delete(item.id);
    }
    manifest.push({ path: ref, sha256: digest });
  }
  if (retained.size) throw Error("Retention entries must name exactly the unfinished legacy Work Items");
  // Bind all legacy policy and event bytes, not just the new policy selection.
  const visit = async (directory) => {
    for (const entry of (await fs.readdir(path.join(target, directory), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("Legacy policy contains a symlink");
      if (entry.isDirectory()) await visit(relative);
      else manifest.push({ path: relative, sha256: await readLegacyDigest(target, relative) });
    }
  };
  for (const directory of [".ai-org/project", ".ai-org/core", ".ai-org/events"]) await visit(directory);
  manifest.push({ path: "temple.lock", sha256: await readLegacyDigest(target, "temple.lock") });
  for (const pin of extraPins) if (!manifest.some(p => p.path === pin.path)) manifest.push(pin);
  return { schema_version: "workkeel.migration-preview/v1", authority: "observation-only", mutation_status: "no-write",
    fingerprint: sha256(formatJson({ policy, manifest })), legacy_manifest: manifest,
    retained_open_items: retainedOpen,
    limitations: ["Existing records are retained, not converted into grants or acceptance.", "Only quiescent Solo legacy projects are supported.", "Explicitly retained unfinished items require separately approved native successor tasks."] };
}

export async function initializeTaskProject(targetInput, policy, { migrationFingerprint = null, retentionRef = null } = {}) {
  const target = await fs.realpath(await assertSafeTarget(targetInput));
  await assertGitRoot(target);
  assertPolicy(policy);
  return withProjectMutationLock(target, async () => {
    for (const ref of ["workkeel.lock", "workkeelw.mjs", "WORKKEEL.md"]) if (await existsEntry(target, ref)) throw new Error("Initialization never overwrites an existing Workkeel file");
    const legacy = await existsEntry(target, "temple.lock");
    let manifest = null;
    if (legacy) {
      if (!migrationFingerprint) throw new Error("Legacy projects require migration preview and its explicit fingerprint");
      const preview = await previewLegacyMigration(target, policy, { retentionRef });
      if (preview.fingerprint !== migrationFingerprint) throw new Error("Stale migration preview");
      manifest = preview.legacy_manifest;
    } else if (migrationFingerprint || retentionRef || await existsEntry(target, ".ai-org")) throw new Error("Existing unrecognized .ai-org state must be resolved before initialization");
    const project = { schema_version: TASK_PROJECT_SCHEMA, cli: { package_name: WORKKEEL_PACKAGE, version: TEMPLATE_VERSION }, policy, legacy_manifest: manifest };
    const launcher = `import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const pin = JSON.parse(fs.readFileSync(path.join(root, "workkeel.lock"), "utf8")).cli;
if (pin.package_name !== ${JSON.stringify(WORKKEEL_PACKAGE)} || pin.version !== ${JSON.stringify(TEMPLATE_VERSION)}) throw Error("Workkeel pin mismatch");
const installed = path.join(root, "node_modules", "@zsz1210", "workkeel", "bin", "workkeel.mjs");
const source = process.env.WORKKEEL_CLI_PATH || (fs.existsSync(installed) ? installed : null);
if (source) {
  const check = spawnSync(process.execPath, [source, "version"], { cwd: root, encoding: "utf8" });
  if (check.status !== 0 || check.stdout.trim() !== pin.version) throw Error("Workkeel override version mismatch");
} else if (process.env.WORKKEEL_ALLOW_PACKAGE_FETCH !== "1") {
  throw Error("Pinned Workkeel CLI is not installed. Set WORKKEEL_CLI_PATH to the matching source bin/workkeel.mjs, or explicitly allow a published package fetch with WORKKEEL_ALLOW_PACKAGE_FETCH=1. No download was attempted.");
}
const run = source
  ? spawnSync(process.execPath, [source, ...process.argv.slice(2)], { cwd: root, stdio: "inherit" })
  : spawnSync("npm", ["exec", "--yes", "--package", pin.package_name + "@" + pin.version, "--", "workkeel", ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
process.exitCode = run.status ?? 1;
`;
    const instructions = `# Workkeel project instructions

Read native project instructions and the approved task contract. Use the pinned
\`node ./workkeelw.mjs\`; never hand-edit canonical task records.

Before acting, match the request to available Skill descriptions and any explicitly
named Skills. Read applicable instructions completely, including required references.
Load only task-relevant material, not the whole Skill catalog. A missing required
Skill or authority source must be reported; do not pretend it was applied.

\`status\` and \`doctor\` are read-only. The coordinator claims before dispatch and
owns task lifecycle commands. A dispatched executor performs only its assigned
work; it must not repeat claim, handoff, review or close commands. When acting
directly without a coordinator, claim before implementation. Stay inside the
approved working directory, paths, tools, network, data and spending boundaries.
The runtime host must actually enforce these conditions; metadata is not a sandbox.
Workflow progress, approval interrupts and model routing cannot enlarge authority.

Report changed files, actual checks and unresolved work to the coordinator. The
coordinator hands off the exact Git candidate and verification evidence. A
different registered Agent reviews the candidate before an
authorized Principal closes the task. Completion does not publish or deploy.

At handoff, identify the relevant Skills, what was applied, the resulting artifacts
and checks, and anything unverified. Reading claims or file hashes alone do not
prove Skill application or quality. Finish with the recommended next step.
`;
    const created = [];
    try {
      for (const [ref, content] of [["WORKKEEL.md", instructions], ["workkeelw.mjs", launcher], ["workkeel.lock", formatJson(project)]]) {
        await durableAtomicCreate(path.join(target, ref), content); created.push({ ref, digest: sha256(content) });
      }
    } catch (error) {
      // Remove only our unchanged newly-created files; preserve concurrent edits.
      for (const file of created.reverse()) if ((await readTaskFile(target, file.ref)).digest === file.digest) await fs.unlink(path.join(target, file.ref));
      throw error;
    }
    return { schema_version: TASK_PROJECT_SCHEMA, initialized: true, mode: "task-first", migrated_legacy_records: manifest?.filter(e => e.path.startsWith(".ai-org/work-items/") && e.path.endsWith(".json")).length ?? 0,
      execution_authorized: false, boundary_enforcement: "host-responsibility" };
  });
}
