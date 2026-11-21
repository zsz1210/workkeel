// Checks the `workkeel ...` examples in fenced code blocks of README*.md and
// docs/**/*.md without running them. Each example goes through the CLI's own
// argument parser (parseCommandLine), must match a command form of
// `workkeel help advanced`, and must pass the value checks the CLI applies
// before it reads project state. Placeholder values such as <id>, ... or $SHA
// pass the value checks, because the example does not name a real value.
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { walkFiles } from "../src/files.mjs";
import { parseCommandLine } from "../src/workkeel-cli-flags.mjs";
import { RISK_TIERS } from "../src/workkeel-risk.mjs";
import { gitIgnoredFiles } from "./check-doc-links.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Ways the documentation starts the CLI. The project launcher forwards its arguments unchanged.
const LAUNCHERS = [["workkeel"], ["node", "./bin/workkeel.mjs"], ["node", "bin/workkeel.mjs"], ["node", "./workkeelw.mjs"],
  ["node", "workkeelw.mjs"], ["./workkeelw.mjs"]];
const NPX_PACKAGE = /^(?:@zsz1210\/)?workkeel(?:@[\w.-]+)?$/;
// Task operations that build a request from flags and need --summary (src/workkeel-cli-flags.mjs).
const SUMMARY_ACTIONS = new Set(["release", "handoff", "review", "rework", "close", "cancel"]);
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
// Where the help synopsis is shorter than the CLI's allow list, the CLI wins.
// Flag-form task operations accept these flags too (the allow list in src/workkeel-cli.mjs).
const LIFECYCLE_FLAGS = ["actor", "revision", "base", "claim", "summary", "evidence", "judgment", "rollback", "unresolved", "mode", "expect", "attempt", "pre-claim"];
// A multi-project report names its projects with --project, --projects-file or both.
const EITHER_REQUIRED = { project: "projects-file" };
const COMMIT = /^[a-f0-9]{4,64}$/;

/** True for an example value that stands for a real one: <name>, ..., $NAME or ${NAME}. */
export const placeholder = value => typeof value === "string" && (/<[^>]*>/.test(value) || value.includes("...") || /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value));

/** Splits one shell line into words, honouring quotes and backslashes; returns segments split at ;, && , || and |. */
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
  const commands = [], lines = markdown.split("\n");
  let fence = null, pending = null;
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n];
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence) { if (marker) fence = marker[1]; continue; }
    if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) { fence = null; pending = null; continue; }
    let text = line.replace(/^\s*\$\s+/, "");
    if (pending) { text = `${pending.text} ${text.trim()}`; }
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

/** Command forms of `workkeel help advanced`: command, actions (null means any task operation), positional target, and flags. */
export function helpForms(helpText) {
  const forms = [];
  for (const raw of helpText.split("\n")) {
    if (!raw.startsWith("workkeel ")) continue;
    const synopsis = raw.split(/\s{2,}|\s+\(/)[0];
    let previous = null;
    for (const part of synopsis.slice("workkeel ".length).split(" | ")) {
      const words = part.trim().split(/\s+/);
      const head = words[0].startsWith("[") || words[0].startsWith("--") ? [...(previous ?? [])] : [];
      const form = parseForm([...head, ...words]);
      previous = form.head;
      forms.push(form);
    }
  }
  return forms;
}

function parseForm(words) {
  const [command, ...rest] = words, form = { command, actions: [], target: false, flags: new Map(), head: [command] };
  let i = 0;
  if (rest[0] && !rest[0].startsWith("[") && !rest[0].startsWith("--")) {
    form.actions = rest[0] === "<operation>" ? null : rest[0].split("|");
    form.head.push(rest[0]); i = 1;
  }
  const text = rest.slice(i).join(" ");
  if (/^\[(?!--)[^\]]*\]/.test(text)) { form.target = true; form.head.push(text.match(/^\[[^\]]*\]/)[0]); }
  for (const match of text.matchAll(/(\[?)--([a-z][a-z-]*)/g)) {
    const required = match[1] !== "[", known = form.flags.get(match[2]);
    form.flags.set(match[2], { required: required || known?.required === true });
  }
  if (command === "task" && form.actions?.includes("claim") && form.flags.has("id") && !form.flags.has("request")) {
    for (const flag of LIFECYCLE_FLAGS) if (!form.flags.has(flag)) form.flags.set(flag, { required: false });
    for (const flag of ["base", "pre-claim"]) form.flags.get(flag).required = false;
  }
  return form;
}

let cachedForms = null;
/** The forms of this checkout's `workkeel help advanced`, read once. */
export function repositoryForms(target = root) {
  if (cachedForms) return cachedForms;
  const help = spawnSync(process.execPath, [path.join(target, "bin/workkeel.mjs"), "help", "advanced"], { encoding: "utf8" });
  if (help.status !== 0) throw new Error(`workkeel help advanced failed: ${help.stderr}`);
  return (cachedForms = helpForms(help.stdout));
}

function formProblem(form, parsed, given) {
  if (form.actions !== null && (form.actions.length ? !form.actions.includes(parsed.action) : parsed.action !== null)) return "action";
  if (parsed.targetGiven && !form.target) return "a positional target is not accepted by this form";
  const unknown = given.filter(name => !form.flags.has(name));
  if (unknown.length) return `--${unknown[0]} is not accepted by this form`;
  const missing = [...form.flags].filter(([name, flag]) => flag.required && !given.includes(name) && !given.includes(EITHER_REQUIRED[name]))
    .map(([name]) => name);
  if (missing.length) return `--${missing[0]} is required by this form`;
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
  check("risk", value => RISK_TIERS.includes(value), `must be one of ${RISK_TIERS.join(", ")}`);
  check("stale-after", value => Number.isFinite(Number(value)), "must be a number of hours");
  check("days", value => Number.isFinite(Number(value)), "must be a number of days");
  check("cutoff", value => Number.isFinite(new Date(value).getTime()) && /(Z|[+-]\d\d:\d\d)$/.test(value), "needs an ISO time with an explicit UTC offset");
  check("timezone", value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "must be an IANA time zone");
  if (parsed.command === "task") check("id", value => TASK_ID.test(value), "is not a valid task ID");
  if (option("pre-claim") && (parsed.action !== "claim" || option("base") === undefined)) problems.push("--pre-claim applies only to task claim with an explicit --base");
  if (parsed.command === "task" && SUMMARY_ACTIONS.has(parsed.action) && option("request") === undefined && !option("summary"))
    problems.push(`task ${parsed.action} needs --summary`);
  return problems;
}

/** Problems with one example's arguments; an empty list means the CLI would accept its form. */
export function validateCommand(args, forms = repositoryForms()) {
  if (!args.length || ["help", "--help", "-h"].includes(args[0])) return args.length > 2 || (args[1] && args[1] !== "advanced") ? ["help takes no argument but advanced"] : [];
  if (["version", "--version"].includes(args[0])) return args.length > 1 ? ["version takes no argument"] : [];
  // The monitor reads its own arguments (src/workkeel-monitor.mjs): at most one project path.
  if (args[0] === "monitor") return args.length > 2 || args.slice(1).some(arg => arg.startsWith("-")) ? ["monitor takes at most one project path"] : [];
  let parsed;
  try { parsed = parseCommandLine(args); } catch (error) { return [error.message]; }
  const given = Object.keys(parsed.options).map(name => name.slice(2));
  const candidates = forms.filter(form => form.command === parsed.command);
  if (!candidates.length) return [`unknown command ${parsed.command}`];
  const taskActions = new Set(forms.filter(form => form.command === "task" && form.actions).flatMap(form => form.actions));
  const results = candidates.map(form => ({ form, problem: form.actions === null && !taskActions.has(parsed.action) ? "action" : formProblem(form, parsed, given) }));
  if (!results.some(result => result.problem === null)) {
    // Report the problem of the form that accepts the most of the given flags.
    const specific = results.filter(result => result.problem !== "action");
    const covered = result => given.filter(name => result.form.flags.has(name)).length;
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
export async function findInvalidDocCommands(target = root, forms = repositoryForms(target)) {
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
