import path from "node:path";
import { parseArgs } from "node:util";
import { readNativeGit, readLocalActor, readTaskProject } from "./workkeel-project.mjs";
import { readNativeTask, listTaskItems } from "./workkeel-tasks.mjs";

const GROUPS = ["task", "usage", "dispatch", "intake", "runtime", "instructions", "workflow", "headroom", "skills", "context",
  "learning", "workspace", "model-policy", "skill-lifecycle", "autonomy", "retention", "goal", "policy"];
const SINGLE = ["policy", "source", "request", "id", "fingerprint", "actor", "revision", "base", "claim", "summary",
  "judgment", "rollback", "mode", "expect", "goal", "risk", "principal", "attempt"];
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

/** Builds a lifecycle request from flags. The operation ID is derived, so a retried command replays safely. */
export async function lifecycleRequestFromFlags(target, id, action, options) {
  const project = await readTaskProject(target), item = await readNativeTask(target, id);
  const expected = version(options, item);
  const request = { operation_id: `cli-${action}-v${expected + 1}`, expected_version: expected, actor: await resolveActor(target, project, options["--actor"]) };
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
  return request;
}

/** A short task draft from flags; createNativeTask records every default explicitly. */
export async function draftFromFlags(target, options) {
  const project = await readTaskProject(target), actor = await resolveActor(target, project, options["--actor"]);
  if (!options["--goal"] || !options["--acceptance"]?.length) throw new Error("task new needs --goal and at least one --acceptance");
  let id = options["--id"];
  if (!id) {
    const used = new Set((await listTaskItems(target)).map(item => item.id));
    for (let n = used.size + 1; !id; n += 1) if (!used.has(`WK-${String(n).padStart(4, "0")}`)) id = `WK-${String(n).padStart(4, "0")}`;
  }
  const draft = { id, goal: options["--goal"], scope: { include: options["--include"] ?? [options["--goal"]], exclude: options["--exclude"] ?? [] },
    acceptance: { criteria: options["--acceptance"] } };
  if (options["--write"] || options["--read"]) draft.environment = { ...(options["--write"] ? { write_paths: options["--write"] } : {}), ...(options["--read"] ? { read_paths: options["--read"] } : {}) };
  if (options["--risk"]) draft.verification = { risk_tier: options["--risk"] };
  return { draft, request: { operation_id: `cli-create-${id}`, expected_version: 0, actor } };
}
