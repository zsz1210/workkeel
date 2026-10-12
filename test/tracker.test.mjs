import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createGitHubTrackerAdapter,
  emptyTrackerConfig,
  planTrackerReconciliation,
  validateTrackerConfig,
  validateTrackerMappings,
  validateTrackerObservation,
  validateTrackerReconciliationArtifact,
  validateTrackerView,
  validateWorkItemTrackerRefs,
  writeTrackerView
} from "../src/tracker.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

function linkedConfig(overrides = {}) {
  return {
    ...emptyTrackerConfig(),
    profile: "linked-tracker",
    default_provider_id: "github-main",
    providers: [
      {
        id: "github-main",
        kind: "github",
        status: "active",
        project: "example/product",
        base_url: "https://github.com",
        read_policy: "live",
        write_policy: "plan-only"
      }
    ],
    ...overrides
  };
}

function observation(overrides = {}) {
  return {
    schema_version: "temple.tracker-observation/v1",
    provider_id: "github-main",
    provider_kind: "github",
    item_id: "381",
    url: "https://github.com/example/product/issues/381",
    observed_at: "2026-08-30T01:00:00.000Z",
    external_updated_at: "2026-08-30T00:59:00.000Z",
    revision: "2026-08-30T00:59:00.000Z:381",
    title: "Ship the checkout flow",
    status: "open",
    fields: {
      priority: "high",
      iteration: "Sprint 42",
      estimate: "5",
      due_date: null,
      business_assignee: "octo-user",
      labels: ["team-visible"]
    },
    source: { kind: "file", adapter: "fixture" },
    ...overrides
  };
}

function workItem(overrides = {}) {
  return {
    schema_version: "temple.work-item/v1",
    id: "WI-0001",
    title: "Ship the checkout flow",
    state: "build",
    parent_work_item_id: null,
    tracker_visibility: "team-visible",
    tracker_refs: [
      {
        provider_id: "github-main",
        item_id: "381",
        url: "https://github.com/example/product/issues/381",
        role: "primary"
      }
    ],
    evidence: [],
    ...overrides
  };
}

function initConfig() {
  return {
    schema_version: "temple.init/v1",
    project: { id: "tracker-product", name: "Tracker Product" },
    naming_mode: "ai-suggested",
    agents: [
      { display_name: "Fixture Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Fixture Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Fixture Ellis", positions: ["tech_lead"] },
      { display_name: "Fixture Devon", positions: ["developer"] },
      { display_name: "Fixture Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  };
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

async function fixture() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-tracker-test-"));
  const target = path.join(temporaryRoot, "tracker-product");
  const configPath = path.join(temporaryRoot, "init.json");
  await fs.writeFile(configPath, `${JSON.stringify(initConfig(), null, 2)}\n`);
  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  return { temporaryRoot, target };
}

test("tracker configuration keeps protected fields local and never stores credentials", () => {
  assert.deepEqual(validateTrackerConfig(emptyTrackerConfig()), { valid: true, errors: [], warnings: [] });
  assert.equal(validateTrackerConfig(linkedConfig()).valid, true);

  const delegatedLifecycle = linkedConfig();
  delegatedLifecycle.field_ownership.temple = delegatedLifecycle.field_ownership.temple.filter(
    (field) => field !== "lifecycle_state"
  );
  delegatedLifecycle.field_ownership.external.push("lifecycle_state");
  assert.match(validateTrackerConfig(delegatedLifecycle).errors.join("\n"), /cannot be delegated/);

  const embeddedSecret = linkedConfig();
  embeddedSecret.providers[0].token = "secret";
  assert.match(validateTrackerConfig(embeddedSecret).errors.join("\n"), /unknown properties: token/);

  const repositoryOnlyWithProvider = linkedConfig({ profile: "repository-only" });
  assert.match(validateTrackerConfig(repositoryOnlyWithProvider).errors.join("\n"), /cannot configure external providers/);
});

test("tracker mappings enforce visibility, provider URLs, and unique primary ownership", () => {
  const config = linkedConfig();
  assert.equal(validateWorkItemTrackerRefs(workItem(), config).valid, true);
  assert.match(
    validateWorkItemTrackerRefs(workItem({ tracker_visibility: "internal" }), config).errors.join("\n"),
    /internal and cannot have tracker_refs/
  );
  assert.match(
    validateWorkItemTrackerRefs(
      workItem({
        tracker_refs: [
          {
            provider_id: "github-main",
            item_id: "381",
            url: "https://example.com/example/product/issues/381",
            role: "primary"
          }
        ]
      }),
      config
    ).errors.join("\n"),
    /URL origin must match provider/
  );
  const duplicate = validateTrackerMappings(config, [workItem(), workItem({ id: "WI-0002" })]);
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors.join("\n"), /mapped to both WI-0001 and WI-0002/);
});

test("tracker observations and plans never let external completion advance the lifecycle", () => {
  assert.equal(validateTrackerObservation(observation()).valid, true);
  const plan = planTrackerReconciliation(linkedConfig(), workItem(), observation({ status: "done" }));
  assert.equal(plan.external_write_performed, false);
  assert.equal(plan.conflict_count, 1);
  assert.equal(plan.actions[0].id, "external-completion-cannot-advance-temple");
  assert.equal(plan.actions[0].owner, "temple");

  const invalidFields = observation({ fields: { ...observation().fields, due_date: "tomorrow" } });
  assert.match(validateTrackerObservation(invalidFields).errors.join("\n"), /YYYY-MM-DD/);
});

test("generated tracker views retain shared supporting mappings per Work Item", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-tracker-view-test-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const config = linkedConfig();
  const sharedObservation = observation();
  const first = workItem();
  const second = workItem({ id: "WI-0002", tracker_refs: [{ ...workItem().tracker_refs[0], role: "supporting" }] });
  await writeTrackerView(temporaryRoot, first, sharedObservation, planTrackerReconciliation(config, first, sharedObservation));
  const view = await writeTrackerView(
    temporaryRoot,
    second,
    sharedObservation,
    planTrackerReconciliation(config, second, sharedObservation)
  );
  assert.equal(view.entries.length, 2);
  assert.equal(validateTrackerView(view).valid, true);
});

test("GitHub adapter uses argument arrays and emits a bounded normalized observation", async () => {
  let receivedArgs = null;
  const adapter = createGitHubTrackerAdapter({
    execute: async (args) => {
      receivedArgs = args;
      return {
        stdout: JSON.stringify({
          id: 9901,
          number: 381,
          title: "Ship the checkout flow",
          state: "open",
          html_url: "https://github.com/example/product/issues/381",
          updated_at: "2026-08-30T00:59:00.000Z",
          assignees: [{ login: "octo-user" }],
          milestone: { title: "Sprint 42" },
          labels: [{ name: "team-visible" }]
        })
      };
    }
  });
  const result = await adapter.inspect(linkedConfig().providers[0], "#381");
  assert.deepEqual(receivedArgs, ["api", "--method", "GET", "repos/example/product/issues/381"]);
  assert.equal(result.item_id, "381");
  assert.equal(result.fields.business_assignee, "octo-user");
  assert.deepEqual(result.fields.labels, ["team-visible"]);
  assert.equal("body" in result, false);
});

test("CLI keeps company tracking above internal AI tasks and records explicit reconciliation", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const rootCreated = run([
    "work-item",
    "create",
    target,
    "--title",
    "Ship the checkout flow",
    "--scope",
    "One company-visible outcome",
    "--acceptance",
    "Independent QA verifies it",
    "--ui-mode",
    "not-applicable"
  ]);
  assert.equal(rootCreated.status, 0, rootCreated.stderr || rootCreated.stdout);
  const childCreated = run([
    "work-item",
    "create",
    target,
    "--title",
    "Implement the internal backend slice",
    "--parent",
    "WI-0001",
    "--ui-mode",
    "not-applicable"
  ]);
  assert.equal(childCreated.status, 0, childCreated.stderr || childCreated.stdout);
  const rootItem = JSON.parse(await fs.readFile(path.join(target, ".ai-org/work-items/WI-0001.json"), "utf8"));
  const childItem = JSON.parse(await fs.readFile(path.join(target, ".ai-org/work-items/WI-0002.json"), "utf8"));
  assert.equal(rootItem.tracker_visibility, "team-visible");
  assert.equal(childItem.tracker_visibility, "internal");

  const configured = run([
    "tracker",
    "configure",
    target,
    "--tracker-profile",
    "linked-tracker",
    "--provider-id",
    "github-main",
    "--provider-kind",
    "github",
    "--project",
    "example/product",
    "--write-policy",
    "plan-only"
  ]);
  assert.equal(configured.status, 0, configured.stderr || configured.stdout);
  const linked = run([
    "tracker",
    "link",
    target,
    "--work-item",
    "WI-0001",
    "--provider-id",
    "github-main",
    "--item-id",
    "#381",
    "--url",
    "https://github.com/example/product/issues/381"
  ]);
  assert.equal(linked.status, 0, linked.stderr || linked.stdout);
  assert.match(linked.stdout, /External write: not performed/);

  const internalLink = run([
    "tracker",
    "link",
    target,
    "--work-item",
    "WI-0002",
    "--provider-id",
    "github-main",
    "--item-id",
    "382",
    "--url",
    "https://github.com/example/product/issues/382"
  ]);
  assert.equal(internalLink.status, 1);
  assert.match(internalLink.stderr, /is internal/);

  const closedObservationPath = path.join(temporaryRoot, "closed-observation.json");
  await fs.writeFile(closedObservationPath, `${JSON.stringify(observation({ status: "done" }), null, 2)}\n`);
  const plannedWithoutWrite = run([
    "tracker",
    "plan",
    target,
    "--work-item",
    "WI-0001",
    "--observation",
    closedObservationPath,
    "--no-write",
    "--json"
  ]);
  assert.equal(plannedWithoutWrite.status, 0, plannedWithoutWrite.stderr || plannedWithoutWrite.stdout);
  assert.equal(JSON.parse(plannedWithoutWrite.stdout).conflict_count, 1);
  await assert.rejects(() => fs.access(path.join(target, ".ai-org/views/tracker.json")));

  const planned = run([
    "tracker",
    "plan",
    target,
    "--work-item",
    "WI-0001",
    "--observation",
    closedObservationPath,
    "--json"
  ]);
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);
  await fs.access(path.join(target, ".ai-org/views/tracker.json"));

  const rejectedExternalCompletion = run([
    "tracker",
    "reconcile",
    target,
    "--work-item",
    "WI-0001",
    "--observation",
    closedObservationPath,
    "--resolution",
    "accept-external",
    "--reason",
    "The company board was closed early"
  ]);
  assert.equal(rejectedExternalCompletion.status, 1);
  assert.match(rejectedExternalCompletion.stderr, /Cannot accept external values for Temple-owned fields/);

  const retainedTemple = run([
    "tracker",
    "reconcile",
    target,
    "--work-item",
    "WI-0001",
    "--observation",
    closedObservationPath,
    "--resolution",
    "keep-temple",
    "--reason",
    "Release evidence is not complete"
  ]);
  assert.equal(retainedTemple.status, 0, retainedTemple.stderr || retainedTemple.stdout);
  assert.match(retainedTemple.stdout, /External write: not performed/);
  const retainedItem = JSON.parse(await fs.readFile(path.join(target, ".ai-org/work-items/WI-0001.json"), "utf8"));
  assert.equal(retainedItem.state, "intake");
  assert.equal(retainedItem.tracker_reconciliations.at(-1).resolution, "keep-temple");
  const retainedArtifactPath = path.join(target, retainedItem.tracker_reconciliations.at(-1).evidence_ref);
  const retainedArtifact = JSON.parse(await fs.readFile(retainedArtifactPath, "utf8"));
  assert.equal(validateTrackerReconciliationArtifact(retainedArtifact).valid, true);

  const renamedObservationPath = path.join(temporaryRoot, "renamed-observation.json");
  await fs.writeFile(
    renamedObservationPath,
    `${JSON.stringify(observation({ revision: "rename:381", title: "Checkout flow agreed with the team" }), null, 2)}\n`
  );
  const acceptedTitle = run([
    "tracker",
    "reconcile",
    target,
    "--work-item",
    "WI-0001",
    "--observation",
    renamedObservationPath,
    "--resolution",
    "accept-external",
    "--reason",
    "The negotiated title is clearer"
  ]);
  assert.equal(acceptedTitle.status, 0, acceptedTitle.stderr || acceptedTitle.stdout);
  const renamedItem = JSON.parse(await fs.readFile(path.join(target, ".ai-org/work-items/WI-0001.json"), "utf8"));
  assert.equal(renamedItem.title, "Checkout flow agreed with the team");

  const capsule = run([
    "context",
    "resolve",
    target,
    "--work-item",
    "WI-0002",
    "--no-write",
    "--json"
  ]);
  assert.equal(capsule.status, 0, capsule.stderr || capsule.stdout);
  assert.equal(JSON.parse(capsule.stdout).tracker.direct_refs.length, 0);
  assert.equal(JSON.parse(capsule.stdout).tracker.inherited_refs[0].inherited_from, "WI-0001");

  const status = JSON.parse(run(["status", target, "--json", "--no-write"]).stdout);
  assert.equal(status.schema_version, "temple.status/v9");
  assert.equal(status.tracker.profile, "linked-tracker");
  assert.equal(status.tracker.linked_work_items, 1);
  assert.equal(status.tracker.external_write_performed, false);

  const removal = run(["tracker", "remove-provider", target, "--provider-id", "github-main"]);
  assert.equal(removal.status, 1);
  assert.match(removal.stderr, /referenced by Work Items: WI-0001/);

  const healthyDoctor = run(["doctor", target, "--json"]);
  assert.equal(healthyDoctor.status, 0, healthyDoctor.stderr || healthyDoctor.stdout);
  await fs.unlink(retainedArtifactPath);
  const missingEvidenceDoctor = run(["doctor", target, "--json"]);
  assert.equal(missingEvidenceDoctor.status, 1);
  const missingEvidenceResult = JSON.parse(missingEvidenceDoctor.stdout);
  assert.match(
    missingEvidenceResult.checks.find((check) => check.id === "tracker_reconciliation_evidence").message,
    /is missing/
  );
});
