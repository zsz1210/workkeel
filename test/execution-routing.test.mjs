import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  defaultExecutionPolicy,
  EXECUTION_POLICY_RELATIVE_PATH,
  executionPolicyProjection,
  resolveExecutionRequest,
  resolveExecutionRequestFile,
  validateExecutionPolicy,
  validateExecutionRequest,
  validateExecutionRoute
} from "../src/execution-routing.mjs";

const mappedPolicy = () => defaultExecutionPolicy({
  profileMappings: [
    { id: "mechanical-fast", provider_id: "openai-codex", model: "gpt-5.6-luna", reasoning_effort: "medium" },
    { id: "lightweight-quality", provider_id: "openai-codex", model: "gpt-5.6-luna", reasoning_effort: "max" },
    { id: "standard", provider_id: "openai-codex", model: "gpt-5.6-terra", reasoning_effort: "medium" },
    { id: "critical-planning", provider_id: "openai-codex", model: "gpt-5.6-sol", reasoning_effort: "xhigh" }
  ]
});

function step(id, overrides = {}) {
  return {
    step_id: id,
    responsibility: overrides.responsibility ?? "developer",
    task_shape: {
      position_id: overrides.position_id ?? "developer",
      lifecycle_stage: overrides.lifecycle_stage ?? "build",
      task_kind: overrides.task_kind ?? "implementation",
      risk_class: overrides.risk_class ?? "standard",
      context_profile_digest: overrides.context_profile_digest ?? "sha256:fixture"
    },
    capability_route: {
      required: overrides.required ?? ["text.reasoning", "code.change"],
      optional: overrides.optional ?? []
    },
    constraints: {
      required_modalities: overrides.required_modalities ?? ["text"],
      allowed_provider_ids: overrides.allowed_provider_ids ?? ["openai-codex"],
      data_class: overrides.data_class ?? "internal",
      execution_boundary: overrides.execution_boundary ?? "approved-provider",
      resource_limits: overrides.resource_limits ?? []
    },
    selection: overrides.selection ?? { mode: "advisory" },
    resource_observations: overrides.resource_observations ?? []
  };
}

function request(steps) {
  return { schema_version: "temple.execution-request/v1", work_item_id: "WI-TEST-0001", steps };
}

test("provider-neutral and mapped execution policies remain valid and explain their mapping state", () => {
  const neutral = defaultExecutionPolicy();
  const mapped = mappedPolicy();
  assert.equal(validateExecutionPolicy(neutral).valid, true);
  assert.equal(validateExecutionPolicy(mapped).valid, true);
  assert.equal(executionPolicyProjection(neutral).mapped_profiles, 0);
  assert.equal(executionPolicyProjection(mapped).mapped_profiles, 4);
  assert.equal(executionPolicyProjection(mapped).automatic_execution, false);

  const partial = structuredClone(neutral);
  partial.profiles[0].provider_id = "provider-only";
  assert.match(validateExecutionPolicy(partial).errors.join("\n"), /must map provider_id, model, and reasoning_effort together/);

  const automatic = structuredClone(neutral);
  automatic.authority.automatic_execution = true;
  assert.match(validateExecutionPolicy(automatic).errors.join("\n"), /read-only and non-executing/);
});

test("Execution Request capability identifiers close the resolver input domain", async () => {
  const schema = JSON.parse(await fs.readFile(new URL("../project-overlay/.ai-org/core/schemas/execution-request.schema.json", import.meta.url), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const field of ["required", "optional"]) {
    const invalidRequest = request([step(`invalid-${field}`)]);
    invalidRequest.steps[0].capability_route[field] = ["INVALID/CAPABILITY"];
    assert.equal(validate(invalidRequest), false, `${field} schema boundary`);
    assert.equal(validateExecutionRequest(invalidRequest, mappedPolicy()).valid, false, `${field} semantic boundary`);
    assert.throws(
      () => resolveExecutionRequest(mappedPolicy(), invalidRequest),
      /Invalid execution request/,
      `${field} resolver boundary`
    );
  }
});

test("Execution Request semantic validation mirrors every managed unknown-property boundary", () => {
  const mutations = [
    ["request", (value) => { value.extra = true; }],
    ["step", (value) => { value.steps[0].extra = true; }],
    ["Task Shape", (value) => { value.steps[0].task_shape.extra = true; }],
    ["capability route", (value) => { value.steps[0].capability_route.extra = true; }],
    ["constraints", (value) => { value.steps[0].constraints.extra = true; }],
    ["selection", (value) => { value.steps[0].selection.extra = true; }],
    ["resource limit", (value) => {
      value.steps[0].constraints.resource_limits = [
        { measure_id: "tokens.total", maximum: 1000, unknown_handling: "reject", extra: true }
      ];
    }],
    ["resource observation", (value) => {
      value.steps[0].resource_observations = [
        { measure_id: "credits", status: "unavailable", value: null, source: "provider", quality: "declared", extra: true }
      ];
    }],
    ["missing selection", (value) => { delete value.steps[0].selection; }]
  ];
  for (const [label, mutate] of mutations) {
    const invalidRequest = request([step(`unknown-property-${label.toLowerCase().replaceAll(" ", "-")}`)]);
    mutate(invalidRequest);
    const result = validateExecutionRequest(invalidRequest, mappedPolicy());
    assert.equal(result.valid, false, label);
    assert.throws(() => resolveExecutionRequest(mappedPolicy(), invalidRequest), /Invalid execution request/, label);
  }
});

test("Execution resolver metadata options cannot produce schema-invalid Route metadata", () => {
  const validRequest = request([step("resolver-options")]);
  for (const policySource of ["external", "", null, 42]) {
    assert.throws(
      () => resolveExecutionRequest(mappedPolicy(), validRequest, { policySource }),
      /Invalid execution route policy source/
    );
  }
  for (const generatedAt of [
    "not-a-date",
    "2026-09-03",
    "2026-09-03T00:00:00Z",
    "+010000-01-01T00:00:00.000Z",
    "-000001-01-01T00:00:00.000Z",
    "+275760-09-13T00:00:00.000Z",
    null,
    42
  ]) {
    assert.throws(
      () => resolveExecutionRequest(mappedPolicy(), validRequest, { generatedAt }),
      /Invalid execution route generatedAt/
    );
  }
});

test("the managed Execution Route schema rejects the post-close Independent QA counterexample", async () => {
  const schema = JSON.parse(await fs.readFile(new URL("../project-overlay/.ai-org/core/schemas/execution-route.schema.json", import.meta.url), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const validRoute = resolveExecutionRequest(mappedPolicy(), request([step("route-contract", {
    resource_observations: [
      { measure_id: "credits", status: "unavailable", value: null, source: "provider-boundary", quality: "declared" }
    ]
  })]), { generatedAt: "2026-09-03T00:00:00.000Z" });
  assert.equal(validate(validRoute), true, JSON.stringify(validate.errors, null, 2));
  assert.deepEqual(validateExecutionRoute(validRoute), { valid: true, errors: [] });

  const neutralRoute = resolveExecutionRequest(defaultExecutionPolicy(), request([step("neutral-route", {
    allowed_provider_ids: []
  })]), { generatedAt: "2026-09-03T00:00:00.000Z" });
  const pinnedUnresolved = resolveExecutionRequest(mappedPolicy(), request([step("pinned-unresolved", {
    risk_class: "high",
    selection: { mode: "pinned", pinned_profile_id: "standard" }
  })]), { generatedAt: "2026-09-03T00:00:00.000Z" });
  const pinnedUnknownExisting = resolveExecutionRequest(mappedPolicy(), request([step("pinned-unknown-existing", {
    required: ["text.reasoning", "capability.not-registered"],
    selection: { mode: "pinned", pinned_profile_id: "standard" }
  })]), { generatedAt: "2026-09-03T00:00:00.000Z" });
  const pinnedUnknownMissing = resolveExecutionRequest(mappedPolicy(), request([step("pinned-unknown-missing", {
    required: ["text.reasoning", "capability.not-registered"],
    selection: { mode: "pinned", pinned_profile_id: "profile.not-registered" }
  })]), { generatedAt: "2026-09-03T00:00:00.000Z" });
  const shadowRoute = resolveExecutionRequest(mappedPolicy(), request([step("shadow-route", {
    selection: { mode: "shadow" }
  })]), { generatedAt: "2026-09-03T00:00:00.000Z" });
  const mediaFixture = JSON.parse(await fs.readFile(new URL("fixtures/execution-routing/content-production.json", import.meta.url), "utf8"));
  const mediaPolicy = defaultExecutionPolicy();
  mediaPolicy.capabilities.push(...mediaFixture.capabilities);
  mediaPolicy.profiles.push(mediaFixture.profile);
  mediaPolicy.rules.unshift(mediaFixture.rule);
  const mediaRoute = resolveExecutionRequest(mediaPolicy, mediaFixture.request, {
    generatedAt: "2026-09-03T00:00:00.000Z"
  });
  for (const [label, route] of [
    ["Provider-neutral", neutralRoute],
    ["pinned unresolved", pinnedUnresolved],
    ["pinned unknown capability with existing profile", pinnedUnknownExisting],
    ["pinned unknown capability with missing profile", pinnedUnknownMissing],
    ["shadow", shadowRoute],
    ["media extension", mediaRoute]
  ]) {
    assert.equal(validate(route), true, `${label}: ${JSON.stringify(validate.errors, null, 2)}`);
    assert.deepEqual(validateExecutionRoute(route), { valid: true, errors: [] }, label);
  }

  const counterexamples = [
    ["numeric step identifier", (route) => { route.steps[0].step_id = 42; }],
    ["string task shape", (route) => { route.steps[0].task_shape = "build anything"; }],
    ["invented executed status", (route) => { route.steps[0].selection.status = "executed"; }],
    ["automatic selection authority", (route) => { route.steps[0].selection.authority = "automatic"; }],
    ["claimed effective model", (route) => {
      route.steps[0].selected.effective.status = "observed";
      route.steps[0].selected.effective.provider_id = "provider";
      route.steps[0].selected.effective.model = "claimed-model";
    }],
    ["partial requested mapping", (route) => { route.steps[0].selected.requested.model = null; }],
    ["blank Work Item", (route) => { route.request.work_item_id = "   "; }],
    ["blank Task Shape", (route) => { route.steps[0].task_shape.task_kind = "  "; }],
    ["blank requested Provider", (route) => { route.steps[0].selected.requested.provider_id = "  "; }],
    ["blank capability", (route) => { route.steps[0].capability_route.required[0] = "  "; }],
    ["blank resource observation source", (route) => { route.steps[0].resource_observations[0].source = "  "; }],
    ["resolved non-pinned route without rule or fallback provenance", (route) => {
      route.steps[0].selection.rule_id = null;
      route.steps[0].selection.fallback_applied = false;
    }],
    ["pinned route marked as fallback", (route) => {
      route.steps[0].selection.mode = "pinned";
      route.steps[0].selection.authority = "human-or-coordinator-pinned";
      route.steps[0].selection.fallback_applied = true;
    }],
    ["advisory route with pinned-only unresolved reason", (route) => {
      route.steps[0].selection.status = "unresolved";
      route.steps[0].selection.unresolved_reason = "pinned-profile-not-found";
      route.steps[0].selection.fallback_applied = false;
      route.steps[0].selected = null;
      route.summary.resolved = 0;
      route.summary.unresolved = 1;
    }],
    ["resolved route with unknown required capability", (route) => {
      route.steps[0].capability_route.unknown_required = [route.steps[0].capability_route.required[0]];
    }],
    ["unavailable resource represented as zero", (route) => { route.steps[0].resource_observations[0].value = 0; }],
    ["unexpected Provider launch command", (route) => { route.steps[0].command = { launch_provider: true }; }]
  ];
  for (const [label, mutate] of counterexamples) {
    const route = structuredClone(validRoute);
    mutate(route);
    assert.equal(validate(route), false, label);
  }
});

test("Execution Route semantic validation rejects structurally valid cross-field contradictions", () => {
  const validRoute = resolveExecutionRequest(mappedPolicy(), request([step("semantic-route")]), {
    generatedAt: "2026-09-03T00:00:00.000Z"
  });
  const mutations = [
    ["summary", (route) => { route.summary.resolved = 0; route.summary.unresolved = 1; }],
    ["mode authority", (route) => { route.steps[0].selection.authority = "none"; }],
    ["selected eligibility", (route) => { route.steps[0].eligibility.eligible_profile_ids = []; }],
    ["unknown capability subset", (route) => { route.steps[0].capability_route.unknown_optional = ["not-declared"]; }],
    ["resolved unknown required capability", (route) => {
      route.steps[0].capability_route.unknown_required = [route.steps[0].capability_route.required[0]];
    }],
    ["required and optional capability overlap", (route) => {
      route.steps[0].capability_route.optional = [route.steps[0].capability_route.required[0]];
    }],
    ["partial requested mapping", (route) => { route.steps[0].selected.requested.model = null; }],
    ["blank Work Item", (route) => { route.request.work_item_id = "   "; }],
    ["blank Task Shape", (route) => { route.steps[0].task_shape.task_kind = "  "; }],
    ["blank capability", (route) => { route.steps[0].capability_route.required[0] = "  "; }],
    ["blank rejected reason", (route) => { route.steps[0].eligibility.rejected[0].reasons[0] = "  "; }],
    ["blank resource observation source", (route) => {
      route.steps[0].resource_observations = [
        { measure_id: "credits", status: "unavailable", value: null, source: "  ", quality: "declared" }
      ];
    }],
    ["resolved non-pinned route without rule or fallback provenance", (route) => {
      route.steps[0].selection.rule_id = null;
      route.steps[0].selection.fallback_applied = false;
    }],
    ["pinned fallback", (route) => {
      route.steps[0].selection.mode = "pinned";
      route.steps[0].selection.authority = "human-or-coordinator-pinned";
      route.steps[0].selection.fallback_applied = true;
    }],
    ["non-pinned use of pinned reason", (route) => {
      route.steps[0].selection.status = "unresolved";
      route.steps[0].selection.unresolved_reason = "pinned-profile-not-found";
      route.steps[0].selection.fallback_applied = false;
      route.steps[0].selected = null;
      route.summary.resolved = 0;
      route.summary.unresolved = 1;
    }],
    ["eligible and rejected overlap", (route) => {
      route.steps[0].eligibility.rejected.push({ profile_id: route.steps[0].selected.profile_id, reasons: ["invented"] });
    }],
    ["duplicate resource identity", (route) => {
      route.steps[0].resource_limits = [
        { measure_id: "tokens.total", maximum: 1000, unknown_handling: "allow" },
        { measure_id: "tokens.total", maximum: 2000, unknown_handling: "allow" }
      ];
    }]
  ];
  for (const [label, mutate] of mutations) {
    const route = structuredClone(validRoute);
    mutate(route);
    const result = validateExecutionRoute(route);
    assert.equal(result.valid, false, label);
    assert.ok(result.errors.length > 0, label);
  }
});

test("Execution Route semantic validation is total for malformed resource collections", () => {
  const validRoute = resolveExecutionRequest(mappedPolicy(), request([step("malformed-collections")]), {
    generatedAt: "2026-09-03T00:00:00.000Z"
  });
  for (const field of ["resource_limits", "resource_observations"]) {
    for (const malformed of ["not-an-array", { value: true }, 42]) {
      const route = structuredClone(validRoute);
      route.steps[0][field] = malformed;
      let result;
      assert.doesNotThrow(() => { result = validateExecutionRoute(route); }, `${field}: ${typeof malformed}`);
      assert.equal(result.valid, false, `${field}: ${typeof malformed}`);
      assert.match(result.errors.join("\n"), new RegExp(`${field} must be an array`));
    }
  }
});

test("one request resolves independent steps by task shape instead of Position or Agent identity", () => {
  const route = resolveExecutionRequest(mappedPolicy(), request([
    step("mechanical-format", { task_kind: "mechanical", risk_class: "low" }),
    step("security-architecture", {
      responsibility: "tech_lead",
      position_id: "tech_lead",
      lifecycle_stage: "design",
      task_kind: "security",
      risk_class: "high",
      required: ["text.reasoning", "architecture.design"]
    })
  ]), { generatedAt: "2026-09-03T00:00:00.000Z" });

  assert.equal(route.summary.resolved, 2);
  assert.equal(route.steps[0].selected.profile_id, "mechanical-fast");
  assert.equal(route.steps[0].selected.requested.model, "gpt-5.6-luna");
  assert.equal(route.steps[1].selected.profile_id, "critical-planning");
  assert.equal(route.steps[1].selected.requested.model, "gpt-5.6-sol");
  assert.equal(route.steps[1].selected.effective.status, "unobserved");
  assert.equal(route.authority.automatic_execution, false);
  assert.equal(route.authority.provider_contact, false);
  assert.equal(route.authority.mutation_performed, false);
});

test("bounded work stays on Terra while semantic ambiguity escalates to Luna and consequential work to Sol", () => {
  const route = resolveExecutionRequest(mappedPolicy(), request([
    step("explicit-bounded", { task_kind: "bounded", risk_class: "low" }),
    step("ambiguous-invariant", { task_kind: "semantic-ambiguity", risk_class: "low" }),
    step("consequential-security", { task_kind: "security", risk_class: "high", required: ["text.reasoning", "architecture.design"] })
  ]));
  assert.deepEqual(route.steps.map((entry) => entry.selection.rule_id), [
    "explicit-bounded-delivery",
    "semantic-ambiguity-escalation",
    "consequential-work"
  ]);
  assert.deepEqual(route.steps.map((entry) => entry.selected.profile_id), [
    "standard",
    "lightweight-quality",
    "critical-planning"
  ]);
  assert.deepEqual(route.steps.map((entry) => entry.selected.requested.model), [
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.6-sol"
  ]);
  assert.ok(route.steps.every((entry) => entry.selected.effective.status === "unobserved"));
  assert.equal(route.authority.automatic_execution, false);
  assert.equal(route.authority.provider_contact, false);
});

test("hard capability, Provider, data, boundary, risk, and resource filters run before preference", () => {
  const policy = mappedPolicy();
  policy.profiles.find((entry) => entry.id === "standard").resource_estimates = [
    { measure_id: "tokens.total", value: 1500, quality: "observed", evidence_ref: "fixture:standard" }
  ];
  const route = resolveExecutionRequest(policy, request([step("filtered", {
    required: ["text.reasoning", "missing.specialty"],
    required_modalities: ["video"],
    allowed_provider_ids: ["different-provider"],
    data_class: "restricted",
    execution_boundary: "air-gapped",
    risk_class: "high",
    resource_limits: [
      { measure_id: "tokens.total", maximum: 1000, unknown_handling: "reject" },
      { measure_id: "latency", maximum: 5000, unknown_handling: "reject" }
    ]
  })]));
  const standard = route.steps[0].eligibility.rejected.find((entry) => entry.profile_id === "standard");
  assert.ok(standard.reasons.includes("unknown-capability:missing.specialty"));
  assert.ok(standard.reasons.includes("missing-capability:missing.specialty"));
  assert.ok(standard.reasons.includes("missing-modality:video"));
  assert.ok(standard.reasons.includes("provider-not-allowed:openai-codex"));
  assert.ok(standard.reasons.includes("data-class-not-allowed:restricted"));
  assert.ok(standard.reasons.includes("execution-boundary-not-allowed:air-gapped"));
  assert.ok(standard.reasons.includes("risk-class-not-supported:high"));
  assert.ok(standard.reasons.includes("resource-limit-exceeded:tokens.total"));
  assert.ok(standard.reasons.includes("resource-measure-unknown:latency"));
  assert.equal(route.steps[0].selection.status, "unresolved");
  assert.deepEqual(route.steps[0].capability_route.unknown_required, ["missing.specialty"]);
  assert.deepEqual(route.steps[0].capability_route.unknown_optional, []);
});

test("an unknown optional capability is reported without blocking an otherwise eligible route", () => {
  const route = resolveExecutionRequest(mappedPolicy(), request([step("optional", {
    optional: ["future.optional-capability"]
  })]));
  assert.equal(route.steps[0].selection.status, "resolved");
  assert.equal(route.steps[0].selected.profile_id, "standard");
  assert.deepEqual(route.steps[0].capability_route.unknown_required, []);
  assert.deepEqual(route.steps[0].capability_route.unknown_optional, ["future.optional-capability"]);
  assert.equal(
    route.steps[0].eligibility.rejected.some((entry) =>
      entry.reasons.includes("unknown-capability:future.optional-capability")
    ),
    false
  );
});

test("resource limits reject an expensive preference before selecting an eligible lower preference", () => {
  const policy = mappedPolicy();
  policy.profiles.find((entry) => entry.id === "standard").resource_estimates = [
    { measure_id: "tokens.total", value: 1800, quality: "observed", evidence_ref: "fixture:standard" }
  ];
  policy.profiles.find((entry) => entry.id === "lightweight-quality").resource_estimates = [
    { measure_id: "tokens.total", value: 800, quality: "observed", evidence_ref: "fixture:lightweight" }
  ];
  const route = resolveExecutionRequest(policy, request([step("within-budget", {
    resource_limits: [
      { measure_id: "tokens.total", maximum: 1000, unknown_handling: "reject" }
    ]
  })]));
  assert.equal(route.steps[0].selected.profile_id, "lightweight-quality");
  assert.ok(
    route.steps[0].eligibility.rejected
      .find((entry) => entry.profile_id === "standard")
      .reasons.includes("resource-limit-exceeded:tokens.total")
  );
});

test("quoted command-like task data remains inert resolver input", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-execution-inert-"));
  const sentinel = path.join(temporaryRoot, "must-not-exist");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const commandLikeDigest = `\"; touch ${sentinel}; #`;
  const route = resolveExecutionRequest(mappedPolicy(), request([step("inert", {
    context_profile_digest: commandLikeDigest
  })]));
  assert.equal(route.steps[0].task_shape.context_profile_digest, commandLikeDigest);
  assert.equal(route.steps[0].selection.status, "resolved");
  await assert.rejects(() => fs.access(sentinel));
});

test("semantically identical rule matches are rejected regardless of array order", () => {
  const policy = mappedPolicy();
  policy.rules.push({
    id: "duplicate-ordinary-delivery",
    match: {
      task_kinds: ["documentation", "diagnosis", "implementation"],
      lifecycle_stages: ["*"],
      risk_classes: ["standard", "low"]
    },
    preference_order: ["standard"]
  });
  assert.match(validateExecutionPolicy(policy).errors.join("\n"), /duplicates an earlier rule/);
});

test("pinned mode fails closed and unknown rules use only an eligible explicit fallback", () => {
  const pinned = resolveExecutionRequest(mappedPolicy(), request([step("pinned", {
    risk_class: "high",
    selection: { mode: "pinned", pinned_profile_id: "standard" }
  })]));
  assert.equal(pinned.steps[0].selection.unresolved_reason, "pinned-profile-ineligible");
  assert.equal(pinned.steps[0].selected, null);

  const fallback = resolveExecutionRequest(mappedPolicy(), request([step("fallback", { task_kind: "unclassified" })]));
  assert.equal(fallback.steps[0].selection.rule_id, null);
  assert.equal(fallback.steps[0].selection.fallback_applied, true);
  assert.equal(fallback.steps[0].selected.profile_id, "standard");
});

test("resource observations preserve unavailable as null instead of zero", () => {
  const input = request([step("observed", {
    resource_observations: [
      { measure_id: "tokens.total", status: "observed", value: 250, source: "provider", quality: "observed" },
      { measure_id: "credits", status: "unavailable", value: null, source: "account-boundary", quality: "declared" }
    ]
  })]);
  assert.equal(validateExecutionRequest(input, mappedPolicy()).valid, true);
  const route = resolveExecutionRequest(mappedPolicy(), input);
  assert.deepEqual(route.steps[0].resource_observations.map((entry) => entry.value), [250, null]);

  const invalid = structuredClone(input);
  invalid.steps[0].resource_observations[1].value = 0;
  assert.match(validateExecutionRequest(invalid, mappedPolicy()).errors.join("\n"), /must be null when unavailable/);
});

test("a project-owned media capability and responsibility resolve without a core Position change", async () => {
  const fixture = JSON.parse(await fs.readFile(new URL("fixtures/execution-routing/content-production.json", import.meta.url), "utf8"));
  const policy = defaultExecutionPolicy();
  policy.capabilities.push(...fixture.capabilities);
  policy.profiles.push(fixture.profile);
  policy.rules.unshift(fixture.rule);
  const route = resolveExecutionRequest(policy, fixture.request, { generatedAt: "2026-09-03T00:00:00.000Z" });
  assert.equal(route.summary.resolved, 1);
  assert.equal(route.steps[0].responsibility, "video_producer");
  assert.equal(route.steps[0].selected.profile_id, "local-video-production");
  assert.equal(route.steps[0].selected.requested.provider_id, "local-media-pipeline");
  assert.equal(route.steps[0].resource_observations[0].value, null);
});

test("request-file resolution is read-only and rejects a symlink escape", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-execution-route-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "temple-execution-outside-"));
  context.after(() => Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { recursive: true, force: true })]));
  await fs.mkdir(path.join(root, ".ai-org/project"), { recursive: true });
  await fs.writeFile(path.join(root, EXECUTION_POLICY_RELATIVE_PATH), `${JSON.stringify(mappedPolicy(), null, 2)}\n`);
  await fs.writeFile(path.join(root, "request.json"), `${JSON.stringify(request([step("local")]), null, 2)}\n`);
  const before = await fs.readdir(root);
  const route = await resolveExecutionRequestFile(root, "request.json");
  assert.equal(route.summary.resolved, 1);
  assert.deepEqual(await fs.readdir(root), before);

  await fs.writeFile(path.join(outside, "escape.json"), `${JSON.stringify(request([step("escape")]), null, 2)}\n`);
  await fs.symlink(path.join(outside, "escape.json"), path.join(root, "escape.json"));
  await assert.rejects(() => resolveExecutionRequestFile(root, "escape.json"), /escapes the project repository/);
});

test("the public CLI resolves a request without changing the target", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-execution-cli-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".ai-org/project"), { recursive: true });
  await fs.writeFile(path.join(root, EXECUTION_POLICY_RELATIVE_PATH), `${JSON.stringify(mappedPolicy(), null, 2)}\n`);
  await fs.writeFile(path.join(root, "request.json"), `${JSON.stringify(request([step("cli")]), null, 2)}\n`);
  const before = await fs.readdir(root);
  const cli = fileURLToPath(new URL("../bin/temple.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "execution", "resolve", root, "--request", "request.json", "--json"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).steps[0].selected.profile_id, "standard");
  assert.deepEqual(await fs.readdir(root), before);
});
