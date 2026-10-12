import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCollaborationState } from "../src/collaboration.mjs";
import { applyReconciliation, assertNoPendingReconciliation, previewReconciliation, reconcileDocuments, reconciliationProjection, recoverReconciliation } from "../src/reconciliation.mjs";

const clone = value => structuredClone(value);
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "temple-field-reconcile-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  const files = [".ai-org/project/agents.json", ".ai-org/project/resources.json"];
  await fs.mkdir(path.join(root, ".ai-org/project"), { recursive: true });
  await fs.mkdir(path.join(root, ".ai-org/core/schemas"), { recursive: true });
  for (const name of ["agents", "assignments", "collaboration", "resource-registry", "work-item", "task-registry", "runtime-worker-registry", "evidence-registry"]) await fs.copyFile(new URL(`../project-overlay/.ai-org/core/schemas/${name}.schema.json`, import.meta.url), path.join(root, `.ai-org/core/schemas/${name}.schema.json`));
  const assignments = { schema_version: "temple.assignments/v1", assignments: [{ position_id: "developer", agent_id: "agent-builder", active: true }, { position_id: "independent_qa", agent_id: "agent-reviewer", active: true }] };
  const defaultAgents = ["builder", "reviewer"].map(id => ({ id: `agent-${id}`, display_name: `Fixture ${id}`, active: true, created_at: "2026-09-16T00:00:00Z" }));
  await fs.writeFile(path.join(root, ".ai-org/project/assignments.json"), JSON.stringify(assignments));
  await fs.writeFile(path.join(root, ".ai-org/project/collaboration.json"), JSON.stringify(buildCollaborationState(assignments)));
  await fs.writeFile(path.join(root, ".ai-org/project/project.json"), JSON.stringify({ schema_version: "temple.project/v1", id: "fixture", name: "Fixture" }));
  await fs.writeFile(path.join(root, ".ai-org/core/positions.json"), JSON.stringify({ positions: [{ id: "developer" }, { id: "independent_qa" }] }));
  const write = (file, records) => fs.writeFile(path.join(root, file), JSON.stringify(file.endsWith("/agents.json")
    ? { schema_version: "temple.agents/v1", naming_mode: "manual", agents: [...defaultAgents, ...records.map(record => ({ id: `agent-${record.id}`, display_name: `Fixture ${record.id} ${String(record.value).replace(/[0-9]/g, digit => String.fromCharCode(65 + Number(digit)))}`, active: true, created_at: "2026-09-16T00:00:00Z" }))] }
    : { schema_version: "temple.resources/v1", reservations: [], resources: records.map(record => ({ id: record.id, display_name: record.id, capacity: 1, description: `Value ${record.value}`, active: true })) }) + "\n");
  for (const file of files) await write(file, [{ id: "base", value: 1 }]);
  git("add", "."); git("commit", "-qm", "base");
  const baseRevision = git("rev-parse", "HEAD");
  for (const file of files) await write(file, [{ id: "base", value: 1 }, { id: "incoming", value: 2 }]);
  git("add", "."); git("commit", "-qm", "incoming");
  const incomingRevision = git("rev-parse", "HEAD");
  git("checkout", "--detach", baseRevision);
  for (const file of files) await write(file, [{ id: "base", value: 1 }, { id: "local", value: 3 }]);
  return { root, git, files, write, baseRevision, incomingRevision, options: { baseRevision, incomingRevision, paths: files } };
}

async function claimFixture(t, change, { claimStatus = "active" } = {}) {
  const result = await fixture(t);
  const { root, git } = result;
  git("reset", "--hard", result.baseRevision);
  const paths = [".ai-org/project/agents.json", ".ai-org/project/collaboration.json"];
  const agents = JSON.parse(await fs.readFile(path.join(root, paths[0]), "utf8"));
  const collaboration = JSON.parse(await fs.readFile(path.join(root, paths[1]), "utf8"));
  collaboration.profile = "collaborative";
  collaboration.actor_policy.ordinary_development = "verified";
  collaboration.principals.push({ id: "principal-fixture", display_name: "Fixture contributor", status: "active", active: true,
    provider_identities: [], created_at: null, updated_at: null });
  collaboration.sponsorships.push({ principal_id: "principal-fixture", agent_id: "agent-base", status: "active", active: true, created_at: null, ended_at: null });
  collaboration.memberships.push({ ...clone(collaboration.memberships.find(member => member.agent_id === "agent-builder")), agent_id: "agent-base", default: false });
  const itemFile = ".ai-org/work-items/WI-0001.json";
  const claim = { id: "ordinary-claim", agent_id: "agent-base", principal_id: "principal-fixture", position_id: "developer", status: claimStatus };
  const item = { id: "WI-0001", state: claimStatus === "active" ? "build" : "done", owner_position: "developer", workflow_profile: "standard", risk_tier: "standard",
    required_disciplines: ["quality"], stage_requirements: { build: { disciplines: ["general-development"] } }, claim, claims: [clone(claim)] };
  await fs.mkdir(path.join(root, ".ai-org/work-items"), { recursive: true });
  await fs.writeFile(path.join(root, itemFile), JSON.stringify(item));
  const writeIdentities = async () => {
    await fs.writeFile(path.join(root, paths[0]), JSON.stringify(agents));
    await fs.writeFile(path.join(root, paths[1]), JSON.stringify(collaboration));
  };
  await writeIdentities();
  git("add", "."); git("commit", "-qm", "Ordinary claim without a runtime or task");
  const baseRevision = git("rev-parse", "HEAD");
  change(agents, collaboration);
  await writeIdentities();
  git("add", "."); git("commit", "-qm", "Incoming identity change");
  const incomingRevision = git("rev-parse", "HEAD");
  git("checkout", "--detach", baseRevision);
  return { root, item, itemFile, paths, options: { baseRevision, incomingRevision, paths } };
}

const removeClaimant = (agents, collaboration) => {
  agents.agents = agents.agents.filter(agent => agent.id !== "agent-base");
  collaboration.memberships = collaboration.memberships.filter(member => member.agent_id !== "agent-base");
  collaboration.sponsorships = collaboration.sponsorships.filter(sponsor => sponsor.agent_id !== "agent-base");
};

test("V10: stable IDs reconcile independent changes/additions and preserve exact distinct event histories deterministically", () => {
  const base = { agents: [{ id: "A", value: 1 }, { id: "B", value: 1 }] };
  const local = clone(base); local.agents[0].value = 2; local.agents.push({ id: "C", value: 3 });
  const incoming = clone(base); incoming.agents[1].value = 4; incoming.agents.push({ id: "D", value: 5 });
  const result = reconcileDocuments(base, local, incoming);
  assert.equal(result.valid, true);
  assert.deepEqual(result.merged.agents.map(value => [value.id, value.value]), [["A", 2], ["B", 4], ["C", 3], ["D", 5]]);
  const original = [{ timestamp: "same", event_type: "original" }];
  const events = reconcileDocuments(original, [...original, { timestamp: "same", event_type: "local" }], [...original, { timestamp: "same", event_type: "incoming" }], { kind: "events" });
  assert.equal(events.valid, true);
  assert.equal(events.merged.length, 3);
  assert.deepEqual(events.merged, reconcileDocuments(original, [...original, { timestamp: "same", event_type: "incoming" }], [...original, { timestamp: "same", event_type: "local" }], { kind: "events" }).merged);
  const view = { ".ai-org/project/agents.json": result.merged, ".ai-org/views/fake.json": { state: "done" } };
  assert.deepEqual(reconciliationProjection(view), reconciliationProjection(clone(view)));
  assert.equal(reconciliationProjection(view).records.length, 1);
});

test("V10/V12: divergent stable IDs, deletion/modification, lifecycle/claims and rewritten history are explicit conflicts", () => {
  const base = { entries: [{ id: "evidence", sha256: "original" }] };
  const local = { entries: [{ id: "evidence", sha256: "local" }] };
  const incoming = { entries: [{ id: "evidence", sha256: "incoming" }] };
  assert.equal(reconcileDocuments(base, local, incoming).valid, false);
  assert.match(reconcileDocuments(base, { entries: [] }, incoming).conflicts[0].reason, /deletion/);
  const item = { id: "WI-0001", state: "build", claim: null };
  assert.equal(reconcileDocuments(item, { ...item, state: "test", claim: { id: "claim-a" } }, { ...item, state: "qa", claim: { id: "claim-b" } }).valid, false);
  assert.equal(reconcileDocuments(base, base, { entries: [...base.entries, ...base.entries] }).valid, false);
  const events = [{ id: "event-1", message: "original" }];
  assert.equal(reconcileDocuments(events, [], events, { kind: "events" }).valid, false);
  assert.equal(reconcileDocuments(events, events, [{ id: "event-1", message: "rewritten" }], { kind: "events" }).valid, false);
  const legacy = [{ timestamp: "legacy", message: "no stable ID" }];
  assert.equal(reconcileDocuments(legacy, [...legacy, { id: "new", message: "left" }], [...legacy, { id: "new", message: "right" }], { kind: "events" }).valid, false);
});

test("V10: membership and assignment keys preserve independent Agent identities", () => {
  const base = { memberships: [] };
  const local = { memberships: [{ position_id: "developer", agent_id: "a", status: "active" }] };
  const incoming = { memberships: [{ position_id: "developer", agent_id: "b", status: "active" }] };
  assert.equal(reconcileDocuments(base, local, incoming).merged.memberships.length, 2);
  const assignments = { assignments: [{ position_id: "developer", agent_id: "base" }] };
  assert.equal(reconcileDocuments(assignments, { assignments: [{ position_id: "developer", agent_id: "a" }] }, { assignments: [{ position_id: "developer", agent_id: "b" }] }).valid, false);
});

test("V10: independent additions cannot synthesize competing ownership or Developer/QA identity collision", () => {
  const defaults = reconcileDocuments({ memberships: [] }, { memberships: [{ position_id: "developer", agent_id: "a", default: true }] },
    { memberships: [{ position_id: "developer", agent_id: "b", default: true }] });
  assert.equal(defaults.valid, false);
  assert.match(defaults.conflicts[0].reason, /competing-active-defaults/);
  const base = { assignments: [{ position_id: "developer", agent_id: "a" }, { position_id: "independent_qa", agent_id: "b" }] };
  const local = clone(base); local.assignments[0].agent_id = "shared";
  const incoming = clone(base); incoming.assignments[1].agent_id = "shared";
  assert.match(reconcileDocuments(base, local, incoming).conflicts[0].reason, /identity-collision/);
  const worker = { work_item_id: "WI-0001", position_id: "developer", status: "active" };
  assert.match(reconcileDocuments({ workers: [] }, { workers: [{ ...worker, id: "left" }] }, { workers: [{ ...worker, id: "right" }] }).conflicts[0].reason, /competing-active-workers/);
});

test("V10/V12: stale preview cannot partially apply; fresh apply recomputes bytes and invalidates generated views", async t => {
  const { root, options, files, write } = await fixture(t);
  const preview = await previewReconciliation(root, { ...options, paths: [...options.paths, ".ai-org/views/status.md"] });
  assert.equal(preview.valid, true, JSON.stringify({ errors: preview.errors, conflicts: preview.conflicts }));
  assert.deepEqual(preview.ignored_generated_paths, [".ai-org/views/status.md"]);
  const original = await fs.readFile(path.join(root, files[0]), "utf8");
  await write(files[1], [{ id: "new-local", value: 9 }]);
  const stale = await applyReconciliation(root, preview);
  assert.equal(stale.valid, false);
  assert.equal(stale.code, "RECONCILIATION_STALE_PREVIEW");
  assert.equal(stale.mutation_performed, false);
  assert.equal(await fs.readFile(path.join(root, files[0]), "utf8"), original);
  const fresh = await previewReconciliation(root, options);
  assert.equal(fresh.valid, true);
  fresh.changes[0].after = '{"fake":"acceptance"}';
  const applied = await applyReconciliation(root, fresh);
  assert.equal(applied.valid, true, applied.errors.join(";"));
  assert.equal(applied.views_rebuild_required, true);
  assert.equal(applied.acceptance_granted, false);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, files[0]), "utf8")).fake, undefined);
  assert.equal((await applyReconciliation(root, fresh)).code, "RECONCILIATION_STALE_PREVIEW");
});

test("V10: divergent input is never partially applied and unsafe paths/symlinks are refused", async t => {
  const { root, options, files, write } = await fixture(t);
  await write(files[0], [{ id: "incoming", value: "divergent" }]);
  const preview = await previewReconciliation(root, options);
  assert.equal(preview.valid, false);
  const before = await fs.readFile(path.join(root, files[1]), "utf8");
  assert.equal((await applyReconciliation(root, preview)).valid, false);
  assert.equal(await fs.readFile(path.join(root, files[1]), "utf8"), before);
  assert.equal((await previewReconciliation(root, { ...options, paths: ["../outside.json"] })).valid, false);
  await fs.unlink(path.join(root, files[0]));
  await fs.symlink(path.join(root, files[1]), path.join(root, files[0]));
  assert.equal((await previewReconciliation(root, options)).valid, false);
});

test("V10: schema-invalid merged records and broken combined identity references fail before writes", async t => {
  const { root, options, files } = await fixture(t);
  const before = await fs.readFile(path.join(root, files[0]), "utf8");
  const resource = JSON.parse(await fs.readFile(path.join(root, files[1]), "utf8"));
  resource.resources.find(entry => entry.id === "local").capacity = -1;
  await fs.writeFile(path.join(root, files[1]), JSON.stringify(resource));
  const invalidSchema = await previewReconciliation(root, options);
  assert.equal(invalidSchema.valid, false);
  assert.ok(invalidSchema.conflicts.some(entry => entry.reason.startsWith("schema-invalid:")));
  assert.equal((await applyReconciliation(root, invalidSchema)).mutation_performed, false);
  assert.equal(await fs.readFile(path.join(root, files[0]), "utf8"), before);
  resource.resources.find(entry => entry.id === "local").capacity = 1;
  await fs.writeFile(path.join(root, files[1]), JSON.stringify(resource));
  const agents = JSON.parse(before);
  agents.agents = agents.agents.filter(entry => entry.id !== "agent-reviewer");
  await fs.writeFile(path.join(root, files[0]), JSON.stringify(agents));
  const invalidIdentity = await previewReconciliation(root, options);
  assert.equal(invalidIdentity.valid, false);
  assert.ok(invalidIdentity.conflicts.some(entry => /combined-(identity|collaboration)-invalid/.test(entry.reason)));
});

test("V10/V12: schema and unchanged identity inputs participate in freshness; current runtime ownership is checked", async t => {
  const { root, options, files } = await fixture(t);
  const preview = await previewReconciliation(root, options);
  assert.equal(preview.valid, true, JSON.stringify(preview));
  assert.ok(preview.validation_inputs.some(([file]) => file.endsWith("agents.schema.json")));
  assert.ok(preview.validation_inputs.some(([file]) => file.endsWith("collaboration.json")));
  const projectFile = path.join(root, ".ai-org/project/project.json");
  const project = JSON.parse(await fs.readFile(projectFile, "utf8"));
  project.name = "A new current project name";
  await fs.writeFile(projectFile, JSON.stringify(project));
  assert.equal((await applyReconciliation(root, preview)).code, "RECONCILIATION_STALE_PREVIEW");
  const before = await fs.readFile(path.join(root, files[0]), "utf8");
  await fs.mkdir(path.join(root, ".ai-org/work-items"), { recursive: true });
  await fs.writeFile(path.join(root, ".ai-org/work-items/WI-0001.json"), JSON.stringify({ id: "WI-0001", owner_position: "developer", claim: { id: "current", agent_id: "agent-builder", principal_id: "human", status: "active" } }));
  await fs.writeFile(path.join(root, ".ai-org/project/runtime-workers.json"), JSON.stringify({ workers: [{ id: "worker-conflict", work_item_id: "WI-0001", position_id: "developer", agent_id: "agent-builder", principal_id: "human", claim_id: "old-claim", status: "active" }] }));
  const current = await previewReconciliation(root, options);
  assert.equal(current.valid, false);
  assert.ok(current.conflicts.some(entry => entry.reason === "worker-current-ownership-conflict"));
  assert.equal((await applyReconciliation(root, current)).mutation_performed, false);
  assert.equal(await fs.readFile(path.join(root, files[0]), "utf8"), before);
});

test("V10: identity-only reconciliation cannot orphan an unchanged ordinary claim without a worker or task", async t => {
  const { root, itemFile, options, paths } = await claimFixture(t, removeClaimant);
  const before = await Promise.all(paths.map(file => fs.readFile(path.join(root, file), "utf8")));
  const preview = await previewReconciliation(root, options);
  assert.equal(preview.valid, false, JSON.stringify(preview));
  assert.ok(preview.conflicts.some(entry => entry.file === itemFile && entry.reason === "active-claim-agent-unavailable"));
  assert.ok(preview.validation_inputs.some(([file]) => file === itemFile));
  assert.ok(preview.validation_inputs.some(([file]) => file === ".ai-org/work-items/"));
  assert.equal((await applyReconciliation(root, preview)).mutation_performed, false);
  assert.deepEqual(await Promise.all(paths.map(file => fs.readFile(path.join(root, file), "utf8"))), before);
});

test("V10: unchanged active claims retain shared sponsor, Principal and current qualification requirements", async t => {
  const cases = [
    ["membership revocation", (_, collaboration) => { collaboration.memberships.find(member => member.agent_id === "agent-base").status = "revoked"; }],
    ["expired qualification", (_, collaboration) => { collaboration.memberships.find(member => member.agent_id === "agent-base").qualification.expires_at = "2000-01-01T00:00:00Z"; }],
    ["insufficient risk ceiling", (_, collaboration) => { collaboration.memberships.find(member => member.agent_id === "agent-base").qualification.risk_ceiling = "low"; }],
    ["missing current stage discipline", (_, collaboration) => { collaboration.memberships.find(member => member.agent_id === "agent-base").disciplines = []; }],
    ["inactive sponsorship", (_, collaboration) => { collaboration.sponsorships[0].status = "inactive"; collaboration.sponsorships[0].active = false; }],
    ["inactive Principal", (_, collaboration) => { collaboration.principals[0].status = "inactive"; collaboration.principals[0].active = false; }]
  ];
  for (const [name, change] of cases) await t.test(name, async t => {
    const { root, options, itemFile, paths } = await claimFixture(t, change);
    const before = await Promise.all(paths.map(file => fs.readFile(path.join(root, file), "utf8")));
    const preview = await previewReconciliation(root, options);
    assert.equal(preview.valid, false, JSON.stringify(preview));
    assert.ok(preview.conflicts.some(entry => entry.file === itemFile && entry.reason === "active-claim-actor-ineligible"), JSON.stringify(preview.conflicts));
    assert.equal((await applyReconciliation(root, preview)).mutation_performed, false);
    assert.deepEqual(await Promise.all(paths.map(file => fs.readFile(path.join(root, file), "utf8"))), before);
  });
});

test("V10: released terminal claim history survives identity removal without becoming a live qualification gate", async t => {
  const { root, options, itemFile } = await claimFixture(t, removeClaimant, { claimStatus: "released" });
  const before = await fs.readFile(path.join(root, itemFile), "utf8");
  const preview = await previewReconciliation(root, options);
  assert.equal(preview.valid, true, JSON.stringify(preview));
  assert.equal((await applyReconciliation(root, preview)).valid, true);
  assert.equal(await fs.readFile(path.join(root, itemFile), "utf8"), before);
});

test("V10: reconciliation does not infer a missing team claimant Principal from current sponsorship", async t => {
  const { root, options, item, itemFile } = await claimFixture(t, agents => { agents.agents[0].display_name = "Updated builder label"; });
  item.claim.principal_id = null;
  item.claims = [clone(item.claim)];
  await fs.writeFile(path.join(root, itemFile), JSON.stringify(item));
  const preview = await previewReconciliation(root, options);
  assert.equal(preview.valid, false, JSON.stringify(preview));
  assert.ok(preview.conflicts.some(entry => entry.reason === "active-claim-principal-unattributed"));
  assert.equal((await applyReconciliation(root, preview)).mutation_performed, false);
});

test("V10/V12: a new or newly active unchanged claim invalidates an identity-removal preview before writes", async t => {
  for (const mode of ["existing item gains a claim", "new Work Item gains a claim"]) await t.test(mode, async t => {
    const { root, options, item, itemFile, paths } = await claimFixture(t, removeClaimant, { claimStatus: "released" });
    const preview = await previewReconciliation(root, options);
    assert.equal(preview.valid, true, JSON.stringify(preview));
    const before = await Promise.all(paths.map(file => fs.readFile(path.join(root, file), "utf8")));
    item.state = "build";
    item.claim.status = "active";
    item.claims = [clone(item.claim)];
    if (mode.startsWith("new")) item.id = "WI-0002";
    await fs.writeFile(path.join(root, mode.startsWith("new") ? ".ai-org/work-items/WI-0002.json" : itemFile), JSON.stringify(item));
    const fresh = await previewReconciliation(root, options);
    assert.equal(fresh.valid, false, JSON.stringify(fresh));
    const stale = await applyReconciliation(root, preview);
    assert.equal(stale.code, "RECONCILIATION_STALE_PREVIEW");
    assert.equal(stale.mutation_performed, false);
    assert.deepEqual(await Promise.all(paths.map(file => fs.readFile(path.join(root, file), "utf8"))), before);
  });
});

test("V10/V12: inventory additions and changed eligible claim bytes invalidate otherwise valid identity previews", async t => {
  const { root, options, item, itemFile, paths } = await claimFixture(t, agents => { agents.agents[0].display_name = "Updated builder label"; });
  let preview = await previewReconciliation(root, options);
  // Verified policy does not require this read-only validator to log in; this
  // actual actor is still qualified for its stage, risk, membership and sponsor.
  assert.equal(preview.valid, true, JSON.stringify(preview));
  const before = await Promise.all(paths.map(file => fs.readFile(path.join(root, file), "utf8")));
  item.claim.id = "replacement-claim";
  item.claims = [clone(item.claim)];
  await fs.writeFile(path.join(root, itemFile), JSON.stringify(item));
  let fresh = await previewReconciliation(root, options);
  assert.equal(fresh.valid, true, JSON.stringify(fresh));
  assert.notEqual(fresh.fingerprint, preview.fingerprint);
  assert.equal((await applyReconciliation(root, preview)).code, "RECONCILIATION_STALE_PREVIEW");
  preview = fresh;
  await fs.writeFile(path.join(root, ".ai-org/work-items/WI-0002.json"), JSON.stringify({ id: "WI-0002", state: "done", claim: null }));
  fresh = await previewReconciliation(root, options);
  assert.equal(fresh.valid, true, JSON.stringify(fresh));
  assert.notEqual(fresh.fingerprint, preview.fingerprint);
  assert.equal((await applyReconciliation(root, preview)).code, "RECONCILIATION_STALE_PREVIEW");
  assert.deepEqual(await Promise.all(paths.map(file => fs.readFile(path.join(root, file), "utf8"))), before);
});

test("V10: unchanged Work Item inventory refuses symlinks, oversized files and unbounded entries", async t => {
  const { root, options, itemFile } = await claimFixture(t, agents => { agents.agents[0].display_name = "Updated builder label"; });
  const itemBytes = await fs.readFile(path.join(root, itemFile), "utf8");
  await fs.unlink(path.join(root, itemFile));
  await fs.symlink(path.join(root, ".ai-org/project/agents.json"), path.join(root, itemFile));
  let preview = await previewReconciliation(root, options);
  assert.equal(preview.code, "RECONCILIATION_INPUT_INVALID");
  assert.match(preview.errors[0], /Unsafe Work Item/);
  await fs.unlink(path.join(root, itemFile));
  await fs.writeFile(path.join(root, itemFile), " ".repeat(4 * 1024 * 1024 + 1));
  preview = await previewReconciliation(root, options);
  assert.equal(preview.code, "RECONCILIATION_INPUT_INVALID");
  assert.match(preview.errors[0], /Invalid validation input/);
  await fs.writeFile(path.join(root, itemFile), itemBytes);
  const itemDirectory = path.join(root, ".ai-org/work-items");
  await fs.rename(itemDirectory, `${itemDirectory}-outside`);
  await fs.symlink(`${itemDirectory}-outside`, itemDirectory);
  preview = await previewReconciliation(root, options);
  assert.equal(preview.code, "RECONCILIATION_INPUT_INVALID");
  assert.match(preview.errors[0], /Unsafe Work Item validation directory/);
  await fs.unlink(itemDirectory);
  await fs.rename(`${itemDirectory}-outside`, itemDirectory);
  t.mock.method(fs, "opendir", async () => (async function* () {
    for (let index = 0; index < 10001; index++) yield { name: `ignored-${index}`, isFile: () => true, isDirectory: () => false };
  })());
  preview = await previewReconciliation(root, options);
  assert.equal(preview.code, "RECONCILIATION_INPUT_INVALID");
  assert.match(preview.errors[0], /inventory exceeds 10000/);
  assert.equal(preview.mutation_performed, false);
});

test("V12: a real process interruption after one canonical rename is recoverable without partial remaining state", async t => {
  const { root, options, files } = await fixture(t);
  const before = await Promise.all(files.map(file => fs.readFile(path.join(root, file), "utf8")));
  const moduleUrl = new URL("../src/reconciliation.mjs", import.meta.url).href;
  const script = `import fs from 'node:fs/promises'; import {applyReconciliation,previewReconciliation} from ${JSON.stringify(moduleUrl)};
    const rename=fs.rename; fs.rename=async(from,to)=>{await rename(from,to);if(to===${JSON.stringify(path.join(root, files[0]))})process.kill(process.pid,'SIGKILL');};
    await applyReconciliation(${JSON.stringify(root)},await previewReconciliation(${JSON.stringify(root)},${JSON.stringify(options)}));`;
  const interrupted = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(interrupted.signal, "SIGKILL", interrupted.stderr);
  assert.notEqual(await fs.readFile(path.join(root, files[0]), "utf8"), before[0]);
  await assert.rejects(assertNoPendingReconciliation(root), /needs recovery/);
  const inspection = await recoverReconciliation(root);
  assert.equal(inspection.code, "RECONCILIATION_RECOVERY_REQUIRED");
  const recovered = await recoverReconciliation(root, { action: "rollback", transactionId: inspection.transaction_id });
  assert.equal(recovered.valid, true, recovered.errors.join(";"));
  assert.equal(recovered.mutation_status, "rolled-back");
  assert.deepEqual(await Promise.all(files.map(file => fs.readFile(path.join(root, file), "utf8"))), before);
  await assertNoPendingReconciliation(root);
});

test("V12: interrupted apply preserves intervening edits and refuses unsafe recovery", async t => {
  const { root, options, files } = await fixture(t);
  const originalRename = fs.rename;
  let firstWritten = false;
  t.mock.method(fs, "rename", async (from, to) => {
    if (to === path.join(root, files[1])) {
      await fs.writeFile(path.join(root, files[0]), '{"user":"intervening edit"}');
      throw new Error("injected second-file failure");
    }
    await originalRename(from, to);
    if (to === path.join(root, files[0])) firstWritten = true;
  });
  const preview = await previewReconciliation(root, options);
  const result = await applyReconciliation(root, preview);
  assert.equal(firstWritten, true);
  assert.equal(result.code, "RECONCILIATION_PENDING_RECOVERY");
  t.mock.restoreAll();
  const recovery = await recoverReconciliation(root, { action: "rollback", transactionId: result.transaction_id });
  assert.equal(recovery.valid, false);
  assert.match(recovery.errors[0], /Recovery conflict/);
  assert.equal(await fs.readFile(path.join(root, files[0]), "utf8"), '{"user":"intervening edit"}');
});
