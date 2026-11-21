// Checks the `workkeel ...` examples in fenced code blocks of README*.md and
// docs/**/*.md without running them. Each example goes through the CLI's own
// argument parser (parseCommandLine), must match one command form of
// COMMAND_FORMS, and must pass the value checks the CLI applies to flags.
// COMMAND_FORMS mirrors the allow(...) lists and required(...) flags of
// src/workkeel-cli.mjs; test/doc-commands.test.mjs fails when the two differ.
// Placeholder values such as <id>, ... or $SHA pass the value checks, because
// the example does not name a real value.
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { walkFiles } from "../src/files.mjs";
import { parseCommandLine } from "../src/workkeel-cli-flags.mjs";
import { RISK_TIERS } from "../src/workkeel-risk.mjs";
import { gitIgnoredFiles, markdownLines } from "./check-doc-links.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Ways the documentation starts the CLI. The project launcher forwards its arguments unchanged.
const LAUNCHERS = [["workkeel"], ["node", "./bin/workkeel.mjs"], ["node", "bin/workkeel.mjs"], ["node", "./workkeelw.mjs"],
  ["node", "workkeelw.mjs"], ["./workkeelw.mjs"]];
const NPX_PACKAGE = /^(?:@zsz1210\/)?workkeel(?:@[\w.-]+)?$/;

const LIFECYCLE = ["claim", "release", "handoff", "review", "rework", "close", "cancel"];
const form = (command, actions, flags, extra = {}) => {
  const spec = flags.split(/\s+/).filter(Boolean);
  return { command, actions, flags: spec.map(flag => flag.replace(/[!?]$/, "")), required: spec.filter(flag => flag.endsWith("!")).map(flag => flag.slice(0, -1)), ...extra };
};
// One entry per allow(...) branch of src/workkeel-cli.mjs. "name!" is required
// (required(...) in the CLI); "name?" is optional. actions [] means no action.
export const COMMAND_FORMS = [
  form("start", [], "request?"),
  form("init", [], "policy!"),
  form("init", [], "principal? builder? reviewer?"),
  form("workspace", ["show"], ""),
  form("workspace", ["serve"], "request?"),
  form("workspace", ["create", "register", "remove", "integration"], "request!"),
  // --project or --projects-file selects the multi-project report, which takes no positional target.
  form("stats", [], "report! days? previous? cutoff! timezone! project? projects-file? strict?", { report: true }),
  form("stats", [], ""),
  form("upgrade", [], "actor?"),
  form("policy", ["show"], ""),
  form("policy", ["update"], "policy! actor?"),
  form("status", [], "stale-after?"),
  form("doctor", [], ""),
  form("retention", ["inventory", "preview", "archive", "verify", "usage"], "request!"),
  form("model-policy", ["show"], "id!"),
  form("model-policy", ["draft", "approve", "preview"], "request!"),
  form("skill-lifecycle", ["list"], ""),
  form("skill-lifecycle", ["candidate", "evaluate", "review", "approve", "policy", "activate", "suspend", "rollback", "revalidate", "use", "retrospective"], "request!"),
  form("goal", ["list"], ""),
  form("goal", ["show", "tick", "serve"], "id!"),
  form("goal", ["create", "pause", "resume", "cancel", "recover", "extend-admission", "dispose-proposal"], "request!"),
  form("autonomy", ["show"], ""),
  form("autonomy", ["tick", "serve"], ""),
  form("autonomy", ["policy", "pause", "resume", "event"], "request!"),
  form("learning", ["list"], ""),
  form("learning", ["capture", "review", "use", "search", "impact"], "request!"),
  form("intake", ["preview"], "request!"),
  form("intake", ["apply"], "request! fingerprint!"),
  form("dispatch", ["show"], "id!"),
  form("dispatch", ["prepare", "plan", "bind"], "request!"),
  form("usage", ["collect"], "id!"),
  form("usage", ["bind", "report", "activity", "close"], "request!"),
  form("task", ["evidence-check"], "id! request!"),
  form("task", ["assess"], "id! request?"),
  form("task", ["summary"], "id!"),
  form("task", ["observe"], "id! request!"),
  form("task", ["metrics"], "id!"),
  form("task", ["show"], "id!"),
  form("task", ["new", "create"], "goal! acceptance! write? read? include? exclude? risk? id? actor? approval?"),
  form("task", ["create"], "source! request!"),
  form("task", LIFECYCLE, "id! request!"),
  form("task", ["create"], "source! actor?"),
  form("task", LIFECYCLE, "id! actor? revision? base? claim? summary? evidence? judgment? rollback? unresolved? mode? expect? attempt? pre-claim?"),
  form("context", ["prepare"], "id! request!"),
  form("runtime", ["plan"], "id!"),
  form("skills", ["audit"], "request!"),
  form("instructions", ["preview"], ""),
  form("instructions", ["apply"], "fingerprint!"),
  form("workflow", ["metrics", "show"], "id!"),
  form("workflow", ["plan", "run", "continuation-plan", "continue"], "request!"),
  form("workflow", ["cancel", "recover-lock"], "id! request!"),
  form("headroom", ["view", "read"], "request!")
];

// Task operations that build a request from flags and need --summary (src/workkeel-cli-flags.mjs).
const SUMMARY_ACTIONS = new Set(["release", "handoff", "review", "rework", "close", "cancel"]);
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const COMMIT = /^[a-f0-9]{4,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;

/** True for an example value that stands for a real one: <name>, ..., $NAME or ${NAME}. */
export const placeholder = value => typeof value === "string" && (/<[^>]*>/.test(value) || value.includes("...") || /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value));

/** Splits one shell line into words, honouring quotes and backslashes; returns segments split at ;, &&, || and |. */
export function shellSegments(line) {
  const segments = [[]];
  let word = null, quote = null;
  const end = () => { if (word !== null) segments.at(-1).push(word); word = null; };
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += c;
    } else if (c === "'" || c === '"') { quote = c; word ??= ""; }
    else if (c === "\\" && i + 1 < line.length) word = (word ?? "") + line[++i];
    else if (/\s/.test(c)) end();
    else if (c === "#" && word === null) break;
    else if (c === ";" || c === "|" || c === "&" && line[i + 1] === "&") {
      end(); segments.push([]);
      if (line[i + 1] === c) i += 1;
    } else word = (word ?? "") + c;
  }
  end();
  return segments.filter(segment => segment.length);
}

/** The CLI arguments of a shell segment that starts Workkeel, or null. Leading VAR=value assignments are skipped. */
export function workkeelArgs(words) {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i += 1;
  const rest = words.slice(i);
  if (rest[0] === "npx" && NPX_PACKAGE.test(rest[1] ?? "")) return rest.slice(2);
  for (const launcher of LAUNCHERS) if (launcher.every((word, n) => rest[n] === word)) return rest.slice(launcher.length);
  return null;
}

/** Every Workkeel example in the fenced code blocks of one Markdown source, with its 1-based line. */
export function extractDocCommands(markdown) {
  const commands = [], lines = markdownLines(markdown);
  let pending = null;
  for (let n = 0; n < lines.length; n += 1) {
    if (!lines[n].code) { pending = null; continue; }
    let text = lines[n].text.replace(/^\s*\$\s+/, "");
    if (pending) text = `${pending.text} ${text.trim()}`;
    if (/(^|[^\\])\\$/.test(text)) { pending = { text: text.slice(0, -1), line: pending?.line ?? n + 1 }; continue; }
    const start = pending?.line ?? n + 1;
    pending = null;
    for (const segment of shellSegments(text)) {
      const args = workkeelArgs(segment);
      if (args) commands.push({ line: start, args });
    }
  }
  return commands;
}

/** Command and action pairs, with flags, from the synopsis lines of `workkeel help advanced`. */
export function helpForms(helpText) {
  const forms = [];
  for (const raw of helpText.split("\n")) {
    if (!raw.startsWith("workkeel ")) continue;
    let previous = [];
    for (const part of raw.split(/\s{2,}|\s+\(/)[0].slice("workkeel ".length).split(" | ")) {
      const words = part.trim().split(/\s+/);
      const all = words[0].startsWith("[") || words[0].startsWith("--") ? [...previous, ...words] : words;
      const [command, second = ""] = all;
      const actions = second && !second.startsWith("[") && !second.startsWith("--") ? second.split("|") : [];
      previous = actions.length ? [command, second] : [command];
      forms.push({ command, actions, flags: [...all.join(" ").matchAll(/--([a-z][a-z-]*)/g)].map(match => match[1]) });
    }
  }
  return forms;
}

function formProblem(entry, parsed, given) {
  if (entry.actions.length ? !entry.actions.includes(parsed.action) : parsed.action !== null) return "action";
  const unknown = given.filter(name => !entry.flags.includes(name));
  if (unknown.length) return `--${unknown[0]} is not accepted by this form`;
  const missing = entry.required.filter(name => !given.includes(name));
  if (missing.length) return `--${missing[0]} is required by this form`;
  if (entry.report && parsed.targetGiven && (given.includes("project") || given.includes("projects-file")))
    return "a multi-project report takes --project or --projects-file, not a positional target";
  return null;
}

function valueProblems(parsed) {
  const problems = [], option = name => parsed.options[`--${name}`];
  const check = (name, valid, message) => {
    const value = option(name);
    if (value !== undefined && !placeholder(value) && !valid(value)) problems.push(`--${name} ${JSON.stringify(value)}: ${message}`);
  };
  check("base", value => COMMIT.test(value), "must be a full or abbreviated hexadecimal commit ID");
  check("revision", value => COMMIT.test(value), "must be a full or abbreviated hexadecimal commit ID");
  check("expect", value => Number.isSafeInteger(Number(value)) && Number(value) >= 0, "must be a task version");
  check("judgment", value => ["pass", "fail"].includes(value), "must be pass or fail");
  check("mode", value => ["source", "evidence-only"].includes(value), "must be source or evidence-only");
  check("risk", value => RISK_TIERS.includes(value), `must be one of ${RISK_TIERS.join(", ")}`);
  check("stale-after", value => Number.isFinite(Number(value)) && Number(value) > 0, "must be a positive number of hours");
  check("days", value => Number(value) === 7, "must be 7 for the weekly report");
  check("previous", value => SHA256.test(value), "must be a report fingerprint (64 hexadecimal characters)");
  check("fingerprint", value => SHA256.test(value), "must be a preview fingerprint (64 hexadecimal characters)");
  check("cutoff", value => Number.isFinite(new Date(value).getTime()) && /(Z|[+-]\d\d:\d\d)$/.test(value), "needs an ISO time with an explicit UTC offset");
  check("timezone", value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "must be an IANA time zone");
  if (parsed.command === "task") check("id", value => TASK_ID.test(value), "is not a valid task ID");
  if (option("pre-claim") && (parsed.action !== "claim" || option("base") === undefined)) problems.push("--pre-claim applies only to task claim with an explicit --base");
  // Flag-form task operations build the request from flags, so the values the task
  // store requires must be present and nonempty (src/workkeel-tasks.mjs assertText).
  const text = value => typeof value === "string" && value.trim() !== "";
  const needText = (name, message) => { const value = option(name); if (!text(value) && !placeholder(value)) problems.push(message); };
  if (parsed.command === "task" && option("request") === undefined && option("source") === undefined) {
    if (SUMMARY_ACTIONS.has(parsed.action)) needText("summary", `task ${parsed.action} needs a nonempty --summary`);
    if (parsed.action === "review" && option("judgment") === undefined) problems.push("task review needs --judgment pass or fail");
    if (parsed.action === "close") needText("rollback", "task close needs a nonempty --rollback");
    if (parsed.action === "handoff" && option("rollback") !== undefined) needText("rollback", "task handoff --rollback must not be empty");
    if (["new", "create"].includes(parsed.action)) {
      needText("goal", "task new needs a nonempty --goal");
      if ((option("acceptance") ?? []).some(value => !text(value))) problems.push("task new --acceptance must not be empty");
    }
  }
  return problems;
}

/** Problems with one example's arguments; an empty list means the CLI would accept its form and values. */
export function validateCommand(args, forms = COMMAND_FORMS) {
  if (!args.length || ["help", "--help", "-h"].includes(args[0])) return args.length > 2 || (args[1] && args[1] !== "advanced") ? ["help takes no argument but advanced"] : [];
  if (["version", "--version"].includes(args[0])) return args.length > 1 ? ["version takes no argument"] : [];
  // The monitor reads its own arguments (src/workkeel-monitor.mjs): at most one project path.
  if (args[0] === "monitor") return args.length > 2 || args.slice(1).some(arg => arg.startsWith("-")) ? ["monitor takes at most one project path"] : [];
  let parsed;
  try { parsed = parseCommandLine(args); } catch (error) { return [error.message]; }
  const given = Object.keys(parsed.options).map(name => name.slice(2));
  const candidates = forms.filter(entry => entry.command === parsed.command);
  if (!candidates.length) return [`unknown command ${parsed.command}`];
  const results = candidates.map(entry => ({ entry, problem: formProblem(entry, parsed, given) }));
  if (!results.some(result => result.problem === null)) {
    // Report the problem of the form that accepts the most of the given flags.
    const specific = results.filter(result => result.problem !== "action");
    const covered = result => given.filter(name => result.entry.flags.includes(name)).length;
    specific.sort((a, b) => covered(b) - covered(a));
    return [specific.length ? specific[0].problem : `unknown action ${parsed.action ?? "(none)"} for ${parsed.command}`];
  }
  return valueProblems(parsed);
}

/** Files whose code blocks hold user-facing examples: README*.md at the root and docs/**\/*.md, minus Git-ignored files. */
export async function documentationFiles(target = root) {
  const candidates = (await walkFiles(target)).filter(file => /^README(?:\.[\w-]+)?\.md$/.test(file) || file.startsWith("docs/") && file.endsWith(".md"));
  const ignored = gitIgnoredFiles(target, candidates);
  return candidates.filter(file => !ignored.has(file)).sort();
}

/** Every invalid example, as "file:line: workkeel args: problem". */
export async function findInvalidDocCommands(target = root, forms = COMMAND_FORMS) {
  const failures = [];
  let count = 0;
  for (const file of await documentationFiles(target)) {
    for (const { line, args } of extractDocCommands(await fs.readFile(path.join(target, file), "utf8"))) {
      count += 1;
      for (const problem of validateCommand(args, forms)) failures.push(`${file}:${line}: workkeel ${args.join(" ")}: ${problem}`);
    }
  }
  return { count, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { count, failures } = await findInvalidDocCommands();
  if (failures.length) {
    console.error(`Documentation command checks failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  } else console.log(`Documentation command checks passed: ${count} examples.`);
}
