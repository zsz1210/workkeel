import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { effectiveActorPolicy, resolveActor, resolveProjectActor, inspectActor, formatAgentIdentity } from "../src/actor-resolution.mjs";
import { buildCollaborationState, normalizedCollaborationState, contributorReadiness, previewCollaborationTransition,
  applyCollaborationTransition, setupContributor, validateCollaborationState } from "../src/collaboration.mjs";
import { buildProjectState, validateInitConfig, validateProjectState } from "../src/model.mjs";
import { writeLocalActorBinding, clearLocalActorBinding, resolveLocalActorBindingPath } from "../src/local-identity.mjs";

const membership = (agent, position, disciplines = ["general-development"]) => ({ agent_id: agent, position_id: position,
  disciplines, status: "active", active: true, default: false,
  qualification: { basis: "evidence", evidence_refs: ["approval.md"], risk_ceiling: "standard", qualified_at: null, review_after: null, expires_at: null } });

function actorFixture() {
  const agentsDocument = { schema_version: "temple.agents/v1", agents: [
    { id: "agent-default", display_name: "Jordan", active: true },
    { id: "agent-member", display_name: "Jordan", active: true },
    { id: "agent-review", display_name: "Taylor", active: true }
  ] };
  const assignmentsDocument = { schema_version: "temple.assignments/v1", assignments: [
    { position_id: "developer", agent_id: "agent-default", active: true },
    { position_id: "independent_qa", agent_id: "agent-review", active: true }
  ] };
  const collaboration = buildCollaborationState(assignmentsDocument);
  collaboration.profile = "collaborative";
  collaboration.principals = ["one", "two"].map((id) => ({ id: `principal-${id}`, display_name: "Contributor", status: "active", active: true, provider_identities: [] }));
  collaboration.sponsorships = [
    { agent_id: "agent-default", principal_id: "principal-one", status: "active" },
    { agent_id: "agent-member", principal_id: "principal-two", status: "active" },
    { agent_id: "agent-review", principal_id: "principal-one", status: "active" }
  ];
  collaboration.memberships.push(membership("agent-member", "developer"));
  return { project: { schema_version: "temple.project/v1", id: "field-fixture", name: "Field fixture" },
    collaboration, agentsDocument, assignmentsDocument,
    agents: new Map(agentsDocument.agents.map((entry) => [entry.id, entry])),
    assignments: new Map(assignmentsDocument.assignments.map((entry) => [entry.position_id, entry.agent_id])) };
}

async function writeJson(target, relative, value) {
  await fs.mkdir(path.dirname(path.join(target, relative)), { recursive: true });
  await fs.writeFile(path.join(target, relative), `${JSON.stringify(value, null, 2)}\n`);
}

async function repositoryFixture(t, solo = false) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "temple-field-actors-"));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  const git = spawnSync("git", ["init", "-q", target], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  const context = actorFixture();
  if (solo) { context.collaboration.profile = "solo"; context.collaboration.principals = []; context.collaboration.sponsorships = []; }
  await writeJson(target, ".ai-org/project/project.json", context.project);
  await writeJson(target, ".ai-org/project/agents.json", context.agentsDocument);
  await writeJson(target, ".ai-org/project/assignments.json", context.assignmentsDocument);
  await writeJson(target, ".ai-org/project/collaboration.json", context.collaboration);
  await writeJson(target, ".ai-org/core/positions.json", { positions: [{ id: "developer" }, { id: "independent_qa" }] });
  await writeJson(target, ".ai-org/work-items/WI-0001.json", { id: "WI-0001", owner_position: "developer", state: "build",
    history: [{ from: "spec", to: "design", actor: "agent-default" }], evidence_refs: ["evidence.md"],
    claim: { id: "claim-original", status: "active", agent_id: "agent-default", principal_id: solo ? "human" : "principal-one" } });
  await fs.writeFile(path.join(target, "product.txt"), "existing uncommitted product edit\n");
  return { target, context };
}

function rejectsCode(operation, code) {
  assert.throws(operation, (error) => error.code === code && error.mutation_status === "not-started" && typeof error.next_action === "string");
}

test("V01/V04/V16: attributed ordinary work selects a qualified non-default member without login; legacy and strict remain enforced", () => {
  const context = actorFixture();
  const options = { positionId: "developer", principalId: "principal-two" };
  const selected = resolveActor(context, options);
  assert.equal(selected.agent_id, "agent-member");
  assert.equal(selected.provenance.verification_class, "attributed");
  assert.equal(selected.provenance.provider_authenticated, false);
  assert.equal(selected.source, "member-eligibility");
  assert.equal(effectiveActorPolicy(context.collaboration).mode, "attributed");
  rejectsCode(() => resolveActor(context, { ...options, workflowProfile: "high-assurance" }), "TEMPLE_ACTOR_VERIFICATION_REQUIRED");
  delete context.collaboration.actor_policy;
  assert.equal(effectiveActorPolicy(context.collaboration).source, "legacy-policy");
  rejectsCode(() => resolveActor(context, options), "TEMPLE_ACTOR_VERIFICATION_REQUIRED");
  const inspection = inspectActor(context, options);
  assert.equal(inspection.ready, false);
  assert.equal(inspection.selected_actor.agent_id, "agent-member");
  assert.equal(inspection.blockers[0].code, "TEMPLE_ACTOR_VERIFICATION_REQUIRED");
});

test("V01/V02: actual claims outrank defaults and reject another actor, inactive membership and sponsor mismatch", () => {
  const context = actorFixture();
  const item = { owner_position: "developer", claim: { status: "active", agent_id: "agent-member", principal_id: "principal-two" } };
  assert.equal(resolveActor(context, { item }).agent_id, "agent-member");
  rejectsCode(() => resolveActor(context, { item, agentId: "agent-default" }), "TEMPLE_ACTOR_CLAIM_CONFLICT");
  rejectsCode(() => resolveActor(context, { item, principalId: "principal-one" }), "TEMPLE_ACTOR_CLAIM_CONFLICT");
  rejectsCode(() => resolveActor(context, { item: { ...item, claim: { ...item.claim, position_id: "independent_qa" } } }), "TEMPLE_ACTOR_CLAIM_CONFLICT");
  rejectsCode(() => resolveActor(context, { positionId: "developer", agentId: "agent-member", principalId: "principal-one" }), "TEMPLE_ACTOR_PRINCIPAL_MISMATCH");
  context.collaboration.memberships.find((entry) => entry.agent_id === "agent-member").status = "suspended";
  rejectsCode(() => resolveActor(context, { item }), "TEMPLE_ACTOR_INELIGIBLE");
});

test("V01/V14: member ambiguity, missing disciplines, expiry and risk ceilings never select another person's default", () => {
  const context = actorFixture();
  const options = { positionId: "developer", principalId: "principal-two" };
  rejectsCode(() => resolveActor(context, { ...options, principalId: "principal-unknown" }), "TEMPLE_ACTOR_PRINCIPAL_INACTIVE");
  rejectsCode(() => resolveActor(context, { ...options, requiredDisciplines: ["security"] }), "TEMPLE_ACTOR_INELIGIBLE");
  rejectsCode(() => resolveActor(context, { ...options, riskTier: "high" }), "TEMPLE_ACTOR_INELIGIBLE");
  const second = { id: "agent-second", display_name: "Jordan", active: true };
  context.agents.set(second.id, second);
  context.collaboration.sponsorships.push({ agent_id: second.id, principal_id: "principal-two", status: "active" });
  context.collaboration.memberships.push(membership(second.id, "developer"));
  assert.throws(() => resolveActor(context, options), (error) => error.code === "TEMPLE_ACTOR_AMBIGUOUS" && error.details.candidates.length === 2);
  assert.equal(resolveActor(context, { ...options, agentId: "agent-member" }).agent_id, "agent-member");
  context.collaboration.memberships.find((entry) => entry.agent_id === "agent-member").qualification.expires_at = "2001-01-01T00:00:00Z";
  assert.equal(resolveActor(context, options).agent_id, second.id);
});

test("V01: item-derived stage disciplines replace the legacy fallback only at the named stage", () => {
  const context = actorFixture();
  const manager = { id: "agent-manager", display_name: "Morgan", active: true };
  context.agents.set(manager.id, manager);
  context.assignments.set("engineering_manager", manager.id);
  context.collaboration.memberships.push(membership(manager.id, "engineering_manager", ["architecture"]));
  context.collaboration.sponsorships.push({ agent_id: manager.id, principal_id: "principal-one", status: "active" });
  const item = { owner_position: "engineering_manager", state: "intake", required_disciplines: ["general-development"],
    stage_requirements: { build: { disciplines: ["general-development"] }, independent_qa: { disciplines: ["quality"] } } };
  rejectsCode(() => resolveActor(context, { item }), "TEMPLE_ACTOR_INELIGIBLE");
  item.stage_requirements.intake = { disciplines: ["architecture"] };
  assert.equal(resolveActor(context, { item }).agent_id, manager.id);
  item.owner_position = "independent_qa";
  item.state = "independent_qa";
  assert.equal(resolveActor(context, { item }).agent_id, "agent-review");
  delete item.stage_requirements.independent_qa;
  rejectsCode(() => resolveActor(context, { item }), "TEMPLE_ACTOR_INELIGIBLE");
  item.stage_requirements.independent_qa = { disciplines: [] };
  assert.equal(resolveActor(context, { item }).agent_id, "agent-review");
});

test("V01/V04: a bound Developer cannot fall through to another contributor's Engineering Manager", () => {
  const context = actorFixture();
  context.assignments.set("engineering_manager", "agent-default");
  context.collaboration.memberships.push(membership("agent-default", "engineering_manager", ["architecture"]));
  const binding = { schema_version: "temple.local-actor-binding/v1", project_id: context.project.id,
    principal_id: "principal-two", verification_class: "external-evidence", provider: { id: "fixture", subject: "member" },
    evidence_ref: "fixture:member-provenance", observed_at: "2026-01-01T00:00:00Z", expires_at: null, credential_stored: false };
  rejectsCode(() => resolveActor(context, { positionId: "engineering_manager", binding }), "TEMPLE_ACTOR_INELIGIBLE");
  assert.equal(resolveActor(context, { positionId: "developer", binding }).agent_id, "agent-member");
  assert.equal(resolveActor(context, { positionId: "engineering_manager", principalId: "principal-one" }).agent_id, "agent-default");
});

test("V03/V16: contributor readiness enforces recorded stage disciplines and reports the actual Work Item actor policy", async (t) => {
  const { target } = await repositoryFixture(t);
  const item = { id: "WI-0001", owner_position: "developer", state: "build", required_disciplines: ["security"], claim: null };
  await writeJson(target, ".ai-org/work-items/WI-0001.json", item);
  const blocked = await contributorReadiness(target, { principalId: "principal-two", workItemId: item.id });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockers[0].code, "TEMPLE_ACTOR_INELIGIBLE");
  assert.deepEqual(blocked.blockers[0].details.required_disciplines, ["security"]);
  item.stage_requirements = { build: { disciplines: ["general-development"] } };
  await writeJson(target, ".ai-org/work-items/WI-0001.json", item);
  assert.equal((await contributorReadiness(target, { principalId: "principal-two", workItemId: item.id })).ready, true);
  item.workflow_profile = "high-assurance";
  await writeJson(target, ".ai-org/work-items/WI-0001.json", item);
  const strict = await contributorReadiness(target, { principalId: "principal-two", workItemId: item.id });
  assert.equal(strict.ready, false);
  assert.equal(strict.actor_policy.mode, "verified");
  assert.equal(strict.selected_actor.agent_id, "agent-member");
  assert.equal(strict.blockers[0].code, "TEMPLE_ACTOR_VERIFICATION_REQUIRED");
});

test("V04/V16: existing valid binding works; stale, mismatched and self-described provenance is never silently ignored", async (t) => {
  const { target, context } = await repositoryFixture(t);
  const options = { positionId: "developer", principalId: "principal-two" };
  assert.equal((await resolveProjectActor(target, context, options)).agent_id, "agent-member");
  await writeLocalActorBinding(target, { principalId: "principal-two", verificationClass: "external-evidence",
    providerId: "fixture-provider", providerSubject: "supplied-subject", evidenceRef: "approval.md" });
  const strict = await resolveProjectActor(target, context, { ...options, strict: true });
  assert.equal(strict.provenance.externally_supplied_evidence, true);
  assert.equal(strict.provenance.provider_authenticated, false);
  context.collaboration.principals[1].provider_identities = [{ provider: "fixture-provider", subject: "different-subject", status: "active" }];
  await assert.rejects(resolveProjectActor(target, context, options), { code: "TEMPLE_ACTOR_BINDING_PROVIDER_MISMATCH" });
  context.collaboration.principals[1].provider_identities = [];
  await assert.rejects(resolveProjectActor(target, context, { positionId: "developer", principalId: "principal-one" }), { code: "TEMPLE_ACTOR_BINDING_MISMATCH" });
  const filename = resolveLocalActorBindingPath(target);
  const expired = JSON.parse(await fs.readFile(filename, "utf8"));
  expired.observed_at = "2000-01-01T00:00:00Z";
  expired.expires_at = "2001-01-01T00:00:00Z";
  await fs.writeFile(filename, JSON.stringify(expired));
  await assert.rejects(resolveProjectActor(target, context, options), { code: "TEMPLE_ACTOR_BINDING_EXPIRED" });
  await fs.writeFile(filename, "{broken");
  await assert.rejects(resolveProjectActor(target, context, options), { code: "TEMPLE_ACTOR_BINDING_INVALID" });
  await clearLocalActorBinding(target);
  rejectsCode(() => resolveActor(context, { ...options, strict: true, binding: { ...expired, observed_at: "2026-01-01T00:00:00Z", expires_at: null,
    verification_class: "self-asserted", provider: null, evidence_ref: null } }), "TEMPLE_ACTOR_VERIFICATION_REQUIRED");
});

test("V03: profile transition preserves work, anonymous claim, edits and binding; exact proposal and stale input fail before writing", async (t) => {
  const { target } = await repositoryFixture(t, true);
  await writeLocalActorBinding(target, { principalId: "human", verificationClass: "self-asserted" });
  const workPath = path.join(target, ".ai-org/work-items/WI-0001.json");
  const work = await fs.readFile(workPath, "utf8");
  const bindingPath = resolveLocalActorBindingPath(target);
  const binding = await fs.readFile(bindingPath, "utf8");
  const first = await previewCollaborationTransition(target, { profile: "collaborative", actorPolicy: "attributed" });
  assert.equal(first.anonymous_active_claims.length, 1);
  assert.equal(first.recovery_choices.length, 2);
  await assert.rejects(applyCollaborationTransition(target, { profile: "collaborative", actorPolicy: "verified", fingerprint: first.fingerprint }), { code: "TEMPLE_COLLABORATION_PREVIEW_STALE" });
  await fs.writeFile(workPath, `${work}\n`);
  await assert.rejects(applyCollaborationTransition(target, { profile: "collaborative", actorPolicy: "attributed", fingerprint: first.fingerprint }), { code: "TEMPLE_COLLABORATION_PREVIEW_STALE" });
  const fresh = await previewCollaborationTransition(target, { profile: "collaborative", actorPolicy: "attributed" });
  const applied = await applyCollaborationTransition(target, { profile: "collaborative", actorPolicy: "attributed", fingerprint: fresh.fingerprint });
  assert.equal(applied.applied, true);
  assert.equal(await fs.readFile(workPath, "utf8"), `${work}\n`);
  assert.equal(await fs.readFile(bindingPath, "utf8"), binding);
  assert.equal(await fs.readFile(path.join(target, "product.txt"), "utf8"), "existing uncommitted product edit\n");
  const readiness = await contributorReadiness(target, { workItemId: "WI-0001" });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.anonymous_active_claims[0].claim.principal_id, "human");
});

test("V03/V16: missing legacy policy survives normalization and only explicit preview/application adopts attribution", async (t) => {
  const { target, context } = await repositoryFixture(t);
  delete context.collaboration.actor_policy;
  await writeJson(target, ".ai-org/project/collaboration.json", context.collaboration);
  assert.equal(normalizedCollaborationState(context.collaboration).actor_policy, undefined);
  const before = await contributorReadiness(target, { principalId: "principal-two", positionId: "developer" });
  assert.equal(before.ready, false);
  assert.equal(before.selected_actor.agent_id, "agent-member");
  assert.equal(before.eligible_positions[0].ready, false);
  const preview = await previewCollaborationTransition(target, { actorPolicy: "attributed" });
  await applyCollaborationTransition(target, { actorPolicy: "attributed", fingerprint: preview.fingerprint });
  assert.equal((await contributorReadiness(target, { principalId: "principal-two", positionId: "developer" })).ready, true);
});

const newMember = () => ({ authorized: true, principalId: "principal-new", displayName: "Morgan", evidenceRefs: ["approved-membership.md"],
  deliveryAgent: { id: "agent-new-dev", displayName: "Jordan", positions: ["developer"] },
  reviewAgent: { id: "agent-new-review", displayName: "Jordan", positions: ["independent_qa"] } });

test("V04/V13/V14: explicitly authorized member setup reuses IDs, keeps distinct review, adds no human authority and edits without binding", async (t) => {
  const start = performance.now();
  const { target } = await repositoryFixture(t);
  const options = newMember();
  const oldWork = await fs.readFile(path.join(target, ".ai-org/work-items/WI-0001.json"), "utf8");
  assert.equal((await setupContributor(target, options)).changed, true);
  const firstUseMs = performance.now() - start;
  const documentPath = path.join(target, ".ai-org/project/collaboration.json");
  const bytes = await fs.readFile(documentPath, "utf8");
  const collaboration = JSON.parse(bytes);
  assert.deepEqual(collaboration.authority_grants, []);
  assert.equal(collaboration.bootstrap_owner, null);
  const second = await setupContributor(target, options);
  assert.equal(second.changed, false);
  assert.equal(second.mutation_status, "no-write");
  assert.equal(await fs.readFile(documentPath, "utf8"), bytes);
  assert.equal(await fs.readFile(path.join(target, ".ai-org/work-items/WI-0001.json"), "utf8"), oldWork);
  const ready = await contributorReadiness(target, { principalId: "principal-new", positionId: "developer" });
  assert.equal(ready.ready, true);
  assert.equal(ready.selected_actor.agent_id, "agent-new-dev");
  assert.match(ready.agents[0].label, /principal-new.*agent-new-dev/);
  await fs.appendFile(path.join(target, "product.txt"), "authorized ordinary product edit\n");
  const firstEditMs = performance.now() - start;
  assert.match(await fs.readFile(path.join(target, "product.txt"), "utf8"), /authorized ordinary product edit/);
  assert.equal(await fs.stat(resolveLocalActorBindingPath(target)).catch((error) => error.code), "ENOENT");
  t.diagnostic(JSON.stringify({ scenario: "V13", setup_ms: firstUseMs, first_product_edit_ms: firstEditMs,
    first_verifiable_output_ms: performance.now() - start, temple_login_count: 0, observed_layer: "local API fixture; lifecycle claim measured by integration tests" }));
});

test("V04/V14/V16: unauthorized setup, same delivery/review identity and expired membership leave files untouched", async (t) => {
  const { target } = await repositoryFixture(t);
  const options = newMember();
  const filename = path.join(target, ".ai-org/project/collaboration.json");
  const before = await fs.readFile(filename, "utf8");
  await assert.rejects(setupContributor(target, { ...options, authorized: false }), { code: "TEMPLE_CONTRIBUTOR_AUTHORIZATION_REQUIRED" });
  await assert.rejects(setupContributor(target, { ...options, reviewAgent: { ...options.reviewAgent, id: options.deliveryAgent.id } }), { code: "TEMPLE_CONTRIBUTOR_SEPARATION_REQUIRED" });
  await assert.rejects(setupContributor(target, { ...options, evidenceRefs: [] }), { code: "TEMPLE_CONTRIBUTOR_QUALIFICATION_REQUIRED" });
  assert.equal(await fs.readFile(filename, "utf8"), before);
  await setupContributor(target, options);
  const changed = JSON.parse(await fs.readFile(filename, "utf8"));
  changed.memberships.find((entry) => entry.agent_id === options.deliveryAgent.id).qualification.expires_at = "2000-01-01T00:00:00Z";
  await writeJson(target, ".ai-org/project/collaboration.json", changed);
  const expiredBytes = await fs.readFile(filename, "utf8");
  await assert.rejects(setupContributor(target, options), { code: "TEMPLE_CONTRIBUTOR_QUALIFICATION_REQUIRED" });
  assert.equal(await fs.readFile(filename, "utf8"), expiredBytes);
});

test("V14: repeated labels initialize with deterministic distinct IDs, validate and disambiguate without merging", async () => {
  const config = { schema_version: "temple.init/v1", project: { id: "names", name: "Names" }, naming_mode: "manual", agents: [
    { display_name: "Jordan", positions: ["developer", "engineering_manager", "product_manager", "ux_designer", "ui_designer", "tech_lead", "observer"] },
    { display_name: "Jordan", positions: ["quality_evaluator", "independent_qa", "release_manager"] }
  ] };
  const normalized = await validateInitConfig(config);
  assert.deepEqual(normalized.agents.map((entry) => entry.id), ["agent-jordan", "agent-jordan-2"]);
  assert.deepEqual(await validateInitConfig(config), normalized);
  const state = buildProjectState(normalized);
  const positions = new Set(config.agents.flatMap((entry) => entry.positions));
  assert.equal(validateProjectState(state.project, state.agents, state.assignments, positions).find((entry) => entry.id === "agent_identities").status, "pass");
  const context = actorFixture();
  assert.equal(formatAgentIdentity(context, "agent-member"), "Jordan (principal-two / agent-member)");
  assert.equal(formatAgentIdentity(context, "agent-review"), "Taylor");
  const invalid = structuredClone(context.collaboration);
  invalid.actor_policy = { ordinary_development: "auto-verified" };
  assert.equal(validateCollaborationState(invalid, context.agentsDocument, context.assignmentsDocument, new Set(["developer", "independent_qa"])).valid, false);
});
