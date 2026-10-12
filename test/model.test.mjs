import assert from "node:assert/strict";
import test from "node:test";
import { validateInitConfig } from "../src/model.mjs";
import { defaultRepositoryIntegration } from "../src/repository-integration.mjs";

function validConfig() {
  return {
    schema_version: "temple.init/v1",
    project: { id: "sample-product", name: "Sample Product" },
    naming_mode: "ai-suggested",
    agents: [
      { display_name: "Test Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Test Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Test Ellis", positions: ["tech_lead"] },
      { display_name: "Test Devon", positions: ["developer"] },
      { display_name: "Test Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  };
}

test("valid config produces stable project Agent IDs", async () => {
  const first = await validateInitConfig(validConfig());
  const second = await validateInitConfig(validConfig());
  assert.deepEqual(first, second);
  assert.equal(first.agents[0].id, "agent-test-rowan");
  assert.deepEqual(first.repository_integration, defaultRepositoryIntegration());
});

test("confirmed repository integration is normalized and retained", async () => {
  const config = validConfig();
  config.repository_integration = {
    schema_version: "temple.repository-integration/v1",
    status: "confirmed",
    authority: "project",
    source: "repository-policy",
    policy_refs: ["CONTRIBUTING.md"],
    summary: "  Use short-lived branches and review before integration.  ",
    integration_target: "  main  ",
    change_isolation: "required",
    review_gate: "required",
    recorded_at: "2026-09-02T00:00:00.000Z",
    recorded_by: "  human  "
  };

  const validated = await validateInitConfig(config);
  assert.equal(validated.repository_integration.summary, "Use short-lived branches and review before integration.");
  assert.equal(validated.repository_integration.integration_target, "main");
  assert.equal(validated.repository_integration.recorded_by, "human");
});

test("confirmed repository integration cannot leave execution gates unknown", async () => {
  const config = validConfig();
  config.repository_integration = {
    schema_version: "temple.repository-integration/v1",
    status: "confirmed",
    authority: "project",
    source: "human-confirmed",
    policy_refs: [],
    summary: "The user confirmed the repository workflow.",
    integration_target: "main",
    change_isolation: "unknown",
    review_gate: "unknown",
    recorded_at: "2026-09-02T00:00:00.000Z",
    recorded_by: "human"
  };

  await assert.rejects(
    () => validateInitConfig(config),
    /confirmed state must decide change_isolation.*confirmed state must decide review_gate/s
  );
});

test("repository integration policy references remain unique after normalization", async () => {
  const config = validConfig();
  config.repository_integration = {
    schema_version: "temple.repository-integration/v1",
    status: "deferred",
    authority: "project",
    source: "repository-policy",
    policy_refs: ["CONTRIBUTING.md", " CONTRIBUTING.md "],
    summary: "Choose the integration target before the first implementation change.",
    integration_target: null,
    change_isolation: "unknown",
    review_gate: "unknown",
    recorded_at: "2026-09-02T00:00:00.000Z",
    recorded_by: "human"
  };

  await assert.rejects(() => validateInitConfig(config), /policy_refs must contain unique non-empty strings/);
});

test("Agent A style labels are rejected", async () => {
  const config = validConfig();
  config.agents[0].display_name = "Agent A";
  await assert.rejects(() => validateInitConfig(config), /meaningful name/);
});

test("Developer cannot also be Independent QA", async () => {
  const config = validConfig();
  config.agents[3].positions.push("independent_qa");
  config.agents[4].positions = ["quality_evaluator"];
  await assert.rejects(() => validateInitConfig(config), /Developer and Independent QA must be different/);
});

test("all ten Positions must remain assigned", async () => {
  const config = validConfig();
  config.agents[0].positions = ["engineering_manager", "release_manager"];
  await assert.rejects(() => validateInitConfig(config), /Missing Position assignment: observer/);
});
