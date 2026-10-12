import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { defaultExecutionPolicy } from "../src/execution-routing.mjs";
import {
  buildModelOnboardingPlan,
  buildModelOnboardingPlanFile,
  validateModelOnboardingInput,
  validateModelOnboardingPlan
} from "../src/model-onboarding.mjs";

const generatedAt = "2026-09-04T00:00:00.000Z";

function catalogModel(model, efforts, defaultEffort = efforts[0]) {
  return {
    model,
    supported_reasoning_efforts: efforts,
    default_reasoning_effort: defaultEffort,
    input_modalities: ["text"],
    visibility: "visible",
    is_default: false
  };
}

function compatible(model, effort, profiles, evidence = `contract:${model}:${effort}`) {
  return {
    provider_id: "provider-local",
    model,
    reasoning_effort: effort,
    status: "compatible",
    eligible_profile_ids: profiles,
    evidence_refs: [evidence],
    unknowns: []
  };
}

function onboardingInput(overrides = {}) {
  return {
    schema_version: "temple.model-onboarding-input/v1",
    observation: {
      provider_id: "provider-local",
      provider_kind: "test-provider",
      observed_at: "2026-09-03T00:00:00.000Z",
      source: "provider:model-list:test-fixture",
      models: [
        catalogModel("small", ["medium", "max"]),
        catalogModel("balanced", ["medium"]),
        catalogModel("frontier", ["xhigh"])
      ]
    },
    compatibility: [
      compatible("small", "medium", ["mechanical-fast"]),
      compatible("small", "max", ["lightweight-quality"]),
      compatible("balanced", "medium", ["standard"]),
      compatible("frontier", "xhigh", ["critical-planning"])
    ],
    preferences: [
      {
        profile_id: "critical-planning",
        provider_id: "provider-local",
        model: "frontier",
        reasoning_effort: "xhigh",
        source: "user-stated",
        evidence_ref: "decision:user-prefers-depth-for-critical-work"
      }
    ],
    history: {
      data_scope: "aggregate-metadata-only",
      raw_content_included: false,
      observations: [
        {
          profile_id: "standard",
          provider_id: "provider-local",
          model: "balanced",
          reasoning_effort: "medium",
          executions: 12,
          source: "provider-usage-summary",
          observed_from: "2026-08-01T00:00:00.000Z",
          observed_to: "2026-08-31T00:00:00.000Z"
        }
      ]
    },
    ...overrides
  };
}

test("model onboarding prioritizes explicit direction, then familiarity, then a sole compatible candidate", () => {
  const policy = defaultExecutionPolicy();
  const plan = buildModelOnboardingPlan(policy, onboardingInput(), { generatedAt });
  assert.deepEqual(validateModelOnboardingPlan(plan), { valid: true, errors: [] });
  assert.deepEqual(plan.summary, {
    catalog_models: 3,
    compatibility_assessments: 4,
    compatible_configurations: 4,
    proposed: 4,
    already_adopted: 0,
    unresolved: 0
  });
  const byProfile = new Map(plan.profiles.map((entry) => [entry.profile_id, entry]));
  assert.equal(byProfile.get("critical-planning").recommendation.basis, "explicit-preference");
  assert.equal(byProfile.get("critical-planning").recommendation.confidence, "project-directed");
  assert.equal(byProfile.get("standard").recommendation.basis, "historical-familiarity");
  assert.equal(byProfile.get("standard").recommendation.historical_executions, 12);
  assert.match(byProfile.get("standard").recommendation.explanation, /not quality or efficiency proof/);
  assert.equal(byProfile.get("mechanical-fast").recommendation.basis, "sole-compatible-candidate");
  assert.equal(byProfile.get("lightweight-quality").recommendation.basis, "sole-compatible-candidate");
  assert.deepEqual(plan.authority, {
    provider_contact: false,
    policy_mutation: false,
    model_execution: false,
    automatic_adoption: false,
    raw_conversation_read: false
  });
});

test("history ties and incompatible explicit preferences remain unresolved", () => {
  const input = onboardingInput();
  input.compatibility.find((entry) => entry.model === "balanced").eligible_profile_ids.push("mechanical-fast");
  input.history.observations = [
    {
      profile_id: "mechanical-fast",
      provider_id: "provider-local",
      model: "small",
      reasoning_effort: "medium",
      executions: 4,
      source: "summary-a",
      observed_from: "2026-08-01T00:00:00.000Z",
      observed_to: "2026-08-31T00:00:00.000Z"
    },
    {
      profile_id: "mechanical-fast",
      provider_id: "provider-local",
      model: "balanced",
      reasoning_effort: "medium",
      executions: 4,
      source: "summary-b",
      observed_from: "2026-08-01T00:00:00.000Z",
      observed_to: "2026-08-31T00:00:00.000Z"
    }
  ];
  input.preferences.push({
    profile_id: "standard",
    provider_id: "provider-local",
    model: "frontier",
    reasoning_effort: "xhigh",
    source: "user-stated",
    evidence_ref: "decision:preference"
  });
  const plan = buildModelOnboardingPlan(defaultExecutionPolicy(), input, { generatedAt });
  const byProfile = new Map(plan.profiles.map((entry) => [entry.profile_id, entry]));
  assert.deepEqual(byProfile.get("mechanical-fast").unresolved_reasons, ["historical-familiarity-tied"]);
  assert.deepEqual(byProfile.get("standard").unresolved_reasons, ["explicit-preference-not-compatible"]);
  assert.equal(byProfile.get("mechanical-fast").recommendation, null);
  assert.equal(byProfile.get("standard").recommendation, null);
});

test("catalog presence and suggestive model names do not create compatibility", () => {
  const input = onboardingInput({ compatibility: [], preferences: [], history: null });
  input.observation.models = [catalogModel("obviously-best-frontier-ultra", ["max"] )];
  const plan = buildModelOnboardingPlan(defaultExecutionPolicy(), input, { generatedAt });
  assert.equal(plan.summary.proposed, 0);
  assert.equal(plan.summary.unresolved, 4);
  assert.ok(plan.profiles.every((entry) => entry.unresolved_reasons.includes("no-compatible-candidate")));
});

test("unknown compatibility facts remain visible instead of becoming a recommendation", () => {
  const input = onboardingInput({ preferences: [], history: null });
  input.compatibility[0] = {
    ...input.compatibility[0],
    status: "unknown",
    eligible_profile_ids: [],
    evidence_refs: [],
    unknowns: ["tool-contract-not-tested"]
  };
  const plan = buildModelOnboardingPlan(defaultExecutionPolicy(), input, { generatedAt });
  assert.deepEqual(plan.unqualified_configurations[0], {
    provider_id: "provider-local",
    model: "small",
    reasoning_effort: "medium",
    compatibility_status: "unknown",
    evidence_refs: [],
    unknowns: ["tool-contract-not-tested"]
  });
  const mechanical = plan.profiles.find((entry) => entry.profile_id === "mechanical-fast");
  assert.equal(mechanical.status, "unresolved");
  assert.deepEqual(mechanical.unresolved_reasons, ["no-compatible-candidate"]);
});

test("an adopted project policy is reported but never overwritten by onboarding", () => {
  const policy = defaultExecutionPolicy({
    profileMappings: [{ id: "mechanical-fast", provider_id: "existing", model: "existing-model", reasoning_effort: "low" }]
  });
  const plan = buildModelOnboardingPlan(policy, onboardingInput(), { generatedAt });
  const mechanical = plan.profiles.find((entry) => entry.profile_id === "mechanical-fast");
  assert.equal(mechanical.status, "already-adopted");
  assert.equal(mechanical.states.adoption, "adopted");
  assert.deepEqual(mechanical.existing_mapping, {
    provider_id: "existing",
    model: "existing-model",
    reasoning_effort: "low"
  });
  assert.equal(mechanical.recommendation, null);
});

test("onboarding rejects raw content, unsupported efforts, and unsupported compatibility claims", () => {
  const policy = defaultExecutionPolicy();
  const raw = onboardingInput();
  raw.history.prompt = "do not retain me";
  assert.match(validateModelOnboardingInput(raw, policy).errors.join("\n"), /unknown properties: prompt/);

  const unsupportedEffort = onboardingInput();
  unsupportedEffort.compatibility[0].reasoning_effort = "ultra";
  assert.match(validateModelOnboardingInput(unsupportedEffort, policy).errors.join("\n"), /absent from the catalog/);

  const noEvidence = onboardingInput();
  noEvidence.compatibility[0].evidence_refs = [];
  assert.match(validateModelOnboardingInput(noEvidence, policy).errors.join("\n"), /must be non-empty/);
});

test("the public CLI is repository-bounded and leaves policy and input unchanged", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-model-onboarding-cli-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(temporaryRoot, ".ai-org/project"), { recursive: true });
  const policyPath = path.join(temporaryRoot, ".ai-org/project/execution-policy.json");
  const inputPath = path.join(temporaryRoot, "onboarding.json");
  await fs.writeFile(policyPath, `${JSON.stringify(defaultExecutionPolicy(), null, 2)}\n`);
  await fs.writeFile(inputPath, `${JSON.stringify(onboardingInput(), null, 2)}\n`);
  const beforePolicy = await fs.readFile(policyPath, "utf8");
  const beforeInput = await fs.readFile(inputPath, "utf8");
  const cli = fileURLToPath(new URL("../bin/temple.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "execution", "onboarding-plan", temporaryRoot, "--input", "onboarding.json", "--json"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.summary.proposed, 4);
  assert.equal(plan.authority.provider_contact, false);
  assert.equal(plan.authority.policy_mutation, false);
  assert.equal(await fs.readFile(policyPath, "utf8"), beforePolicy);
  assert.equal(await fs.readFile(inputPath, "utf8"), beforeInput);

  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "temple-model-onboarding-outside-"));
  context.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, "escape.json"), beforeInput);
  await fs.symlink(path.join(outside, "escape.json"), path.join(temporaryRoot, "escape.json"));
  await assert.rejects(() => buildModelOnboardingPlanFile(temporaryRoot, "escape.json"), /escapes the project repository/);
});

test("fresh installation distributes and manages both onboarding Schemas", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-model-onboarding-install-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const { planInit, executeInit } = await import("../src/install.mjs");
  const { validateInitConfig } = await import("../src/model.mjs");
  const target = path.join(temporaryRoot, "project");
  const config = await validateInitConfig({
    schema_version: "temple.init/v1",
    project: { id: "onboarding-fixture", name: "Onboarding Fixture" },
    naming_mode: "manual",
    agents: [
      { display_name: "Mog", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Yuna", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Tidus", positions: ["tech_lead"] },
      { display_name: "Rikku", positions: ["developer"] },
      { display_name: "Lulu", positions: ["quality_evaluator", "independent_qa"] }
    ]
  });
  await executeInit(await planInit(target, config));
  const lock = JSON.parse(await fs.readFile(path.join(target, "temple.lock"), "utf8"));
  for (const filename of ["model-onboarding-input.schema.json", "model-onboarding-plan.schema.json"]) {
    const relative = `.ai-org/core/schemas/${filename}`;
    assert.ok(lock.managed_files.some((entry) => entry.path === relative), relative);
    await fs.access(path.join(target, relative));
  }
  assert.equal(lock.capabilities.read_only_model_onboarding, true);
  const catalog = JSON.parse(await fs.readFile(path.join(target, ".ai-org/core/schemas/schema-catalog.json"), "utf8"));
  assert.ok(catalog.documents.some((entry) => entry.id === "model-onboarding-inputs"));
  assert.ok(catalog.documents.some((entry) => entry.id === "model-onboarding-plan"));

  const evaluationDirectory = path.join(target, ".ai-org/evaluations/model-onboarding");
  const viewDirectory = path.join(target, ".ai-org/views");
  await fs.mkdir(evaluationDirectory, { recursive: true });
  await fs.mkdir(viewDirectory, { recursive: true });
  const input = onboardingInput();
  await fs.writeFile(path.join(evaluationDirectory, "initial.json"), `${JSON.stringify(input, null, 2)}\n`);
  await fs.writeFile(
    path.join(viewDirectory, "model-onboarding-plan.json"),
    `${JSON.stringify(buildModelOnboardingPlan(defaultExecutionPolicy(), input, { generatedAt }), null, 2)}\n`
  );
  const { validateProjectSchemas } = await import("../src/schema-validation.mjs");
  const valid = await validateProjectSchemas(target);
  assert.equal(valid.valid, true);
  for (const document of [".ai-org/evaluations/model-onboarding/initial.json", ".ai-org/views/model-onboarding-plan.json"]) {
    assert.equal(valid.checked.find(entry => entry.document === document)?.valid, true, document);
  }

  input.compatibility[0].reasoning_effort = "ultra";
  await fs.writeFile(path.join(evaluationDirectory, "initial.json"), `${JSON.stringify(input, null, 2)}\n`);
  const invalid = await validateProjectSchemas(target);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((entry) => entry.document.endsWith("initial.json") && /absent from the catalog/.test(entry.message)));
});
