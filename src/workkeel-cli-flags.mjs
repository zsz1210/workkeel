import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { readNativeGit, readLocalActor, readTaskProject, requireHeadRevision } from "./workkeel-project.mjs";
import { readNativeTask, listTaskItems, mutateNativeTask, createNativeTask } from "./workkeel-tasks.mjs";
import { durableAtomicCreate } from "./files.mjs";

const GROUPS = ["task", "usage", "dispatch", "intake", "runtime", "instructions", "workflow", "headroom", "skills", "context",
  "learning", "workspace", "model-policy", "skill-lifecycle", "autonomy", "retention", "goal", "policy"];
const SINGLE = ["policy", "source", "request", "id", "fingerprint", "actor", "revision", "base", "claim", "summary",
  "judgment", "rollback", "mode", "expect", "goal", "risk", "principal", "builder", "reviewer", "attempt", "approval", "days", "previous", "cutoff", "timezone", "stale-after"];
const MULTIPLE = ["evidence", "acceptance", "write", "read", "include", "exclude", "unresolved"];
const BOOLEAN = ["json", "report"];

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
  // `--json` is accepted everywhere: output is JSON unless a command offers Markdown.
  const result = {};
  for (const [name, value] of Object.entries(parsed.values)) if (name !== "json") result[`--${name}`] = value;
  return { command, action, target: path.resolve(target), options: result, json: parsed.values.json === true };
}

/** Resolves `--actor agent-id`, or the checkout's local default, to a registered actor. */
export async function resolveActor(target, project, agentId) {
  const id = agentId ?? await readLocalActor(target);
  if (!id) throw new Error("Pass --actor <agent-id> or record a default agent_id in .workkeel/local.json");
  const agent = project.policy.agents.find(entry => entry.agent_id === id);
  if (!agent) throw new Error(`Agent ${id} is not registered in this project's policy`);
  return { agent_id: agent.agent_id, principal_id: agent.principal_id };
}

async function head(target) { return requireHeadRevision(target); }
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
async function savedAttempts(dir, key) {
  const result = [];
  for (const number of await attempts(dir)) {
    const value = await readSaved(path.join(dir, `${number}.json`));
    if (value?.key !== key) throw new Error(`Saved CLI request ${dir}/${number}.json belongs to another command; remove it`);
    result.push({ number, value });
  }
  return result;
}
async function saveAttempt(dir, number, value) {
  await fs.mkdir(dir, { recursive: true });
  try { await durableAtomicCreate(path.join(dir, `${number}.json`), JSON.stringify(value)); return value; }
  catch (error) { if (error.code !== "EEXIST") throw error; return readSaved(path.join(dir, `${number}.json`)); }
}

/**
 * Runs a lifecycle operation from flags. Every saved attempt of this exact
 * command is considered, not just the newest, so a stale or failed attempt never
 * hides the one that succeeded. If the task moved on while this command was
 * preparing, it reads the task again and reselects instead of failing.
 */
export async function runLifecycleFromFlags(target, id, action, options, hooks = {}) {
  if (["claim", "handoff", "review", "close"].includes(action)) await requireHeadRevision(target);
  // An abbreviated --revision names the same command and target as the full commit ID.
  if (/^[a-f0-9]{4,39}$/.test(options["--revision"] ?? "")) {
    try { options = { ...options, "--revision": (await readNativeGit(target, ["rev-parse", "--verify", `${options["--revision"]}^{commit}`])).trim() }; }
    catch { throw new Error(`--revision ${options["--revision"]} does not name exactly one commit`); }
  }
  for (let round = 0; ; round += 1) {
    const item = await readNativeTask(target, id);
    await hooks.afterSnapshot?.(item);
    const request = await lifecycleRequestFromFlags(target, id, action, options, item, hooks);
    await hooks.beforeMutation?.(request);
    try { return await mutateNativeTask(target, id, action, request); }
    catch (error) {
      if (round >= 3 || (await readNativeTask(target, id)).version === item.version) throw error;
    }
  }
}

// The object each state-changing command acts on. A command binds it on its first
// attempt, except an undelivered handoff may refresh its implicit HEAD revision.
// claim, cancel and create act on the task itself (its ID is part of the command
// key); claim deliberately does not bind its base revision.
const TARGET_FIELDS = { claim: [], cancel: [], release: ["claim_id"], handoff: ["claim_id", "revision"],
  review: ["revision"], close: ["revision"], rework: ["revision"] };
/** The target a request would act on now. Rework acts on the failed candidate, which its request does not name. */
function currentTarget(action, item, request, options) {
  return Object.fromEntries(TARGET_FIELDS[action].map(field =>
    [field, action === "rework" ? ("--revision" in options ? options["--revision"] : item.delivery?.revision ?? null) : request[field] ?? null]));
}
/** The target recorded with a saved attempt; attempts saved before binding existed are refused when unknowable. */
function recordedTarget(action, value) {
  if (value.target) return value.target;
  const fields = TARGET_FIELDS[action];
  if (fields.every(field => field in value.request)) return Object.fromEntries(fields.map(field => [field, value.request[field]]));
  throw new Error(`A saved ${action} request has no recorded target; remove .git/workkeel/cli-operations for this task or pass explicit flags`);
}
function assertSameTarget(action, first, next) {
  for (const field of TARGET_FIELDS[action]) if (first && first[field] !== next[field])
    throw new Error(`This command first targeted ${field} ${first[field]}, but it would now act on ${next[field] ?? "none"}; rerun with an explicit --${field === "claim_id" ? "claim" : "revision"} for the new target`);
}

/**
 * The one check for any request this command is about to send, whether newly
 * built, resent because it never landed, or adopted from a concurrent save. A
 * successful operation's replay does not come here: it is already applied.
 */
function assertReusable(action, item, options, firstTarget, target) {
  assertSameTarget(action, firstTarget, target);
  // An explicit flag, even an empty one, must name exactly this command's target.
  for (const [flag, field] of [["--revision", "revision"], ["--claim", "claim_id"]]) {
    if (!(flag in options) || !TARGET_FIELDS[action].includes(field)) continue;
    if (!options[flag]) throw new Error(`${flag} must not be empty`);
    if (target[field] !== options[flag]) throw new Error(`${flag} ${options[flag]} does not match this command's target ${target[field] ?? "(none)"}`);
  }
  // The target must still be what the task currently holds. A handoff delivers a new
  // commit, so only its claim is compared here; the task checks the commit is HEAD.
  const current = { claim_id: item.claim?.id ?? null, revision: item.delivery?.revision ?? null };
  for (const field of TARGET_FIELDS[action]) {
    if (action === "handoff" && field === "revision") continue;
    if (target[field] !== current[field]) throw new Error(`This command targets ${field} ${target[field] ?? "(none)"}, but the task's current ${field} is ${current[field] ?? "(none)"}`);
  }
}

/** Selects or creates the saved request for this command against one task snapshot. */
export async function lifecycleRequestFromFlags(target, id, action, options, snapshot = null, hooks = {}) {
  const project = await readTaskProject(target), item = snapshot ?? await readNativeTask(target, id);
  const key = commandKey(action, id, options), dir = await savedRequestPath(target, id, key.slice(0, 32));
  const saved = await savedAttempts(dir, key);
  // Replay the attempt that is the task's latest operation; otherwise resend one that never landed.
  const latestEvent = item.history.at(-1)?.operation_id;
  const replay = saved.find(entry => entry.value.request.operation_id === latestEvent);
  if (replay) return replay.value.request;
  if (!TARGET_FIELDS[action]) throw new Error("Unknown task operation");
  let firstTarget = saved[0] ? recordedTarget(action, saved[0].value) : null;
  const derivedField = action === "handoff" && !("--revision" in options) ? "revision"
    : action === "claim" && !("--base" in options) ? "base_revision" : null;
  const derivedHead = derivedField ? await head(target) : null;
  const landed = new Set(item.history.map(event => event.operation_id));
  // Only an undelivered handoff's implicit revision may follow HEAD. Keep its
  // original claim binding, and never redirect a command that already landed.
  if (firstTarget && action === "handoff" && derivedField &&
      !saved.some(entry => landed.has(entry.value.request.operation_id)))
    firstTarget = { ...firstTarget, revision: derivedHead };
  const pending = saved.find(entry => entry.value.request.expected_version === item.version &&
    !landed.has(entry.value.request.operation_id) &&
    (!derivedField || entry.value.request[derivedField] === derivedHead));
  // A request that never landed is resent only if it still aims at the first target.
  if (pending) { assertReusable(action, item, options, firstTarget, recordedTarget(action, pending.value)); return pending.value.request; }
  // A new request is built only for the task as it is now; an --expect for another
  // version could otherwise be saved and become valid later against a new target.
  if ("--expect" in options && version(options, item) !== item.version)
    throw new Error(`--expect ${options["--expect"]} does not match the task's current version ${item.version}`);
  const expected = item.version;
  const attempt = (saved.at(-1)?.number ?? 0) + 1;
  const request = { operation_id: `cli-${action}-${expected + 1}-${key.slice(0, 16)}-${attempt}`, expected_version: expected, actor: await resolveActor(target, project, options["--actor"]) };
  const summary = () => { if (!options["--summary"]) throw new Error(`task ${action} needs --summary`); return options["--summary"]; };
  const evidence = () => options["--evidence"] ?? [];
  if (action === "claim") request.base_revision = options["--base"] ?? derivedHead;
  else if (action === "release") Object.assign(request, { claim_id: options["--claim"] ?? item.claim?.id, summary: summary() });
  else if (action === "handoff") Object.assign(request, { claim_id: options["--claim"] ?? item.claim?.id, revision: options["--revision"] ?? derivedHead,
    summary: summary(), evidence: evidence(), unresolved: options["--unresolved"] ?? [], ...(options["--rollback"] ? { rollback: options["--rollback"] } : {}) });
  else if (action === "review") Object.assign(request, { revision: options["--revision"] ?? item.delivery?.revision, judgment: options["--judgment"],
    summary: summary(), evidence: evidence(), ...(options["--attempt"] ? { review_attempt_id: options["--attempt"] } : {}) });
  else if (action === "rework") Object.assign(request, { summary: summary(), ...(options["--mode"] ? { mode: options["--mode"] } : {}) });
  else if (action === "close") Object.assign(request, { revision: options["--revision"] ?? item.delivery?.revision, summary: summary(),
    rollback: options["--rollback"], evidence: evidence() });
  else if (action === "cancel") Object.assign(request, { summary: summary(), evidence: evidence() });
  else throw new Error("Unknown task operation");
  // Keep the first target, except for an undelivered handoff's implicit HEAD.
  const aim = currentTarget(action, item, request, options);
  assertReusable(action, item, options, firstTarget, aim);
  await hooks.beforeSave?.(dir, attempt, key);
  // Another process may have saved this attempt number first. Its request is adopted
  // only if it is the same command aimed at the same target as this one.
  const kept = await saveAttempt(dir, attempt, { key, request, target: aim });
  if (kept?.key !== key) throw new Error("A concurrent CLI request with another command took this attempt; rerun the command");
  assertReusable(action, item, options, firstTarget ?? aim, recordedTarget(action, kept));
  if (derivedField && kept.request[derivedField] !== derivedHead)
    throw new Error("A concurrent CLI request derived a different HEAD; rerun the command");
  return kept.request;
}

/** A short task draft from flags; createNativeTask records every default explicitly. */
export async function draftFromFlags(target, options) {
  const project = await readTaskProject(target), actor = await resolveActor(target, project, options["--actor"]);
  if (!options["--goal"] || !options["--acceptance"]?.length) throw new Error("task new needs --goal and at least one --acceptance");
  const key = commandKey("create", null, options), dir = await savedRequestPath(target, "create", key.slice(0, 32));
  // An identical task new always resends its original task ID and request; the
  // task store decides whether that is a replay. It never allocates a second task.
  const saved = (await savedAttempts(dir, key)).at(0)?.value;
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

/** Creates or replays a task from flags, refusing an identical terminal task. */
export async function runCreateFromFlags(target, options, hooks = {}) {
  const { draft, request } = await draftFromFlags(target, options);
  await hooks.beforeMutation?.(request);
  const result = await createNativeTask(target, draft, request);
  if (["cancelled", "done"].includes(result.state))
    throw new Error(`An identical task ${result.id} already exists and is ${result.state}; change the goal or acceptance text, or pass --id with an unused task ID to file a new task.`);
  return result;
}
