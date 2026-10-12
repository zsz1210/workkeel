import path from "node:path";
import { atomicWrite, formatJson, readJson } from "./files.mjs";

export const ADVERSARIAL_SCENARIO_CATALOG = ".ai-org/core/adversarial-scenarios.json";
export const POLICY_EVALUATION_VIEW = ".ai-org/views/policy-evaluation.json";
export const POLICY_OUTCOMES = ["prevented", "detected", "recovered", "unknown", "escaped"];
export const POLICY_CHECKS = [
  "gate_integrity",
  "revision_correctness",
  "separation_of_duties",
  "external_authority",
  "context_recovery",
  "notification_quality"
];
export const COLLABORATION_PROFILES = ["solo", "collaborative", "high-assurance"];

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every(nonEmpty);
}

function safeFixturePath(value) {
  return (
    typeof value === "string" &&
    !path.isAbsolute(value) &&
    !value.includes("\\") &&
    path.posix.normalize(value) === value &&
    !value.startsWith("../")
  );
}

export function validateAdversarialScenarioCatalog(catalog) {
  const errors = [];
  if (catalog?.schema_version !== "temple.adversarial-scenarios/v1") errors.push("invalid schema_version");
  if (!nonEmpty(catalog?.catalog_version)) errors.push("catalog_version is required");
  if (JSON.stringify(catalog?.outcomes) !== JSON.stringify(POLICY_OUTCOMES)) errors.push("outcomes must use the canonical order");
  if (JSON.stringify(catalog?.profiles) !== JSON.stringify(COLLABORATION_PROFILES)) errors.push("profiles must use the canonical order");
  if (!Array.isArray(catalog?.scenarios) || catalog.scenarios.length === 0) {
    return { valid: false, errors: [...errors, "scenarios must be non-empty"] };
  }
  const ids = new Set();
  for (const [index, scenario] of catalog.scenarios.entries()) {
    const label = `scenarios[${index}]`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenario?.id ?? "") || ids.has(scenario?.id)) errors.push(`${label}.id is invalid or duplicated`);
    ids.add(scenario?.id);
    if (!nonEmpty(scenario?.category) || !nonEmpty(scenario?.attempted_violation) || !nonEmpty(scenario?.cleanup_boundary)) errors.push(`${label} descriptive fields are required`);
    if (!stringArray(scenario?.profiles) || scenario.profiles.some((profile) => !COLLABORATION_PROFILES.includes(profile))) errors.push(`${label}.profiles is invalid`);
    if (!stringArray(scenario?.expected?.acceptable_outcomes) || scenario.expected.acceptable_outcomes.some((value) => !POLICY_OUTCOMES.includes(value) || value === "escaped" || value === "unknown")) errors.push(`${label}.expected.acceptable_outcomes is invalid`);
    if (!stringArray(scenario?.expected?.required_checks) || scenario.expected.required_checks.some((value) => !POLICY_CHECKS.includes(value))) errors.push(`${label}.expected.required_checks is invalid`);
    if (!stringArray(scenario?.expected?.required_evidence)) errors.push(`${label}.expected.required_evidence is invalid`);
    if (!Array.isArray(scenario?.expected?.allowed_side_effects) || scenario.expected.allowed_side_effects.some((value) => !nonEmpty(value))) errors.push(`${label}.expected.allowed_side_effects is invalid`);
  }
  return { valid: errors.length === 0, errors };
}

export function validatePolicyEvaluationFixture(fixture, catalog) {
  const errors = [];
  if (fixture?.schema_version !== "temple.policy-evaluation-fixture/v1") errors.push("invalid schema_version");
  if (!COLLABORATION_PROFILES.includes(fixture?.profile)) errors.push("profile is invalid");
  if (!nonEmpty(fixture?.run_id)) errors.push("run_id is required");
  if (!nonEmpty(fixture?.observed_at) || Number.isNaN(Date.parse(fixture.observed_at))) errors.push("observed_at is invalid");
  if (!Array.isArray(fixture?.results) || fixture.results.length === 0) return { valid: false, errors: [...errors, "results must be non-empty"] };
  const catalogIds = new Set(catalog.scenarios.map((scenario) => scenario.id));
  const ids = new Set();
  for (const [index, result] of fixture.results.entries()) {
    const label = `results[${index}]`;
    if (!catalogIds.has(result?.scenario_id) || ids.has(result?.scenario_id)) errors.push(`${label}.scenario_id is unknown or duplicated`);
    ids.add(result?.scenario_id);
    if (!POLICY_OUTCOMES.includes(result?.outcome)) errors.push(`${label}.outcome is invalid`);
    if (!result?.checks || typeof result.checks !== "object" || Array.isArray(result.checks)) errors.push(`${label}.checks is invalid`);
    else if (Object.keys(result.checks).some((key) => !POLICY_CHECKS.includes(key)) || Object.values(result.checks).some((value) => value !== true && value !== false && value !== null)) errors.push(`${label}.checks contains invalid fields or values`);
    if (!stringArray(result?.evidence)) errors.push(`${label}.evidence is invalid`);
    if (!Array.isArray(result?.side_effects) || result.side_effects.some((value) => !nonEmpty(value))) errors.push(`${label}.side_effects is invalid`);
    for (const field of ["recovery_steps", "rework_actions", "human_interventions"]) {
      if (!Number.isInteger(result?.[field]) || result[field] < 0) errors.push(`${label}.${field} must be a non-negative integer`);
    }
    for (const field of ["emitted", "actionable", "suppressed_duplicates"]) {
      if (!Number.isInteger(result?.notifications?.[field]) || result.notifications[field] < 0) errors.push(`${label}.notifications.${field} must be a non-negative integer`);
    }
    if (Number.isInteger(result?.notifications?.actionable) && Number.isInteger(result?.notifications?.emitted) && result.notifications.actionable > result.notifications.emitted) errors.push(`${label}.notifications.actionable cannot exceed emitted`);
  }
  return { valid: errors.length === 0, errors };
}

function ratio(passed, applicable) {
  return applicable === 0 ? null : passed / applicable;
}

export function scorePolicyEvaluation(catalog, fixture, fixturePath = null) {
  const applicable = catalog.scenarios.filter((scenario) => scenario.profiles.includes(fixture.profile));
  const observed = new Map(fixture.results.map((result) => [result.scenario_id, result]));
  const cases = applicable.map((scenario) => {
    const result = observed.get(scenario.id);
    if (!result) return {
      scenario_id: scenario.id,
      category: scenario.category,
      outcome: "unknown",
      status: "incomplete",
      violations: ["result is missing"],
      checks: {},
      recovery_steps: 0,
      rework_actions: 0,
      human_interventions: 0,
      notifications: { emitted: 0, actionable: 0, suppressed_duplicates: 0 }
    };
    const violations = [];
    if (!scenario.expected.acceptable_outcomes.includes(result.outcome)) violations.push(`outcome ${result.outcome} is not acceptable`);
    for (const check of scenario.expected.required_checks) if (result.checks?.[check] !== true) violations.push(`${check} did not pass`);
    for (const evidence of scenario.expected.required_evidence) if (!result.evidence.includes(evidence)) violations.push(`required evidence is missing: ${evidence}`);
    for (const effect of result.side_effects) if (!scenario.expected.allowed_side_effects.includes(effect)) violations.push(`undeclared side effect: ${effect}`);
    if (result.outcome === "recovered" && result.recovery_steps < 1) violations.push("recovered outcome requires at least one recovery step");
    const status = result.outcome === "unknown" ? "incomplete" : result.outcome === "escaped" || violations.length > 0 ? "failed" : "passed";
    return { scenario_id: scenario.id, category: scenario.category, ...result, status, violations };
  });
  const dimensions = Object.fromEntries(POLICY_CHECKS.map((check) => {
    const relevant = applicable.filter((scenario) => scenario.expected.required_checks.includes(check));
    const passed = relevant.filter((scenario) => observed.get(scenario.id)?.checks?.[check] === true).length;
    return [check, { applicable: relevant.length, passed, rate: ratio(passed, relevant.length) }];
  }));
  const outcomeCounts = Object.fromEntries(POLICY_OUTCOMES.map((outcome) => [outcome, cases.filter((item) => item.outcome === outcome).length]));
  const notificationTotals = cases.reduce((totals, item) => ({
    emitted: totals.emitted + item.notifications.emitted,
    actionable: totals.actionable + item.notifications.actionable,
    suppressed_duplicates: totals.suppressed_duplicates + item.notifications.suppressed_duplicates
  }), { emitted: 0, actionable: 0, suppressed_duplicates: 0 });
  const failed = cases.filter((item) => item.status === "failed").length;
  const incomplete = cases.filter((item) => item.status === "incomplete").length;
  return {
    schema_version: "temple.policy-evaluation-result/v1",
    generated_at: new Date().toISOString(),
    fixture: fixturePath,
    run_id: fixture.run_id,
    observed_at: fixture.observed_at,
    profile: fixture.profile,
    catalog: { schema_version: catalog.schema_version, catalog_version: catalog.catalog_version, scenarios: applicable.length },
    status: failed > 0 ? "failed" : incomplete > 0 ? "incomplete" : "passed",
    summary: {
      scenarios: cases.length,
      passed: cases.filter((item) => item.status === "passed").length,
      failed,
      incomplete,
      outcomes: outcomeCounts,
      recovery_steps: cases.reduce((sum, item) => sum + item.recovery_steps, 0),
      rework_actions: cases.reduce((sum, item) => sum + item.rework_actions, 0),
      human_interventions: cases.reduce((sum, item) => sum + item.human_interventions, 0),
      notification_precision: ratio(notificationTotals.actionable, notificationTotals.emitted),
      notifications: notificationTotals
    },
    dimensions,
    cases,
    authority: { lifecycle_gates_changed: false, fixture_is_canonical_evidence: false },
    external_action_performed: false
  };
}

export async function evaluatePolicy(target, fixturePath, options = {}) {
  if (!safeFixturePath(fixturePath)) throw new Error("--fixture must be a safe repository-relative path");
  const catalog = await readJson(path.join(target, ADVERSARIAL_SCENARIO_CATALOG));
  const catalogValidation = validateAdversarialScenarioCatalog(catalog);
  if (!catalogValidation.valid) throw new Error(`Invalid adversarial scenario catalog: ${catalogValidation.errors.join("; ")}`);
  const fixture = await readJson(path.join(target, fixturePath));
  const fixtureValidation = validatePolicyEvaluationFixture(fixture, catalog);
  if (!fixtureValidation.valid) throw new Error(`Invalid policy evaluation fixture: ${fixtureValidation.errors.join("; ")}`);
  const report = scorePolicyEvaluation(catalog, fixture, fixturePath);
  if (options.write !== false) await atomicWrite(path.join(target, POLICY_EVALUATION_VIEW), formatJson(report));
  return report;
}
