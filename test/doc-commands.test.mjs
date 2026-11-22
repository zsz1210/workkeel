import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCommandLine } from "../src/workkeel-cli-flags.mjs";
import { readTaskFile } from "../src/task-contract.mjs";
import { COMMAND_FORMS, extractDocCommands, findInvalidDocCommands, helpForms, inputPathValid, placeholder, shellSegments, validateCommand, workkeelArgs } from "../scripts/check-doc-commands.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every workkeel example in README and docs code blocks passes the CLI parser and validators", async () => {
  const { count, failures } = await findInvalidDocCommands();
  assert.deepEqual(failures, []);
  assert.ok(count >= 50, `only ${count} examples found`);
});

test("examples are read from fenced code blocks only, with prompts, continuations, launchers and chains", () => {
  const markdown = [
    "workkeel status --bogus outside a fence",
    "```sh",
    "$ workkeel status .",
    "workkeel stats --report --project ../a \\",
    "  --cutoff 2026-10-19T00:00:00Z --timezone UTC",
    "WORKKEEL_CLI_PATH=/x node ./workkeelw.mjs doctor . && npx @zsz1210/workkeel@1.1.0 task show . --id WK-1 # comment",
    "echo workkeel task new",
    "```",
    "~~~",
    "node ./bin/workkeel.mjs task review --id WK-1 --summary 'a b' --judgment pass",
    "~~~",
    "1. In a list:",
    "",
    "    ```sh",
    "    workkeel doctor .",
    "    ```",
    "> ~~~sh",
    "> workkeel status .",
    "> ~~~"
  ].join("\n");
  assert.deepEqual(extractDocCommands(markdown), [
    { line: 3, args: ["status", "."] },
    { line: 4, args: ["stats", "--report", "--project", "../a", "--cutoff", "2026-10-19T00:00:00Z", "--timezone", "UTC"] },
    { line: 6, args: ["doctor", "."] },
    { line: 6, args: ["task", "show", ".", "--id", "WK-1"] },
    { line: 10, args: ["task", "review", "--id", "WK-1", "--summary", "a b", "--judgment", "pass"] },
    { line: 15, args: ["doctor", "."] },
    { line: 18, args: ["status", "."] }
  ]);
  assert.deepEqual(shellSegments(`a "b c" 'd\\e' f\\ g | h; i`), [["a", "b c", "d\\e", "f g"], ["h"], ["i"]]);
  assert.equal(workkeelArgs(["npx", "left-pad", "status"]), null);
  // Shell redirects and their targets never reach the CLI; <name> placeholders stay words.
  for (const line of ["workkeel status . > status.json", "workkeel status . 2>/dev/null", "workkeel status . >>out 2>&1", "workkeel status . &> 'a b'"])
    assert.deepEqual(shellSegments(line), [["workkeel", "status", "."]], line);
  assert.deepEqual(shellSegments("workkeel task show --id <task-id> < in.json | jq ."), [["workkeel", "task", "show", "--id", "<task-id>"], ["jq", "."]]);
  assert.deepEqual(shellSegments(`workkeel task new --goal ">" --acceptance a`), [["workkeel", "task", "new", "--goal", ">", "--acceptance", "a"]]);
  // A redirect right after a word ends that word; the word is still an argument.
  assert.deepEqual(shellSegments("workkeel task show --id WK-1>/dev/null"), [["workkeel", "task", "show", "--id", "WK-1"]]);
  assert.deepEqual(shellSegments("workkeel task claim --id WK-1 --base deadbeef>claim.json"), [["workkeel", "task", "claim", "--id", "WK-1", "--base", "deadbeef"]]);
  assert.deepEqual(shellSegments("workkeel status .>out 2>&1"), [["workkeel", "status", "."]]);
  assert.deepEqual(shellSegments("workkeel task show --id WK-1<in.json"), [["workkeel", "task", "show", "--id", "WK-1"]]);
  // Quoted or escaped operators are literal text, and a quoted number is an argument, not a file descriptor.
  assert.deepEqual(shellSegments(`workkeel task new --goal a\\>b --acceptance 'c>d'`), [["workkeel", "task", "new", "--goal", "a>b", "--acceptance", "c>d"]]);
  assert.deepEqual(shellSegments(`workkeel task new --goal "2">x --acceptance y`), [["workkeel", "task", "new", "--goal", "2", "--acceptance", "y"]]);
  assert.deepEqual(validateCommand(shellSegments("workkeel task show --id WK-1>/dev/null")[0].slice(1)), []);
});

test("invalid examples are flagged: unknown commands, actions and flags, and failed value checks", () => {
  const cases = {
    "frobnicate .": "unknown command frobnicate",
    "task frob --id WK-1": "unknown action frob for task",
    "task show --id WK-1 --bogus x": "Unknown, repeated or incomplete Workkeel option",
    "task show --id WK-1 --id WK-2": "--id is repeated",
    "status . extra": "Unexpected argument: extra",
    "task show . --id WK-1 --summary x": "--summary is not accepted by this form",
    "task new --goal g": "--acceptance is required by this form",
    "task claim --id WK-1 --base main": "--base \"main\": must be a full or abbreviated hexadecimal commit ID",
    "task close --id WK-1 --summary s --revision HEAD": "--revision \"HEAD\": must be a full or abbreviated hexadecimal commit ID",
    "task review --id WK-1 --summary s --judgment maybe": "--judgment \"maybe\": must be pass or fail",
    "task new --goal g --acceptance a --risk huge": "--risk \"huge\": must be one of low, standard, high, critical",
    "task claim --id WK-1 --expect 1.5": "--expect \"1.5\": must be a task version",
    "task handoff --id WK-1": "task handoff needs a nonempty --summary",
    "task cancel --id WK-1 --summary  ": "task cancel needs a nonempty --summary",
    "task review --id WK-1 --summary reviewed": "task review needs --judgment pass or fail",
    "task close --id WK-1 --summary accepted": "task close needs a nonempty --rollback",
    "task handoff --id WK-1 --summary s --rollback=": "task handoff --rollback must not be empty",
    "task new --goal= --acceptance ok": "--goal is required by this form",
    "task new --goal g --acceptance=": "task new --acceptance must not be empty",
    "workspace create --request=": "--request is required by this form",
    "goal show --id=": "--id is required by this form",
    "task new --goal g --acceptance a --write ../outside": "task contract: /environment/write_paths must contain normalized repository-relative roots",
    "task new --goal g --acceptance a --write src/**": "task contract: /environment/write_paths must contain normalized repository-relative roots",
    "task new --goal g --acceptance a --read /etc": "task contract: /environment/read_paths",
    "task new --goal g --acceptance a --approval ../x.md": "task contract: /authorization/approval_ref",
    "task handoff --id WK-1 --summary s --pre-claim": "--pre-claim applies only to task claim with an explicit --base",
    "task show --id ../x": "is not a valid task ID",
    "status --stale-after soon": "--stale-after \"soon\": must be a positive number of hours",
    "status --stale-after 0": "must be a positive number of hours",
    "stats --report --cutoff 2026-10-19T00:00:00Z --timezone UTC --previous abc": "--previous \"abc\": must be a report fingerprint",
    "stats --report --cutoff 2026-10-19T00:00:00Z --timezone UTC --days 3": "--days \"3\": must be 7",
    "task rework --id WK-1 --summary s --mode fresh": "--mode \"fresh\": must be source or evidence-only",
    "intake apply --request b.json --fingerprint abc": "--fingerprint \"abc\": must be a preview fingerprint",
    "instructions preview --fingerprint <f>": "--fingerprint is not accepted by this form",
    "workspace show --request r.json": "--request is not accepted by this form",
    "task create --source c.json --goal g": "is not accepted by this form",
    "stats --report --cutoff 2026-10-19 --timezone UTC": "needs an ISO time with an explicit UTC offset",
    "stats --report --cutoff 2026-10-19T00:00:00Z --timezone Mars/Base": "must be an IANA time zone",
    "stats . --report --project ../a --cutoff 2026-10-19T00:00:00Z --timezone UTC": "a multi-project report takes --project or --projects-file, not a positional target",
    "stats --project ../a": "--report is required by this form",
    "monitor . --port 1": "monitor takes at most one project path",
    "workspace create --request ./workspace.json": "--request \"./workspace.json\": must be a normalized repository-relative file path",
    "task create --source /tmp/contract.json": "--source \"/tmp/contract.json\": must be a normalized repository-relative file path",
    "init --policy ../policy.json": "--policy \"../policy.json\": must be a normalized repository-relative file path",
    "task claim --id WK-1 --request a/../claim.json": "--request \"a/../claim.json\": must be a normalized repository-relative file path",
    "intake preview --request docs/*.json": "--request \"docs/*.json\": must be a normalized repository-relative file path",
    "task assess --id WK-1 --request C:/a.json": "--request \"C:/a.json\": must be a normalized repository-relative file path"
  };
  for (const [command, expected] of Object.entries(cases)) {
    const problems = validateCommand(command.split(" "));
    assert.ok(problems.some(problem => problem.includes(expected)), `${command}: ${JSON.stringify(problems)}`);
  }
});

test("valid forms, placeholders and the CLI's longer allow lists pass", () => {
  for (const command of [
    "help", "help advanced", "version", "monitor", "monitor .", "init .", "status . --stale-after 24", "doctor .",
    "task claim --id WK-1 --base 531f9fd5 --pre-claim", "task claim --id WK-1 --base <sha>", "task rework --id WK-1 --summary s --mode evidence-only", "workspace serve --request config.json", "task new --goal g --acceptance a --include src --exclude test",
    "task create --source c.json --actor builder", "task create --goal g --acceptance a", "intake apply --request b.json --fingerprint <fingerprint>",
    "stats --report --cutoff 2026-10-19T00:00:00Z --timezone UTC --days 7 --previous " + "a".repeat(64),
    "task new --goal g --acceptance a --write src/app --read . --risk standard --approval docs/approval.md --id WK-cart",
    "task new --goal <goal> --acceptance <criterion> --write <path>",
    "task claim . --id WK-1 --request claim.json", "task review . --id WK-1 --request review.json", "task close --id WK-1 --summary s --rollback <plan>", "task handoff --id WK-1 --summary s --unresolved x --claim c --revision $SHA",
    "stats --report --projects-file list.txt --cutoff ... --timezone ...", "stats --report --project a --projects-file b --cutoff 2026-10-19T00:00:00+09:00 --timezone Asia/Tokyo --strict --json",
    "task new --goal g --acceptance a --acceptance b --write docs --risk low --actor builder",
    "init --policy policy/repository-policy.json", "task create --source <contract.json> --request $REQUEST", "workspace create --request .workkeel/request.json"
  ]) assert.deepEqual(validateCommand(command.split(" ")), [], command);
  assert.ok(placeholder("<id>") && placeholder("...") && placeholder("${SHA}") && !placeholder("main"));
});

// The allow(...) flag lists of the CLI source, as sorted flag names without "--".
function sourceAllowLists() {
  const source = fs.readFileSync(path.join(root, "src/workkeel-cli.mjs"), "utf8");
  const lists = new Set();
  for (const call of source.matchAll(/allow\(\s*options\s*,([^;]*?)\)\s*;/g)) {
    for (const array of call[1].matchAll(/\[([^\[\]]*)\]/g)) {
      const items = [...array[1].matchAll(/["']([^"']*)["']/g)].map(match => match[1]);
      if (items.every(item => item.startsWith("--"))) lists.add(items.map(item => item.slice(2)).sort().join(" "));
    }
  }
  return lists;
}

test("COMMAND_FORMS uses exactly the flag lists of the CLI's allow(...) calls", () => {
  const source = sourceAllowLists(), table = new Set(COMMAND_FORMS.map(entry => [...entry.flags].sort().join(" ")));
  assert.ok(source.size >= 15, `only ${source.size} allow lists found`);
  assert.deepEqual([...table].filter(list => !source.has(list)), [], "table flag lists missing from the CLI");
  assert.deepEqual([...source].filter(list => !table.has(list)), [], "CLI allow lists missing from the table");
  for (const entry of COMMAND_FORMS) for (const flag of entry.flags)
    assert.doesNotThrow(() => parseCommandLine([`--${flag}`, ...(["json", "report", "strict", "pre-claim"].includes(flag) ? [] : ["x"])]), `--${flag}`);
});

test("every command, action and flag of `workkeel help advanced` has a form in COMMAND_FORMS", () => {
  const help = spawnSync(process.execPath, [path.join(root, "bin/workkeel.mjs"), "help", "advanced"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  const forms = helpForms(help.stdout).filter(entry => entry.command !== "monitor" && !entry.actions.includes("<operation>"));
  assert.ok(forms.length >= 40);
  for (const entry of forms) for (const action of entry.actions.length ? entry.actions : [null]) {
    const matching = COMMAND_FORMS.filter(candidate => candidate.command === entry.command && (action === null ? !candidate.actions.length : candidate.actions.includes(action)));
    assert.ok(matching.length, `${entry.command} ${action ?? ""}`);
    for (const flag of entry.flags) {
      // The help joins preview|apply under one [--fingerprint]; the CLI allows it for apply only.
      if (`${entry.command} ${action} --${flag}` === "instructions preview --fingerprint") continue;
      assert.ok(matching.some(candidate => candidate.flags.includes(flag)) || flag === "json", `${entry.command} ${action ?? ""} --${flag}`);
    }
  }
});

test("a fixture document with a broken example fails the check with its file and line", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workkeel-doc-commands-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "docs/guide"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.ja.md"), "```sh\nworkkeel task claim --id WK-1 --base HEAD\n```\n");
  fs.writeFileSync(path.join(dir, "docs/guide/a.md"), "text\n\n```sh\nworkkeel status .\n```\n");
  fs.writeFileSync(path.join(dir, "NOTES.md"), "```sh\nworkkeel frob\n```\n");
  const result = await findInvalidDocCommands(dir);
  assert.equal(result.count, 2);
  assert.deepEqual(result.failures, ["README.ja.md:2: workkeel task claim --id WK-1 --base HEAD: --base \"HEAD\": must be a full or abbreviated hexadecimal commit ID"]);
});

test("the input path check gives the same answer as the CLI's own input reader, without reading files", async () => {
  // readTaskFile checks the path before it touches the file system. With a root that does
  // not exist, an accepted path fails at realpath (ENOENT), so no named file is read.
  const missingRoot = path.join(os.tmpdir(), `workkeel-doc-commands-missing-${process.pid}-${Date.now()}`);
  assert.equal(fs.existsSync(missingRoot), false);
  const pathError = "Contract input must be a normalized repository-relative file path";
  for (const value of ["request.json", "a/b.json", "~/x.json", ".workkeel/r.json", "a b.json", "./r.json", "/tmp/c.json", "../p.json", "a/../b.json",
    "a//b.json", "a/", ".", "", " r.json", "docs/*.json", "a\\b.json", "C:/a.json", "a:b.json", "x[1].json", "{a}.json"]) {
    let rejected = false;
    try { await readTaskFile(missingRoot, value); } catch (error) { rejected = error.message === pathError; if (!rejected) assert.equal(error.code, "ENOENT", value); }
    assert.equal(inputPathValid(value), !rejected, JSON.stringify(value));
  }
});
