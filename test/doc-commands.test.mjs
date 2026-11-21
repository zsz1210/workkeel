import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseCommandLine } from "../src/workkeel-cli-flags.mjs";
import { extractDocCommands, findInvalidDocCommands, placeholder, repositoryForms, shellSegments, validateCommand, workkeelArgs } from "../scripts/check-doc-commands.mjs";

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
    "~~~"
  ].join("\n");
  assert.deepEqual(extractDocCommands(markdown), [
    { line: 3, args: ["status", "."] },
    { line: 4, args: ["stats", "--report", "--project", "../a", "--cutoff", "2026-10-19T00:00:00Z", "--timezone", "UTC"] },
    { line: 6, args: ["doctor", "."] },
    { line: 6, args: ["task", "show", ".", "--id", "WK-1"] },
    { line: 10, args: ["task", "review", "--id", "WK-1", "--summary", "a b", "--judgment", "pass"] }
  ]);
  assert.deepEqual(shellSegments(`a "b c" 'd\\e' f\\ g | h; i`), [["a", "b c", "d\\e", "f g"], ["h"], ["i"]]);
  assert.equal(workkeelArgs(["npx", "left-pad", "status"]), null);
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
    "task handoff --id WK-1": "task handoff needs --summary",
    "task handoff --id WK-1 --summary s --pre-claim": "--pre-claim applies only to task claim with an explicit --base",
    "task show --id ../x": "is not a valid task ID",
    "status --stale-after soon": "--stale-after \"soon\": must be a number of hours",
    "stats --report --cutoff 2026-10-19 --timezone UTC": "needs an ISO time with an explicit UTC offset",
    "stats --report --cutoff 2026-10-19T00:00:00Z --timezone Mars/Base": "must be an IANA time zone",
    "stats . --report --project ../a --cutoff 2026-10-19T00:00:00Z --timezone UTC": "a positional target is not accepted by this form",
    "monitor . --port 1": "monitor takes at most one project path"
  };
  for (const [command, expected] of Object.entries(cases)) {
    const problems = validateCommand(command.split(" "));
    assert.ok(problems.some(problem => problem.includes(expected)), `${command}: ${JSON.stringify(problems)}`);
  }
});

test("valid forms, placeholders and the CLI's longer allow lists pass", () => {
  for (const command of [
    "help", "help advanced", "version", "monitor", "monitor .", "init .", "status . --stale-after 24", "doctor .",
    "task claim --id WK-1 --base 531f9fd5 --pre-claim", "task claim --id WK-1 --base <sha>", "task rework --id WK-1 --summary s --mode fresh",
    "task claim . --id WK-1 --request claim.json", "task handoff --id WK-1 --summary s --unresolved x --claim c --revision $SHA",
    "stats --report --projects-file list.txt --cutoff ... --timezone ...", "stats --report --project a --projects-file b --cutoff 2026-10-19T00:00:00+09:00 --timezone Asia/Tokyo --strict --json",
    "task new --goal g --acceptance a --acceptance b --write docs --risk low --actor builder"
  ]) assert.deepEqual(validateCommand(command.split(" ")), [], command);
  assert.ok(placeholder("<id>") && placeholder("...") && placeholder("${SHA}") && !placeholder("main"));
});

test("every flag of the help forms is one the CLI parser knows", () => {
  for (const form of repositoryForms()) for (const flag of form.flags.keys()) {
    assert.doesNotThrow(() => parseCommandLine([`--${flag}`, ...(["json", "report", "strict", "pre-claim"].includes(flag) ? [] : ["x"])]), `--${flag}`);
  }
});

test("a fixture document with a broken example fails the check with its file and line", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-doc-commands-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "docs/guide"), { recursive: true });
  await fs.writeFile(path.join(root, "README.ja.md"), "```sh\nworkkeel task claim --id WK-1 --base HEAD\n```\n");
  await fs.writeFile(path.join(root, "docs/guide/a.md"), "text\n\n```sh\nworkkeel status .\n```\n");
  await fs.writeFile(path.join(root, "NOTES.md"), "```sh\nworkkeel frob\n```\n");
  const result = await findInvalidDocCommands(root, repositoryForms());
  assert.equal(result.count, 2);
  assert.deepEqual(result.failures, ["README.ja.md:2: workkeel task claim --id WK-1 --base HEAD: --base \"HEAD\": must be a full or abbreviated hexadecimal commit ID"]);
});
