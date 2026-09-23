import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { assertSafeTarget, durableAtomicCreate, formatJson, sha256 } from "./files.mjs";
import { withProjectMutationLock } from "./project.mjs";
import { readTaskContractInput, readTaskFile } from "./task-contract.mjs";
import { TEMPLATE_VERSION } from "./constants.mjs";

export const WORKKEEL_PACKAGE = "@zsz1210/workkeel";
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

export async function previewLegacyMigration(target, policy) {
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
  const directory = await safeDirectory(target, ".ai-org/work-items");
  for (const [ref, field, terminal] of [
    [".ai-org/project/runtime-workers.json", "workers", ["completed", "failed", "cancelled"]],
    [".ai-org/project/tasks.json", "tasks", ["completed", "archived"]]
  ]) if (await existsEntry(target, ref)) {
    const registry = (await readTaskContractInput(target, ref)).document;
    if (!Array.isArray(registry[field]) || registry[field].some(entry => !terminal.includes(entry.status))) throw new Error("Migration requires all legacy runtimes to be stopped and reconciled");
  }
  const manifest = [];
  for (const entry of (await fs.readdir(directory)).sort()) {
    if (!entry.endsWith(".json")) throw new Error("Unexpected entry in legacy Work Item store");
    const ref = `.ai-org/work-items/${entry}`;
    const { document: item, digest } = await readTaskContractInput(target, ref);
    if (item.schema_version !== "temple.work-item/v1" || !["done", "concluded", "cancelled"].includes(item.state) ||
        item.claim?.status === "active" || item.workflow_profile === "high-assurance") throw new Error("Migration requires terminal legacy work without active claims or High-Assurance history");
    manifest.push({ path: ref, sha256: digest });
  }
  // Bind all legacy policy and event bytes, not just the new policy selection.
  const visit = async (directory) => {
    for (const entry of (await fs.readdir(path.join(target, directory), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("Legacy policy contains a symlink");
      if (entry.isDirectory()) await visit(relative);
      else { const file = await readTaskFile(target, relative); manifest.push({ path: relative, sha256: file.digest }); }
    }
  };
  for (const directory of [".ai-org/project", ".ai-org/core", ".ai-org/events"]) await visit(directory);
  manifest.push({ path: "temple.lock", sha256: (await readTaskFile(target, "temple.lock")).digest });
  return { schema_version: "workkeel.migration-preview/v1", authority: "observation-only", mutation_status: "no-write",
    fingerprint: sha256(formatJson({ policy, manifest })), legacy_manifest: manifest,
    limitations: ["Existing records are retained, not converted into grants.", "Only quiescent Solo legacy projects are supported."] };
}

export async function initializeTaskProject(targetInput, policy, { migrationFingerprint = null } = {}) {
  const target = await fs.realpath(await assertSafeTarget(targetInput));
  await assertGitRoot(target);
  assertPolicy(policy);
  return withProjectMutationLock(target, async () => {
    for (const ref of ["workkeel.lock", "workkeelw.mjs", "WORKKEEL.md"]) if (await existsEntry(target, ref)) throw new Error("Initialization never overwrites an existing Workkeel file");
    const legacy = await existsEntry(target, "temple.lock");
    let manifest = null;
    if (legacy) {
      if (!migrationFingerprint) throw new Error("Legacy projects require migration preview and its explicit fingerprint");
      const preview = await previewLegacyMigration(target, policy);
      if (preview.fingerprint !== migrationFingerprint) throw new Error("Stale migration preview");
      manifest = preview.legacy_manifest;
    } else if (migrationFingerprint || await existsEntry(target, ".ai-org")) throw new Error("Existing unrecognized .ai-org state must be resolved before initialization");
    const project = { schema_version: TASK_PROJECT_SCHEMA, cli: { package_name: WORKKEEL_PACKAGE, version: TEMPLATE_VERSION }, policy, legacy_manifest: manifest };
    const launcher = `import { spawnSync } from "node:child_process";\nimport fs from "node:fs";\nimport path from "node:path";\nimport { fileURLToPath } from "node:url";\nconst root=path.dirname(fileURLToPath(import.meta.url));\nconst pin=JSON.parse(fs.readFileSync(path.join(root,"workkeel.lock"),"utf8")).cli;\nif(pin.package_name!==${JSON.stringify(WORKKEEL_PACKAGE)}||pin.version!==${JSON.stringify(TEMPLATE_VERSION)}) throw Error("Workkeel pin mismatch");\nconst override=process.env.WORKKEEL_CLI_PATH;\nif(override){const check=spawnSync(process.execPath,[override,"version"],{encoding:"utf8"});if(check.status!==0||check.stdout.trim()!==pin.version)throw Error("Workkeel override version mismatch");}\nconst run=override?spawnSync(process.execPath,[override,...process.argv.slice(2)],{stdio:"inherit"}):spawnSync("npm",["exec","--yes","--package",pin.package_name+"@"+pin.version,"--","workkeel",...process.argv.slice(2)],{stdio:"inherit"});\nprocess.exitCode=run.status??1;\n`;
    const instructions = "# Workkeel task-first project\n\nRead native repository instructions and the approved task contract. Use the pinned `node ./workkeelw.mjs`; do not hand-edit canonical task records. `status` and `doctor` are read-only. Claim before implementation, record exact candidate/evidence, obtain a distinct Agent review, then close through an authorized Principal. Never treat metadata validation as execution permission or a sandbox. Actual tool, filesystem, network and data controls belong to the host coding agent. External publication and model spending require separate authorization. Legacy records are historical, not new grants.\n";
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
    return { schema_version: TASK_PROJECT_SCHEMA, initialized: true, mode: "task-first", migrated_legacy_records: manifest?.filter(e => e.path.startsWith(".ai-org/work-items/")).length ?? 0,
      execution_authorized: false, boundary_enforcement: "host-responsibility" };
  });
}
