import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Ajv from "ajv";
import { assertSafeTarget, durableAtomicCreate, formatJson, sha256 } from "./files.mjs";
import { withProjectMutationLock } from "./workkeel-lock.mjs";
import { readTaskContractInput, readTaskFile } from "./task-contract.mjs";
import { PACKAGE_NAME, TEMPLATE_VERSION } from "./workkeel-version.mjs";
import { RISK_TIERS, validRiskPattern } from "./workkeel-risk.mjs";

export const WORKKEEL_PACKAGE = PACKAGE_NAME;
export const TASK_PROJECT_SCHEMA = "workkeel.project/v2";
const exec = promisify(execFile);

/** Bounded native Git observation. Never inherit executable Git configuration
 * from the caller's environment or run repository hooks/content converters. */
export async function readNativeGit(target, args, { maxBuffer = 4 * 1024 * 1024, encoding = "utf8" } = {}) {
  if (!["rev-parse", "merge-base", "diff", "ls-files", "ls-tree"].includes(args[0]) &&
      !(args[0] === "cat-file" && args.length === 3 && args[1] === "blob")) throw Error("Unsupported native Git read");
  const env = {
    GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull, GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0", GIT_ATTR_NOSYSTEM: "1", LC_ALL: "C"
  };
  const executablePath = process.env.PATH ?? process.env.Path;
  if (executablePath) env.PATH = executablePath;
  if (process.platform === "win32" && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const config = ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${os.devNull}`,
    "-c", "credential.helper=", "-c", "core.askPass=", "-c", "protocol.allow=never",
    "-c", "protocol.file.allow=never", "-c", "gc.auto=0", "-c", "maintenance.auto=false"];
  const run = async (command, output = "utf8") => (await exec("git", ["--no-pager", ...config, "-C", target, ...command], {
    encoding: output, timeout: 10000, maxBuffer, env
  })).stdout;
  if (args[0] === "diff") {
    // Turning a clean filter off would compare different bytes and could hide
    // real drift. Refuse the observation instead, including included configs.
    const settings = (await run(["config", "--null", "--list"])).split("\0");
    if (settings.some(entry => /^filter\..*\.(?:clean|process)$/i.test(entry.split("\n", 1)[0])))
      throw Error("Native Git observation cannot safely inspect configured clean/process filters");
    // Worktree submodule inspection can invoke another repository's converters.
    if ((await run(["ls-files", "--stage", "-z"])).split("\0").some(entry => entry.startsWith("160000 ")))
      throw Error("Native Git observation cannot safely inspect submodule worktrees");
    args = ["diff", "--no-ext-diff", "--no-textconv", ...args.slice(1)];
  }
  return run(args, encoding);
}

async function assertGitRoot(target) {
  let root;
  try { root = (await readNativeGit(target, ["rev-parse", "--show-toplevel"])).trim(); }
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
      properties: { agent_id: identifier, principal_id: identifier, model_family: identifier }
    } },
    review_separation: { enum: ["distinct-agent", "distinct-principal"] },
    risk_paths: { type: "object", additionalProperties: false, properties: Object.fromEntries(RISK_TIERS.map(tier =>
      [tier, { type: "array", maxItems: 64, uniqueItems: true, items: { type: "string" } }])) },
    requirements_refs: {type: 'array', maxItems: 8, uniqueItems: true, items: {type: 'string', minLength: 1, maxLength: 1024}}
  }
};
const validate = new Ajv({ strict: true, allErrors: true }).compile(policySchema);
export function assertPolicy(policy) {
  if (!validate(policy)) throw new Error("Invalid task policy; use explicit Principals, Agents, approvers and review separation");
  if (Object.values(policy.risk_paths ?? {}).flat().some(pattern => !validRiskPattern(pattern))) throw Error("Invalid risk path pattern; use repository-relative globs without negation");
  if ((policy.requirements_refs ?? []).some(ref => ref.trim() !== ref || /[\\:\x00-\x1f\x7f*?\[\]{}]/.test(ref) || ref.startsWith('/') || ref.split('/').some(p => !p || p === '.' || p === '..'))) throw Error('Invalid required decision source path');
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
  if (!p || Object.keys(p).sort().join(",") !== "cli,policy,schema_version" || p.schema_version !== TASK_PROJECT_SCHEMA ||
      p.cli?.package_name !== WORKKEEL_PACKAGE || p.cli.version !== TEMPLATE_VERSION) throw new Error("Task-first project pin is unsupported; use the recorded Workkeel version");
  assertPolicy(p.policy);
  return { ...p, digest: input.digest };
}

export async function initializeTaskProject(targetInput, policy) {
  const target = await fs.realpath(await assertSafeTarget(targetInput));
  await assertGitRoot(target);
  assertPolicy(policy);
  return withProjectMutationLock(target, async () => {
    for (const ref of ["workkeel.lock", "workkeelw.mjs", "WORKKEEL.md"]) if (await existsEntry(target, ref)) throw new Error("Initialization never overwrites an existing Workkeel file");
    // Earlier task records are archived by their owners, never converted.
    if (await existsEntry(target, ".ai-org")) throw new Error("Existing .ai-org state must be archived or removed before initialization");
    const project = { schema_version: TASK_PROJECT_SCHEMA, cli: { package_name: WORKKEEL_PACKAGE, version: TEMPLATE_VERSION }, policy };
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

Before declaring completion, map every approved criterion and supporting design
requirement to exact candidate evidence. Retain missing, partial and failed results;
repair within approved scope and repeat affected checks. UI work needs repeated
inspection of executable states, information hierarchy and interactions, with
visual evidence. Passing tests do not establish semantic or visual completeness.
The pinned CLI's \`task evidence-check\` is a read-only coverage aid; it neither
judges usability nor replaces the distinct Agent's actual review and owner closure.

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
    return { schema_version: TASK_PROJECT_SCHEMA, initialized: true, mode: "task-first",
      execution_authorized: false, boundary_enforcement: "host-responsibility" };
  });
}
