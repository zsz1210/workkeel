import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildFederatedPortfolio,
  compositeWorkItemReference,
  parseCompositeWorkItemReference,
  readFederationRegistry,
  validateFederationRegistry
} from "../src/federation.mjs";

const OBSERVED_AT = "2026-08-30T00:00:00.000Z";
const NOW = new Date("2026-08-30T00:05:00.000Z");

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function git(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: OBSERVED_AT, GIT_COMMITTER_DATE: OBSERVED_AT }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function gitWithReplacementObjects(target, args) {
  const env = { ...process.env, GIT_AUTHOR_DATE: OBSERVED_AT, GIT_COMMITTER_DATE: OBSERVED_AT };
  delete env.GIT_NO_REPLACE_OBJECTS;
  const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function createRepository(target, options) {
  await fs.mkdir(path.join(target, ".ai-org/project"), { recursive: true });
  await fs.mkdir(path.join(target, ".ai-org/core"), { recursive: true });
  await fs.mkdir(path.join(target, ".ai-org/work-items"), { recursive: true });
  await writeJson(path.join(target, "temple.lock"), {
    schema_version: "temple.lock/v1",
    template: { version: "0.1.0-alpha.27" },
    project_id: options.lockProjectId ?? options.projectId,
    credential: "must-never-be-projected"
  });
  await writeJson(path.join(target, ".ai-org/project/project.json"), {
    schema_version: "temple.project/v1",
    id: options.documentProjectId ?? options.projectId,
    name: options.name ?? options.projectId,
    initialized_at: OBSERVED_AT
  });
  await writeJson(path.join(target, ".ai-org/core/workflow.json"), {
    schema_version: "temple.workflow/v1",
    initial_state: "intake",
    terminal_states: ["done", "cancelled"],
    states: [
      { id: "intake", owner_position: "engineering_manager" },
      { id: "build", owner_position: "developer" },
      { id: "done", owner_position: "engineering_manager" },
      { id: "cancelled", owner_position: "engineering_manager" }
    ],
    transitions: [],
    escape_transitions: []
  });
  for (const item of options.workItems ?? []) {
    const value = {
      schema_version: "temple.work-item/v1",
      id: item.id,
      title: item.title ?? item.id,
      state: item.state ?? "build",
      owner_position: "developer",
      updated_at: OBSERVED_AT,
      assigned_agent_id: "secret-agent",
      evidence: ["raw-evidence-body"],
      gate_evidence: { approval: ["raw-approval-body"] },
      claim: { principal_id: "human-secret" },
      scope: ["confidential business-source body"],
      risk_tier: item.riskTier,
      spec_refs: [{ id: "SPEC-1", revision: "v1" }],
      ux_refs: [],
      ui_refs: [],
      contract_refs: item.contractRefs ?? []
    };
    await writeJson(path.join(target, `.ai-org/work-items/${item.id}.json`), value);
  }
  if (options.signals) {
    await writeJson(path.join(target, ".ai-org/project/resources.json"), {
      schema_version: "temple.resources/v1",
      resources: [
        { id: "ios-simulator", display_name: "iOS Simulator", capacity: 3, description: "fixture", active: true }
      ],
      reservations: [
        {
          id: "reservation-1",
          resource_id: "ios-simulator",
          units: 1,
          worker_id: "worker-secret",
          work_item_id: "WI-0001",
          status: "active",
          reserved_at: OBSERVED_AT,
          released_at: null
        }
      ]
    });
    await writeJson(path.join(target, ".ai-org/project/evidence.json"), {
      schema_version: "temple.evidence/v1",
      entries: [
        {
          id: "EVID-20260830T000000Z-AAAAAAAA",
          work_item_id: "WI-0001",
          kind: "test",
          title: "evidence-secret-title",
          outcome: "pass",
          summary: "evidence-secret-summary",
          details: { raw: "evidence-secret-detail" },
          artifacts: [{ path: "secret/path", sha256: "d".repeat(64) }],
          recorded_by: "human-secret-principal",
          recorded_at: OBSERVED_AT,
          observed_at: OBSERVED_AT,
          expires_at: null,
          invalidated_at: null,
          invalidated_by: null,
          invalidation_reason: null,
          external_action_performed: false
        }
      ]
    });
    await writeJson(path.join(target, ".ai-org/views/usage-baseline.json"), {
      schema_version: "temple.usage-baseline/v1",
      generated_at: OBSERVED_AT,
      project: { id: options.projectId, name: options.name ?? options.projectId },
      baseline_status: "observed",
      source: { observations: 2, provider_payload: "usage-secret-payload" },
      totals: { total_tokens: 123, monetary_cost: "usage-secret-cost" }
    });
  }
  if (options.invalidWorkItem) {
    await fs.writeFile(path.join(target, ".ai-org/work-items/WI-9999.json"), "{not-json\n");
  }
  git(target, ["init", "-q"]);
  git(target, ["config", "user.email", "federation-tests@example.invalid"]);
  git(target, ["config", "user.name", "Federation Tests"]);
  git(target, ["add", "."]);
  git(target, ["commit", "-qm", "fixture"]);
  return git(target, ["rev-parse", "HEAD"]);
}

function participant(id, repositoryPath, revision, overrides = {}) {
  return {
    id,
    path: repositoryPath,
    expected_project_id: id,
    expected_revision: revision,
    expected_revision_observed_at: OBSERVED_AT,
    ...overrides
  };
}

function registry(participants, overrides = {}) {
  return {
    schema_version: "temple.federation/v1",
    participants,
    initiatives: [],
    dependencies: [],
    contracts: [],
    rollout_waves: [],
    updated_at: OBSERVED_AT,
    ...overrides
  };
}

async function fixture(testContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-federation-test-"));
  const coordinator = path.join(root, "coordination");
  await fs.mkdir(path.join(coordinator, ".ai-org/project"), { recursive: true });
  testContext.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, coordinator };
}

async function contentDigest(target) {
  const hash = crypto.createHash("sha256");
  async function visit(current, relative = "") {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      const stat = await fs.lstat(absolute);
      hash.update(`${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"}:${childRelative}:${stat.mode}\0`);
      if (entry.isDirectory()) await visit(absolute, childRelative);
      else if (entry.isSymbolicLink()) hash.update(await fs.readlink(absolute));
      else hash.update(await fs.readFile(absolute));
    }
  }
  await visit(target);
  return hash.digest("hex");
}

test("composite references reject bare or unpinned Work Item identity", () => {
  const revision = "a".repeat(40);
  assert.deepEqual(compositeWorkItemReference("orders", "WI-0001", revision), {
    project_id: "orders",
    work_item_id: "WI-0001",
    revision
  });
  assert.throws(() => parseCompositeWorkItemReference("WI-0001"), /bare Work Item IDs/);
  assert.throws(
    () => parseCompositeWorkItemReference({ project_id: "orders", work_item_id: "WI-0001" }),
    /exact source revision/
  );
});

test("registry validation rejects secret-bearing fields, stale refs, and incompatible changes without waves", () => {
  const revision = "b".repeat(40);
  const base = registry([participant("orders", "../orders", revision)]);
  assert.deepEqual(validateFederationRegistry(base), { valid: true, errors: [] });

  const secretBearing = structuredClone(base);
  secretBearing.credentials = { token: "secret" };
  assert.equal(validateFederationRegistry(secretBearing).valid, false);

  const renamedParticipant = structuredClone(base);
  renamedParticipant.participants[0].id = "orders-alias";
  assert.match(validateFederationRegistry(renamedParticipant).errors.join("\n"), /immutable project ID/);

  const bareReference = structuredClone(base);
  bareReference.initiatives.push({ id: "checkout", version: "1", revision: "1", work_items: ["WI-0001"] });
  assert.match(validateFederationRegistry(bareReference).errors.join("\n"), /bare Work Item IDs/);

  const staleReference = structuredClone(base);
  staleReference.initiatives.push({
    id: "checkout",
    version: "1",
    revision: "1",
    work_items: [{ project_id: "orders", work_item_id: "WI-0001", revision: "c".repeat(40) }]
  });
  assert.match(validateFederationRegistry(staleReference).errors.join("\n"), /does not match its expected revision/);

  const incompatible = structuredClone(base);
  incompatible.contracts.push({
    id: "orders-api",
    kind: "api",
    version: "2.0.0",
    revision: "contract-v2",
    compatibility: "incompatible",
    owner: { project_id: "orders", work_item_id: "WI-0001", revision },
    consumers: [{ project_id: "orders", work_item_id: "WI-0002", revision }]
  });
  assert.match(validateFederationRegistry(incompatible).errors.join("\n"), /requires an explicit rollout wave/);

  const eventContract = structuredClone(base);
  const eventRef = { project_id: "orders", work_item_id: "WI-0001", revision };
  eventContract.contracts.push({
    id: "order-created",
    kind: "event",
    version: "1.0.0",
    revision: "event-contract-1",
    compatibility: "compatible",
    owner: eventRef,
    consumers: [{ ...eventRef, work_item_id: "WI-0002" }]
  });
  assert.deepEqual(validateFederationRegistry(eventContract), { valid: true, errors: [] });
});

test("read-only portfolio resolves versioned coordination while excluding repository authority and raw bodies", async (testContext) => {
  const { root, coordinator } = await fixture(testContext);
  const apiRoot = path.join(root, "orders-api");
  const consumerRoot = path.join(root, "checkout");
  const apiRevision = await createRepository(apiRoot, {
    projectId: "orders-api",
    workItems: [{ id: "WI-0001", title: "Publish orders API", riskTier: "high" }],
    signals: true
  });
  const consumerRevision = await createRepository(consumerRoot, {
    projectId: "checkout",
    workItems: [{ id: "WI-0002", title: "Adopt orders API" }]
  });
  const apiRef = compositeWorkItemReference("orders-api", "WI-0001", apiRevision);
  const consumerRef = compositeWorkItemReference("checkout", "WI-0002", consumerRevision);
  const document = registry(
    [
      participant("orders-api", "../orders-api", apiRevision),
      participant("checkout", "../checkout", consumerRevision)
    ],
    {
      initiatives: [{ id: "orders-v2", version: "1", revision: "initiative-1", work_items: [apiRef, consumerRef] }],
      dependencies: [
        { id: "checkout-after-api", version: "1", revision: "dependency-1", predecessor: apiRef, successor: consumerRef }
      ],
      contracts: [
        {
          id: "orders-api-v2",
          kind: "api",
          version: "2.0.0",
          revision: "contract-2",
          compatibility: "incompatible",
          owner: apiRef,
          consumers: [consumerRef]
        }
      ],
      rollout_waves: [
        {
          id: "consumer-first",
          version: "1",
          revision: "wave-1",
          order: 1,
          work_items: [consumerRef],
          contract_refs: [{ id: "orders-api-v2", version: "2.0.0", revision: "contract-2" }]
        },
        {
          id: "producer-second",
          version: "1",
          revision: "wave-2",
          order: 2,
          work_items: [apiRef],
          contract_refs: [{ id: "orders-api-v2", version: "2.0.0", revision: "contract-2" }]
        }
      ]
    }
  );
  await writeJson(path.join(coordinator, ".ai-org/project/federation.json"), document);
  assert.deepEqual(await readFederationRegistry(coordinator), document);

  const before = await Promise.all([contentDigest(apiRoot), contentDigest(consumerRoot)]);
  const portfolio = await buildFederatedPortfolio(coordinator, { allowedRoot: root, now: NOW });
  const after = await Promise.all([contentDigest(apiRoot), contentDigest(consumerRoot)]);
  assert.deepEqual(after, before, "portfolio reads must not mutate participant content");

  assert.deepEqual(portfolio.summary, {
    participants: 2,
    current: 2,
    unknown: 0,
    work_items_projected: 2,
    overall_completion: null
  });
  assert.equal(portfolio.authority.lifecycle_owner, "participant-repositories");
  assert.equal(portfolio.authority.lifecycle_mutations_performed, false);
  const apiSignals = portfolio.participants.find((entry) => entry.participant_id === "orders-api").signals;
  assert.deepEqual(apiSignals.capacity, {
    status: "observed",
    source_kind: "canonical-aggregate",
    authoritative: false,
    active_resources: 1,
    total_capacity_units: 3,
    active_reserved_units: 1
  });
  assert.equal(apiSignals.evidence.entries, 1);
  assert.deepEqual(apiSignals.risk.by_tier, { high: 1 });
  assert.equal(apiSignals.usage.total_tokens, 123);
  assert.equal(apiSignals.usage.source_kind, "generated-projection");
  const consumerSignals = portfolio.participants.find((entry) => entry.participant_id === "checkout").signals;
  assert.equal(consumerSignals.capacity.status, "unknown");
  assert.equal(consumerSignals.evidence.status, "unknown");
  assert.equal(consumerSignals.risk.status, "unknown");
  assert.equal(consumerSignals.usage.status, "unknown");
  assert.equal(portfolio.coordination.initiatives[0].resolution, "current");
  assert.equal(portfolio.coordination.dependencies[0].resolution, "current");
  assert.equal(portfolio.coordination.contracts[0].compatibility, "incompatible");
  assert.equal(portfolio.coordination.contracts[0].resolution, "current");
  assert.deepEqual(portfolio.coordination.rollout_waves.map((wave) => wave.id), ["consumer-first", "producer-second"]);

  const serialized = JSON.stringify(portfolio);
  for (const forbidden of [
    "must-never-be-projected",
    "secret-agent",
    "raw-evidence-body",
    "raw-approval-body",
    "human-secret",
    "confidential business-source body",
    "worker-secret",
    "evidence-secret-title",
    "evidence-secret-summary",
    "evidence-secret-detail",
    "human-secret-principal",
    "secret/path",
    "usage-secret-payload",
    "usage-secret-cost",
    "gate_evidence",
    "assigned_agent_id",
    "claim"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `portfolio leaked ${forbidden}`);
  }
});

test("expected revisions reject the internal shadow project symlink reproduction and canonical directory symlinks", async (testContext) => {
  const { root, coordinator } = await fixture(testContext);
  const shadowRoot = path.join(root, "shadowed-project");
  await createRepository(shadowRoot, {
    projectId: "shadowed-project",
    name: "Committed project name",
    workItems: [{ id: "WI-0001" }]
  });
  await fs.mkdir(path.join(shadowRoot, "shadow"), { recursive: true });
  await fs.rename(
    path.join(shadowRoot, ".ai-org/project/project.json"),
    path.join(shadowRoot, "shadow/project.json")
  );
  await fs.symlink("../../shadow/project.json", path.join(shadowRoot, ".ai-org/project/project.json"));
  git(shadowRoot, ["add", "-A"]);
  git(shadowRoot, ["commit", "-qm", "track internal project symlink"]);
  const shadowRevision = git(shadowRoot, ["rev-parse", "HEAD"]);
  assert.match(
    git(shadowRoot, ["ls-tree", shadowRevision, "--", ".ai-org/project/project.json"]),
    /^120000 blob /,
    "the exact reproduction must commit project.json as a Git symlink"
  );
  const modifiedShadow = JSON.parse(await fs.readFile(path.join(shadowRoot, "shadow/project.json"), "utf8"));
  modifiedShadow.name = "Modified shadow name that is not in the expected revision";
  await writeJson(path.join(shadowRoot, "shadow/project.json"), modifiedShadow);
  assert.equal(git(shadowRoot, ["rev-parse", "HEAD"]), shadowRevision);
  assert.equal(
    git(shadowRoot, [
      "status",
      "--porcelain=v1",
      "--",
      "temple.lock",
      ".ai-org/core/workflow.json",
      ".ai-org/project/project.json",
      ".ai-org/project/resources.json",
      ".ai-org/project/evidence.json",
      ".ai-org/work-items"
    ]),
    "",
    "the shadow target change must reproduce the scoped-status blind spot"
  );

  const directoryRoot = path.join(root, "directory-link");
  await createRepository(directoryRoot, {
    projectId: "directory-link",
    workItems: [{ id: "WI-0001" }]
  });
  await fs.mkdir(path.join(directoryRoot, "shadow"), { recursive: true });
  await fs.rename(path.join(directoryRoot, ".ai-org/work-items"), path.join(directoryRoot, "shadow/work-items"));
  await fs.symlink("../shadow/work-items", path.join(directoryRoot, ".ai-org/work-items"));
  git(directoryRoot, ["add", "-A"]);
  git(directoryRoot, ["commit", "-qm", "track canonical directory symlink"]);
  const directoryRevision = git(directoryRoot, ["rev-parse", "HEAD"]);
  assert.match(
    git(directoryRoot, ["ls-tree", directoryRevision, "--", ".ai-org/work-items"]),
    /^120000 blob /,
    "the canonical directory reproduction must be a Git symlink"
  );

  const roots = [shadowRoot, directoryRoot];
  const before = await Promise.all(roots.map(contentDigest));
  const portfolio = await buildFederatedPortfolio(coordinator, {
    registry: registry([
      participant("shadowed-project", "../shadowed-project", shadowRevision),
      participant("directory-link", "../directory-link", directoryRevision)
    ]),
    allowedRoot: root,
    now: NOW
  });
  const after = await Promise.all(roots.map(contentDigest));

  assert.deepEqual(after, before, "Git-object federation reads must not mutate participant content");
  assert.equal(portfolio.summary.current, 0);
  assert.equal(portfolio.summary.unknown, 2);
  assert.ok(portfolio.participants.every((entry) => entry.diagnostics[0].code === "participant_invalid"));
  assert.ok(portfolio.participants.every((entry) => entry.work_items.length === 0));
  assert.equal(JSON.stringify(portfolio).includes(modifiedShadow.name), false);
  assert.equal(portfolio.summary.overall_completion, null);
});

test("expected revisions ignore local Git replacement objects", async (testContext) => {
  const { root, coordinator } = await fixture(testContext);
  const participantRoot = path.join(root, "replace-attack");
  const revisionA = await createRepository(participantRoot, {
    projectId: "replace-attack",
    name: "Literal revision A",
    workItems: [{ id: "WI-0001" }]
  });

  const projectPath = path.join(participantRoot, ".ai-org/project/project.json");
  const projectB = JSON.parse(await fs.readFile(projectPath, "utf8"));
  projectB.name = "Replacement revision B must never be projected as A";
  await writeJson(projectPath, projectB);
  git(participantRoot, ["add", ".ai-org/project/project.json"]);
  git(participantRoot, ["commit", "-qm", "replacement content"]);
  const revisionB = git(participantRoot, ["rev-parse", "HEAD"]);
  assert.notEqual(revisionB, revisionA);

  gitWithReplacementObjects(participantRoot, ["replace", revisionA, revisionB]);
  gitWithReplacementObjects(participantRoot, ["reset", "--hard", revisionA]);
  assert.equal(gitWithReplacementObjects(participantRoot, ["rev-parse", "HEAD"]), revisionA);
  assert.equal(
    gitWithReplacementObjects(participantRoot, [
      "status",
      "--porcelain=v1",
      "--",
      "temple.lock",
      ".ai-org/core/workflow.json",
      ".ai-org/project/project.json",
      ".ai-org/project/resources.json",
      ".ai-org/project/evidence.json",
      ".ai-org/work-items"
    ]),
    "",
    "replacement-aware scoped status must reproduce the false-clean attack"
  );
  assert.equal(
    JSON.parse(gitWithReplacementObjects(participantRoot, ["show", `${revisionA}:.ai-org/project/project.json`])).name,
    projectB.name,
    "replacement-aware Git must expose revision B content through revision A"
  );

  const before = await contentDigest(participantRoot);
  const portfolio = await buildFederatedPortfolio(coordinator, {
    registry: registry([participant("replace-attack", "../replace-attack", revisionA)]),
    allowedRoot: root,
    now: NOW
  });
  const after = await contentDigest(participantRoot);

  assert.equal(after, before, "literal federation reads must not mutate participant content");
  assert.equal(portfolio.summary.current, 0);
  assert.equal(portfolio.summary.unknown, 1);
  assert.equal(portfolio.summary.overall_completion, null);
  assert.equal(portfolio.participants[0].diagnostics[0].code, "canonical_state_dirty");
  assert.equal(portfolio.participants[0].provenance.expected_revision, revisionA);
  assert.equal(portfolio.participants[0].provenance.source_revision, revisionA);
  assert.equal(portfolio.participants[0].project, null);
  assert.equal(portfolio.participants[0].work_items.length, 0);
  assert.equal(JSON.stringify(portfolio).includes(projectB.name), false);
});

test("participant Git configuration cannot execute an external fsmonitor", async (testContext) => {
  const { root, coordinator } = await fixture(testContext);
  const participantRoot = path.join(root, "fsmonitor-attack");
  const revision = await createRepository(participantRoot, {
    projectId: "fsmonitor-attack",
    workItems: [{ id: "WI-0001" }]
  });
  const hookPath = path.join(participantRoot, ".git/fsmonitor-attack");
  const markerPath = `${hookPath}.ran`;
  await fs.writeFile(hookPath, "#!/bin/sh\n: > \"$0.ran\"\nexit 1\n", { mode: 0o755 });
  git(participantRoot, ["config", "core.fsmonitor", hookPath]);

  const before = await contentDigest(participantRoot);
  const portfolio = await buildFederatedPortfolio(coordinator, {
    registry: registry([participant("fsmonitor-attack", "../fsmonitor-attack", revision)]),
    allowedRoot: root,
    now: NOW
  });
  const after = await contentDigest(participantRoot);

  assert.equal(await fs.stat(markerPath).then(() => true, () => false), false, "fsmonitor must not execute");
  assert.equal(after, before, "fsmonitor hardening must preserve participant content");
  assert.equal(portfolio.participants[0].status, "current");
});

test("participant paths must resolve to the exact Git worktree root", async (testContext) => {
  const { root, coordinator } = await fixture(testContext);
  const participantRoot = path.join(root, "nested-attack");
  const revision = await createRepository(participantRoot, {
    projectId: "nested-attack",
    workItems: [{ id: "WI-0001" }]
  });
  await fs.mkdir(path.join(participantRoot, "nested/participant"), { recursive: true });

  const portfolio = await buildFederatedPortfolio(coordinator, {
    registry: registry([participant("nested-attack", "../nested-attack/nested/participant", revision)]),
    allowedRoot: root,
    now: NOW
  });

  assert.equal(portfolio.summary.current, 0);
  assert.equal(portfolio.summary.unknown, 1);
  assert.equal(portfolio.participants[0].diagnostics[0].code, "repository_root_mismatch");
  assert.equal(portfolio.participants[0].provenance.source_revision, null);
  assert.equal(portfolio.participants[0].project, null);
  assert.deepEqual(portfolio.participants[0].work_items, []);
});

test("ambient Git injection variables cannot redirect participant inspection", async (testContext) => {
  const { root, coordinator } = await fixture(testContext);
  const participantRoot = path.join(root, "environment-target");
  const decoyRoot = path.join(root, "environment-decoy");
  const revision = await createRepository(participantRoot, {
    projectId: "environment-target",
    workItems: [{ id: "WI-0001" }]
  });
  await createRepository(decoyRoot, {
    projectId: "environment-decoy",
    workItems: [{ id: "WI-0002" }]
  });
  const hookPath = path.join(participantRoot, ".git/environment-attack");
  const markerPath = `${hookPath}.ran`;
  await fs.writeFile(hookPath, "#!/bin/sh\n: > \"$0.ran\"\nexit 1\n", { mode: 0o755 });

  const injected = {
    GIT_DIR: path.join(decoyRoot, ".git"),
    GIT_WORK_TREE: participantRoot,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_VALUE_0: hookPath,
    GIT_ASKPASS: hookPath,
    GIT_SSH_COMMAND: hookPath,
    SSH_AUTH_SOCK: path.join(root, "credential-agent.sock")
  };
  const previous = Object.fromEntries(Object.keys(injected).map((key) => [key, process.env[key]]));
  Object.assign(process.env, injected);
  let portfolio;
  try {
    portfolio = await buildFederatedPortfolio(coordinator, {
      registry: registry([participant("environment-target", "../environment-target", revision)]),
      allowedRoot: root,
      now: NOW
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.equal(await fs.stat(markerPath).then(() => true, () => false), false, "injected commands must not execute");
  assert.equal(portfolio.participants[0].status, "current");
  assert.equal(portfolio.participants[0].project.id, "environment-target");
  assert.equal(portfolio.participants[0].provenance.source_revision, revision);
});

test("missing promisor objects fail closed without a lazy fetch", async (testContext) => {
  const { root, coordinator } = await fixture(testContext);
  const participantRoot = path.join(root, "promisor-attack");
  const revision = await createRepository(participantRoot, {
    projectId: "promisor-attack",
    workItems: [{ id: "WI-0001" }]
  });
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.writeHead(500, { "content-type": "text/plain" });
    response.end("network access is forbidden\n");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  testContext.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  git(participantRoot, ["remote", "add", "origin", `http://127.0.0.1:${address.port}/participant.git`]);
  git(participantRoot, ["config", "remote.origin.promisor", "true"]);
  git(participantRoot, ["config", "remote.origin.partialclonefilter", "blob:none"]);
  const missingObject = git(participantRoot, ["rev-parse", `${revision}:.ai-org/project/project.json`]);
  const missingObjectPath = path.join(participantRoot, ".git/objects", missingObject.slice(0, 2), missingObject.slice(2));
  await fs.rm(missingObjectPath);

  const portfolio = await buildFederatedPortfolio(coordinator, {
    registry: registry([participant("promisor-attack", "../promisor-attack", revision)]),
    allowedRoot: root,
    now: NOW
  });

  assert.equal(requests, 0, "federation inspection must not make a promisor remote request");
  assert.equal(portfolio.summary.current, 0);
  assert.equal(portfolio.summary.unknown, 1);
  assert.equal(portfolio.participants[0].diagnostics[0].code, "participant_invalid");
  assert.equal(portfolio.participants[0].project, null);
  assert.deepEqual(portfolio.participants[0].work_items, []);
});

test("missing, stale, invalid, mismatched, dirty, and escaped participants remain unknown", async (testContext) => {
  const { root, coordinator } = await fixture(testContext);
  const identityRoot = path.join(root, "identity");
  const invalidRoot = path.join(root, "invalid");
  const staleRoot = path.join(root, "stale");
  const dirtyRoot = path.join(root, "dirty");
  const mismatchRoot = path.join(root, "revision-mismatch");
  const identityRevision = await createRepository(identityRoot, {
    projectId: "actual-identity",
    workItems: [{ id: "WI-0001" }]
  });
  const invalidRevision = await createRepository(invalidRoot, {
    projectId: "invalid",
    invalidWorkItem: true
  });
  const staleRevision = await createRepository(staleRoot, {
    projectId: "stale",
    workItems: [{ id: "WI-0001" }]
  });
  const dirtyRevision = await createRepository(dirtyRoot, {
    projectId: "dirty",
    workItems: [{ id: "WI-0001" }]
  });
  await fs.appendFile(path.join(dirtyRoot, ".ai-org/work-items/WI-0001.json"), " \n");
  const mismatchRevision = await createRepository(mismatchRoot, {
    projectId: "revision-mismatch",
    workItems: [{ id: "WI-0001" }]
  });

  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-federation-external-"));
  testContext.after(() => fs.rm(externalRoot, { recursive: true, force: true }));
  const escapedRevision = await createRepository(externalRoot, {
    projectId: "escaped",
    workItems: [{ id: "WI-0001" }]
  });
  await fs.symlink(externalRoot, path.join(root, "escaped-link"));

  const document = registry([
    participant("missing", "../missing", "0".repeat(40)),
    participant("expected-identity", "../identity", identityRevision),
    participant("invalid", "../invalid", invalidRevision),
    participant("stale", "../stale", staleRevision, { max_age_seconds: 60 }),
    participant("dirty", "../dirty", dirtyRevision),
    participant("revision-mismatch", "../revision-mismatch", "1".repeat(40)),
    participant("escaped", "../escaped-link", escapedRevision)
  ]);
  const roots = [identityRoot, invalidRoot, staleRoot, dirtyRoot, mismatchRoot, externalRoot];
  const before = await Promise.all(roots.map(contentDigest));
  const portfolio = await buildFederatedPortfolio(coordinator, { registry: document, allowedRoot: root, now: NOW });
  const after = await Promise.all(roots.map(contentDigest));
  assert.deepEqual(after, before, "unknown-safe reads must not mutate participant content");

  assert.equal(portfolio.summary.current, 0);
  assert.equal(portfolio.summary.unknown, 7);
  assert.equal(portfolio.summary.overall_completion, null);
  assert.deepEqual(
    Object.fromEntries(portfolio.participants.map((entry) => [entry.participant_id, entry.diagnostics[0].code])),
    {
      dirty: "canonical_state_dirty",
      escaped: "unsafe_path",
      "expected-identity": "identity_mismatch",
      invalid: "participant_invalid",
      missing: "participant_missing",
      "revision-mismatch": "source_revision_mismatch",
      stale: "stale_revision_observation"
    }
  );
  assert.ok(portfolio.participants.every((entry) => entry.work_items.length === 0));
  assert.ok(
    portfolio.participants.every((entry) => Object.values(entry.signals).every((signal) => signal.status === "unknown"))
  );
  assert.equal(JSON.stringify(portfolio).includes(externalRoot), false, "diagnostics must not disclose local paths");
});

test("bounded projections do not turn omitted Work Items into resolved coordination", async (testContext) => {
  const { root, coordinator } = await fixture(testContext);
  const participantRoot = path.join(root, "bounded");
  const revision = await createRepository(participantRoot, {
    projectId: "bounded",
    workItems: [
      { id: "WI-0001", title: "First" },
      { id: "WI-0002", title: "Second" }
    ]
  });
  const omitted = compositeWorkItemReference("bounded", "WI-0002", revision);
  const document = registry(
    [participant("bounded", "../bounded", revision, { max_work_items: 1 })],
    { initiatives: [{ id: "bounded-initiative", version: "1", revision: "1", work_items: [omitted] }] }
  );
  const portfolio = await buildFederatedPortfolio(coordinator, { registry: document, allowedRoot: root, now: NOW });
  assert.equal(portfolio.participants[0].status, "current");
  assert.deepEqual(portfolio.participants[0].diagnostics, [{ code: "projection_truncated" }]);
  assert.equal(portfolio.participants[0].work_items.length, 1);
  assert.equal(portfolio.participants[0].signals.status.status, "unknown");
  assert.equal(portfolio.participants[0].signals.risk.status, "unknown");
  assert.equal(portfolio.coordination.initiatives[0].resolution, "unknown");
  assert.equal(portfolio.summary.overall_completion, null);
});
