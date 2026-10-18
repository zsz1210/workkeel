import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { readNativeGit, readLocalActor, readTaskProject } from "./workkeel-project.mjs";
import { readNativeTask, listTaskItems } from "./workkeel-tasks.mjs";
import { durableAtomicCreate } from "./files.mjs";

const GROUPS = ["task", "usage", "dispatch", "intake", "runtime", "instructions", "workflow", "headroom", "skills", "context",
  "learning", "workspace", "model-policy", "skill-lifecycle", "autonomy", "retention", "goal", "policy"];
const SINGLE = ["policy", "source", "request", "id", "fingerprint", "actor", "revision", "base", "claim", "summary",
  "judgment", "rollback", "mode", "expect", "goal", "risk", "principal", "attempt", "approval"];
const MULTIPLE = ["evidence", "acceptance", "write", "read", "include", "exclude", "unresolved"];
const BOOLEAN = ["json", "solo", "team"];

/** Parses `command [action] [target] --flags` with Node's own argument parser. */
export function parseCommandLine(args) {
  const options = Object.fromEntries([...SINGLE.map(name => [name, { type: "string" }]),
    ...MULTIPLE.map(name => [name, { type: "string", multiple: true }]), ...BOOLEAN.map(name => [name, { type: "boolean" }])]);
  let parsed;
  try { parsed = parseArgs({ args, options, allowPositionals: true, strict: true, tokens: true }); }
  catch (error) { throw new Error(`Unknown, repeated or incomplete Workkeel option: ${error.message}`); }
  const seen = new Set();
  for (const token of parsed.tokens) if (token.kind === "option" && SINGLE.includes(token.name)) {
    if (seen.has(token.name)) throw new Error(`Unknown, repeated or incomplete Workkeel option: --${token.name} is repeated`);
    seen.add(token.name);
  }
  const positionals = [...parsed.positionals], command = positionals.shift() ?? "help";
  const action = GROUPS.includes(command) ? positionals.shift() ?? null : null;
  const target = positionals.shift() ?? ".";
  if (positionals.length) throw new Error(`Unexpected argument: ${positionals[0]}`);
  // Keep the established `--name` keys so command handlers can allow-list them.
  const result = {};
  for (const [name, value] of Object.entries(parsed.values)) if (name !== "json") result[`--${name}`] = value;
  return { command, action, target: path.resolve(target), options: result };
}

/** Resolves `--actor agent-id`, or the checkout's local default, to a registered actor. */
export async function resolveActor(target, project, agentId) {
  const id = agentId ?? await readLocalActor(target);
  if (!id) throw new Error("Pass --actor <agent-id> or record a default agent_id in .workkeel/local.json");
  const agent = project.policy.agents.find(entry => entry.agent_id === id);
  if (!agent) throw new Error(`Agent ${id} is not registered in this project's policy`);
  return { agent_id: agent.agent_id, principal_id: agent.principal_id };
}

async function head(target) { return (await readNativeGit(target, ["rev-parse", "HEAD"])).trim(); }
const version = (options, item) => {
  if (options["--expect"] === undefined) return item?.version ?? 0;
  const value = Number(options["--expect"]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("--expect must be a task version");
  return value;
};
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Repeated flags that name a set are compared as sets; ordered ones (such as
// --acceptance criteria) keep their order, so reordering them is a new command.
const SET_LIKE = new Set(["--write", "--read", "--include", "--exclude", "--evidence", "--unresolved"]);
const commandKey = (action, id, options) => hash({ action, id, options: Object.entries(options)
  .map(([name, value]) => [name, SET_LIKE.has(name) && Array.isArray(value) ? [...value].sort() : value])
  .sort(([a], [b]) => a.localeCompare(b)) });

// The exact request a flag command sent is kept inside the Git directory: never
// committed, never product drift. A retry resubmits it, so the task replays it.
async function savedRequestPath(target, ...parts) {
  const gitDir = (await readNativeGit(target, ["rev-parse", "--absolute-git-dir"])).trim();
  return path.join(gitDir, "workkeel", "cli-operations", ...parts);
}
async function readSaved(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
// Saved requests are immutable, one numbered attempt per command key. Creation is
// exclusive: when identical commands race, the loser adopts the winner's request.
async function attempts(dir) {
  try { return (await fs.readdir(dir)).filter(name => /^\d+\.json$/.test(name)).map(name => Number(name.slice(0, -5))).sort((a, b) => a - b); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
async function latestAttempt(dir) {
  const numbers = await attempts(dir);
  return numbers.length ? { number: numbers.at(-1), value: await readSaved(path.join(dir, `${numbers.at(-1)}.json`)) } : null;
}
async function saveAttempt(dir, number, value) {
  await fs.mkdir(dir, { recursive: true });
  try { await durableAtomicCreate(path.join(dir, `${number}.json`), JSON.stringify(value)); return value; }
  catch (error) { if (error.code !== "EEXIST") throw error; return readSaved(path.join(dir, `${number}.json`)); }
}

/** Builds a lifecycle request from flags. The operation ID is derived, so a retried command replays safely. */
export async function lifecycleRequestFromFlags(target, id, action, options) {
  const project = await readTaskProject(target), item = await readNativeTask(target, id);
  const key = commandKey(action, id, options), dir = await savedRequestPath(target, id, key.slice(0, 32));
  const latest = await latestAttempt(dir);
  if (latest) {
    // Same command again: replay it if it was the latest operation, or resend it if it never landed.
    const saved = latest.value, event = item.history.find(entry => entry.operation_id === saved.request.operation_id);
    if (event ? event.sequence === item.version : saved.request.expected_version === item.version) return saved.request;
  }
  const expected = version(options, item);
  const request = { operation_id: `cli-${action}-${expected + 1}-${key.slice(0, 16)}`, expected_version: expected, actor: await resolveActor(target, project, options["--actor"]) };
  const summary = () => { if (!options["--summary"]) throw new Error(`task ${action} needs --summary`); return options["--summary"]; };
  const evidence = () => options["--evidence"] ?? [];
  if (action === "claim") request.base_revision = options["--base"] ?? await head(target);
  else if (action === "release") Object.assign(request, { claim_id: options["--claim"] ?? item.claim?.id, summary: summary() });
  else if (action === "handoff") Object.assign(request, { claim_id: options["--claim"] ?? item.claim?.id, revision: options["--revision"] ?? await head(target),
    summary: summary(), evidence: evidence(), unresolved: options["--unresolved"] ?? [], ...(options["--rollback"] ? { rollback: options["--rollback"] } : {}) });
  else if (action === "review") Object.assign(request, { revision: options["--revision"] ?? item.delivery?.revision, judgment: options["--judgment"],
    summary: summary(), evidence: evidence(), ...(options["--attempt"] ? { review_attempt_id: options["--attempt"] } : {}) });
  else if (action === "rework") Object.assign(request, { summary: summary(), ...(options["--mode"] ? { mode: options["--mode"] } : {}) });
  else if (action === "close") Object.assign(request, { revision: options["--revision"] ?? item.delivery?.revision, summary: summary(),
    rollback: options["--rollback"], evidence: evidence() });
  else if (action === "cancel") Object.assign(request, { summary: summary(), evidence: evidence() });
  else throw new Error("Unknown task operation");
  return (await saveAttempt(dir, (latest?.number ?? 0) + 1, { key, request })).request;
}

/** A short task draft from flags; createNativeTask records every default explicitly. */
export async function draftFromFlags(target, options) {
  const project = await readTaskProject(target), actor = await resolveActor(target, project, options["--actor"]);
  if (!options["--goal"] || !options["--acceptance"]?.length) throw new Error("task new needs --goal and at least one --acceptance");
  const key = commandKey("create", null, options), dir = await savedRequestPath(target, "create", key.slice(0, 32));
  // An identical task new always resends its original task ID and request; the
  // task store decides whether that is a replay. It never allocates a second task.
  const saved = (await latestAttempt(dir))?.value;
  if (saved) return { draft: saved.draft, request: saved.request };
  let id = options["--id"];
  if (!id) {
    const used = new Set((await listTaskItems(target)).map(item => item.id));
    for (let n = used.size + 1; !id; n += 1) if (!used.has(`WK-${String(n).padStart(4, "0")}`)) id = `WK-${String(n).padStart(4, "0")}`;
  }
  const draft = { id, goal: options["--goal"], scope: { include: options["--include"] ?? [options["--goal"]], exclude: options["--exclude"] ?? [] },
    acceptance: { criteria: options["--acceptance"] } };
  if (options["--write"] || options["--read"]) draft.environment = { ...(options["--write"] ? { write_paths: options["--write"] } : {}), ...(options["--read"] ? { read_paths: options["--read"] } : {}) };
  if (options["--risk"]) draft.verification = { risk_tier: options["--risk"] };
  if (options["--approval"]) draft.authorization = { approved_by: actor.principal_id, approval_ref: options["--approval"],
    operations: ["read", "write"], expires_at: null };
  // Bounded and collision-resistant, whatever the length of the task ID.
  const request = { operation_id: `cli-create-${hash({ id, key }).slice(0, 24)}`, expected_version: 0, actor };
  const kept = await saveAttempt(dir, 1, { key, draft, request });
  return { draft: kept.draft, request: kept.request };
}
