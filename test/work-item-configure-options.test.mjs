import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function run(args) {
  return spawnSync(process.execPath, [path.join(root, "bin/temple.mjs"), ...args], { encoding: "utf8" });
}
function ok(args) {
  const result = run(args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
async function snapshot(directory, prefix = "") {
  const result = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push([relative, "directory"]);
      result.push(...await snapshot(absolute, relative));
    } else result.push([relative, await fs.readFile(absolute)]);
  }
  return result;
}
async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "temple-configure-options-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, "product");
  const config = path.join(temporary, "init.json");
  const roles = [
    ["Manager", ["engineering_manager", "release_manager", "observer"]],
    ["Product", ["product_manager", "ux_designer", "ui_designer"]],
    ["Architect", ["tech_lead"]], ["Developer", ["developer"]],
    ["Reviewer", ["quality_evaluator", "independent_qa"]]
  ];
  await fs.writeFile(config, JSON.stringify({ schema_version: "temple.init/v1", project: { id: "configure-test", name: "Configure test" }, naming_mode: "manual", agents: roles.map(([name, positions]) => ({ display_name: name, positions })) }));
  ok(["init", target, "--config", config]);
  const { item } = JSON.parse(ok(["work-item", "create", target, "--title", "Configure safely", "--scope", "Bounded fixture", "--acceptance", "Options are honored", "--affected-path", "src/original.mjs", "--ui-mode", "not-applicable", "--json"]));
  return { target, id: item.id, args: ["work-item", "configure", target, "--work-item", item.id] };
}

test("configure rejects unsupported value and boolean options without changing any project files", async t => {
  const f = await fixture(t);
  const before = await snapshot(f.target);
  for (const extra of [
    ["--affected-path", "src/new.mjs"], ["--context-ref", "docs/new.md"],
    ["--title", "Silently ignored"], ["--principal-id", "unexpected"],
    ["--dry-run"], ["--no-write"], ["--same-scope"],
    ["--base-revision", "should-not-change", "--affected-path", "src/new.mjs"],
    ["--affected-path", "src/new.mjs", "--base-revision", "should-not-change"]
  ]) {
    const result = run([...f.args, ...extra, "--json"]);
    assert.notEqual(result.status, 0, `Accepted unsupported request: ${extra.join(" ")}`);
    const offending = extra.find(flag => ["--affected-path", "--context-ref", "--title", "--principal-id", "--dry-run", "--no-write", "--same-scope"].includes(flag));
    assert.ok(result.stderr.includes(`Unsupported work-item configure option: ${offending}`), result.stderr);
    assert.match(result.stderr, /--help/);
    const error = JSON.parse(result.stdout);
    assert.equal(error.code, "INVALID_INPUT");
    assert.equal(error.mutation_status, "not_started");
    assert.equal(error.automatic_retry, false);
    assert.deepEqual(await snapshot(f.target), before);
  }
});

test("configure preserves valid JSON/text updates, repeated fields and clearing flags", async t => {
  const f = await fixture(t);
  const result = JSON.parse(ok([...f.args, "--base-revision", "candidate-ref", "--actor", "human", "--ui-mode", "not-applicable", "--spec-mode", "gate-evidence", "--shared-contract-ref", "src/a.mjs", "--shared-contract-ref", "src/b.mjs", "--contract-status", "not_required", "--replace-spec-refs", "--replace-ux-refs", "--replace-ui-refs", "--replace-contract-refs", "--clear-disciplines", "--json"]));
  assert.equal(result.item.base_revision, "candidate-ref");
  assert.deepEqual(result.item.shared_contract_refs, ["src/a.mjs", "src/b.mjs"]);
  for (const key of ["spec_refs", "ux_refs", "ui_refs", "contract_refs", "required_disciplines"]) assert.deepEqual(result.item[key], []);
  assert.deepEqual(result.item.affected_paths, ["src/original.mjs"]);
  assert.match(ok([...f.args, "--base-revision", "next-ref"]), /Configured WI-/);
  const persisted = JSON.parse(await fs.readFile(path.join(f.target, ".ai-org/work-items", `${f.id}.json`), "utf8"));
  assert.equal(persisted.base_revision, "next-ref");
});

test("configure validates unsupported options before target access, while help stays read-only", async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "temple-configure-no-target-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, "absent");
  const result = run(["work-item", "configure", target, "--work-item", "WI-0001", "--affected-path", "src"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported work-item configure option: --affected-path/);
  assert.match(ok(["work-item", "configure", target, "--help"]), /temple work-item configure/);
  const unknown = run(["work-item", "configure", target, "--not-a-temple-option"]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown option/);
  assert.deepEqual(await fs.readdir(temporary), []);
});
