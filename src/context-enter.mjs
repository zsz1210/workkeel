import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sha256 } from "./files.mjs";
import { OperationError } from "./operation-errors.mjs";
import { resolveWorkItemContext } from "./context.mjs";
import { acquireContextPacket, readContextPacketSource, validateAvailableWholeSources, reuseAvailableWholeSources, taskMaterialPacket } from "./context-packet.mjs";
import { agentIsEligible, principalStatus, sponsoredPrincipal } from "./collaboration.mjs";
import { assertLocalActorBinding } from "./local-identity.mjs";
import { assessWorkflowProfile } from "./workflow.mjs";
import { activeExecutionRequirements } from "./work-items.mjs";
import { validateRuntimeWorkerRegistry } from "./workers.mjs";
import { resolveGitRevision } from "./evidence.mjs";
import { readPendingLeanDelivery, readLeanFinishDiagnostics } from "./lean-delivery-state.mjs";

const PROCEDURE = ".agents/skills/temple-work/references/lean-execution.md";
const EXTRA_INPUTS = [".ai-org/project/project.json", ".ai-org/project/runtime-workers.json", ".ai-org/project/resources.json", ".ai-org/project/evidence.json", ".ai-org/core/ui-design.json", ".ai-org/core/high-assurance.json"];
const nonemptyStrings = values => Array.isArray(values) && values.length > 0 && values.every(value => typeof value === "string" && value.trim());

// A read-only observation, never a claim or a replacement for mutation guards.
async function inspect(repository, options) {
  const entry = await resolveWorkItemContext(repository, { workItemId: options.workItemId, position: options.position, purpose: options.purpose, compact: true });
  const reasons = [];
  const problem = (code, source = null) => reasons.push({ code, source });
  const inputs = [];
  const documents = new Map();
  const paths = new Set([...entry.source_manifest.authority_snapshot.paths, entry.work_item.path, ...EXTRA_INPUTS]);
  // Bind other Work Items too: their scope/claim changes may create an overlap.
  for (const name of (await fs.readdir(path.join(repository, ".ai-org/work-items"))).sort()) {
    if (/^WI-[0-9]+\.json$/.test(name)) paths.add(`.ai-org/work-items/${name}`);
  }
  for (const relative of [...paths].sort()) {
    try {
      const source = await readContextPacketSource(repository, relative);
      inputs.push({ path: relative, sha256: source.sha256 });
      if (relative.endsWith(".json")) documents.set(relative, JSON.parse(source.body));
    } catch (error) {
      inputs.push({ path: relative, unavailable: error.code ?? error.message });
      if (!(error.code === "ENOENT" && [".ai-org/project/runtime-workers.json", ".ai-org/project/resources.json"].includes(relative))) problem("authority-source-unavailable", relative);
    }
  }
  const item = documents.get(entry.work_item.path);
  const collaboration = documents.get(".ai-org/project/collaboration.json");
  const workflow = documents.get(".ai-org/core/workflow.json");
  let actorBinding = null;
  let pending = null;
  let diagnostics = null;
  let head = null;
  let productStatus = null;
  try { pending = (await readPendingLeanDelivery(repository))?.journal ?? null; if (pending) problem("pending-lifecycle-recovery"); }
  catch (error) { pending = { invalid: error.message }; problem("invalid-lifecycle-recovery"); }
  try { diagnostics = await readLeanFinishDiagnostics(repository); if (diagnostics.some(record => record.status !== "passed")) problem("unsettled-finish-diagnostics"); }
  catch (error) { diagnostics = { invalid: error.message }; problem("invalid-finish-diagnostics"); }
  try { head = resolveGitRevision(repository, "HEAD"); }
  catch { problem("candidate-unavailable"); }
  if (entry.route.purpose === "recovery") problem("recovery-requires-existing-route");
  if (entry.references.overlaps.length) problem("affected-path-overlap");
  for (const warning of entry.warnings) problem("resolver-warning", warning);
  if (item && collaboration && workflow) {
    if (entry.work_item.workflow_profile !== "lean" || item.risk_tier !== "low" || item.profile_assessment?.scope_class !== "bounded" || item.ui_delivery_mode !== "not-applicable" || item.ui_refs?.length || !["build", "test"].includes(item.state)) problem("unsupported-stage-or-profile");
    if (item.owner_position !== options.position || !["developer", "quality_evaluator"].includes(options.position) || (options.position === "developer" ? item.state !== "build" : item.state !== "test")) problem("wrong-stage-owner");
    if (![item.scope, item.acceptance_criteria, item.affected_paths].every(nonemptyStrings)) problem("missing-task-contract");
    if (item.unresolved?.length) problem("unresolved-work");
    if (!["stable", "not_required"].includes(item.contract_status)) problem("shared-contract-not-stable");
    try {
      const assessment = assessWorkflowProfile(workflow, { requestedProfile: "lean", riskTier: item.risk_tier, scopeClass: item.profile_assessment?.scope_class, escalationTriggers: item.profile_assessment?.escalation_triggers, collaborationProfile: collaboration.profile });
      if (assessment.effective_profile !== "lean") problem("current-policy-requires-stronger-profile");
    } catch { problem("profile-assessment-unavailable"); }
    const agent = documents.get(".ai-org/project/agents.json")?.agents?.find(row => row.id === options.agentId);
    if (!agent || agent.active === false || !agentIsEligible(collaboration, options.agentId, options.position, activeExecutionRequirements(item).disciplines)) problem("ineligible-agent");
    if (collaboration.profile === "solo") {
      if (options.principalId !== "human") problem("invalid-principal");
    } else {
      if (!collaboration.principals?.some(row => row.id === options.principalId && principalStatus(row) === "active") || sponsoredPrincipal(collaboration, options.agentId) !== options.principalId) problem("invalid-principal-or-sponsor");
      try { actorBinding = (await assertLocalActorBinding(repository, options.principalId)).binding; }
      catch (error) { actorBinding = { invalid: error.message }; problem("invalid-local-actor-binding"); }
    }
    if (item.claim?.status === "active") {
      if (!item.claim.id || !item.claim.branch || item.claim.agent_id !== options.agentId || item.claim.principal_id !== options.principalId) problem("conflicting-claim");
      try { resolveGitRevision(repository, item.claim.base_revision); } catch { problem("invalid-claim-base"); }
    }
    const workers = documents.get(".ai-org/project/runtime-workers.json");
    if (workers && (!validateRuntimeWorkerRegistry(workers).valid || workers.workers.some(row => row.work_item_id === item.id && !["completed", "failed", "cancelled"].includes(row.status)))) problem("active-or-invalid-runtime-worker");
    if (item.state === "test") {
      const handoff = [...(item.handoffs ?? [])].reverse().find(row => row.from_position === "developer");
      if (!handoff?.actor || handoff.actor === options.agentId) problem("verifier-must-be-distinct");
      if (handoff?.unresolved?.length) problem("unresolved-handoff");
      try {
        if (!head || item.developer_candidate_revision !== head || resolveGitRevision(repository, handoff?.input_revision) !== head ||
          (item.claim?.status === "active" && resolveGitRevision(repository, item.claim.base_revision) !== head)) problem("candidate-binding-mismatch");
      } catch { problem("candidate-binding-mismatch"); }
      const result = spawnSync("git", ["-C", repository, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...(item.affected_paths ?? []).filter(relative => !relative.startsWith(".ai-org/"))], { encoding: "utf8" });
      productStatus = { status: result.status, digest: sha256(result.stdout ?? "") };
      if (result.status !== 0 || result.stdout) problem("candidate-scope-not-clean");
    }
  }
  return { entry, reasons, item, state: { inputs, head, product_status: productStatus, actor_binding_digest: sha256(JSON.stringify(actorBinding)), recovery_digest: sha256(JSON.stringify(pending)), diagnostics_digest: sha256(JSON.stringify(diagnostics)) } };
}

// Presentation only. The caller must acquire and validate the complete entry first.
// Keep unknown contracts whole rather than silently dropping a future instruction.
const knownKeys = (value, required, optional = []) => value && typeof value === "object" && !Array.isArray(value) &&
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));

export function modelContextView(result) {
  const packet = result?.packet;
  const entry = packet?.entry;
  if (result?.schema_version !== "temple.context-enter/v1" || result.status !== "eligible" ||
      !["temple.context-packet/v2", "temple.context-packet/v3", "temple.context-packet/v4"].includes(packet?.schema_version) ||
      packet.acquisition !== "complete" || entry?.schema_version !== "temple.context-entry/v1" ||
      entry.route?.purpose === "recovery" || entry.warnings?.length || result.reasons?.length || packet.problems?.length ||
      !knownKeys(result.binding, ["repository_digest", "work_item_id", "position", "agent_id", "principal_id", "purpose", "state_digest", "packet_digest", "operation", "reasons"]) ||
      !knownKeys(packet.binding, ["repository_digest", "work_item_id", "stage", "purpose", "position", "entry_digest", "sources", "material", "representation_digest"], ["task_representation_digest", "available_whole_sources"]) ||
      !knownKeys(entry.source_manifest, ["selection_digest", "source_count", "measured_bytes", "sources", "authority_snapshot", "source_bodies_retained"]) ||
      !knownKeys(entry.source_manifest.authority_snapshot, ["digest", "paths"]) ||
      !Array.isArray(packet.binding.sources) || !packet.binding.sources.every(row =>
        knownKeys(row, ["path", "reasons", "status", "bytes", "sha256"]) && row.status === "acquired") ||
      !Array.isArray(entry.source_manifest.sources) || !entry.source_manifest.sources.every(row =>
        knownKeys(row, ["path", "categories", "status", "bytes", "sha256"]) && row.status === "measured")) return result;

  const { sources: acquisitionSources, ...packetBinding } = packet.binding;
  const { source_manifest: manifest, ...semanticEntry } = entry;
  // Preserve both authority paths and unselected references; a digest is not a read receipt.
  // Only duplicated measured inventories are omitted. Source bodies/selection notes stay exact.
  return {
    ...result,
    schema_version: "temple.context-model-view/v1",
    packet: {
      ...packet,
      binding: packetBinding,
      entry: {
        ...semanticEntry,
        source_manifest: {
          selection_digest: manifest.selection_digest,
          authority_snapshot: manifest.authority_snapshot,
          source_bodies_retained: manifest.source_bodies_retained,
          sources: manifest.sources.map(({ path, categories }) => ({ path, categories }))
        }
      }
    },
    representation: {
      kind: "model-reading-view",
      full_format: "--format full",
      note: "Derived reading view, not a complete machine packet or authorization. All acquisition checks ran before rendering. Full validation metadata remains available through the full format; reacquisition may observe a newer revision. Required reads and source restrictions are unchanged."
    }
  };
}
export async function enterWorkItemContext(target, options = {}) {
  const available = validateAvailableWholeSources(options.availableWholeSources);
  if (options.material !== undefined && !["stage", "task"].includes(options.material)) throw new OperationError("INVALID_INPUT", "Entry material must be stage or task");
  if (![options.workItemId, options.position, options.agentId, options.principalId].every(value => typeof value === "string" && value.trim())) throw new OperationError("INVALID_INPUT", "Context enter requires --work-item, --position, --agent-id and --principal-id");
  if (options.expectedPlan !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedPlan)) throw new OperationError("INVALID_INPUT", "Expected entry digest must be 64 lowercase hexadecimal characters");
  const repository = await fs.realpath(target);
  const before = await inspect(repository, options);
  let packet = null;
  const reasons = [...before.reasons];
  if (!reasons.length) {
    packet = await acquireContextPacket(repository, { workItemId: options.workItemId, position: options.position, purpose: options.purpose, material: "stage", leanEntryProcedure: true });
    if (packet.acquisition !== "complete") { reasons.push(...packet.problems); packet = null; }
  }
  const after = await inspect(repository, options);
  if (JSON.stringify(before) !== JSON.stringify(after)) { reasons.push({ code: "entry-changed-during-acquisition", source: null }); packet = null; }
  if (packet && !reasons.length && options.material === "task") packet = taskMaterialPacket(packet, { agentId: options.agentId, handoffActor: before.item.handoffs?.at(-1)?.actor });
  if (packet && !reasons.length) packet = reuseAvailableWholeSources(packet, available);
  const eligible = reasons.length === 0 && packet !== null;
  const operation = eligible ? before.item.claim?.status === "active" ? "work-item finish" : "work-item claim" : "context resolve";
  const binding = { repository_digest: sha256(repository), work_item_id: options.workItemId, position: options.position, agent_id: options.agentId, principal_id: options.principalId,
    purpose: before.entry.route.purpose, state_digest: sha256(JSON.stringify(before)), packet_digest: packet?.packet_digest ?? null, operation, reasons };
  const digest = sha256(JSON.stringify(binding));
  if (options.expectedPlan !== undefined && options.expectedPlan !== digest) throw new OperationError("STALE_PREVIEW", "Entry inputs changed; preview context enter again before proceeding");
  return { schema_version: "temple.context-enter/v1", authority: "navigation-and-derived-material-only", mutation_performed: false,
    status: eligible ? "eligible" : "fallback", entry_digest: digest, binding, reasons, ...(eligible ? {} : { entry: before.entry }), packet,
    navigation: { operation, procedure: eligible ? PROCEDURE : "TEMPLE.md", candidate_revision: before.entry.candidate.developer_revision,
      claim_id: eligible && before.item.claim?.status === "active" ? before.item.claim.id : null, authorization_granted: false,
      packet_next_step_role: eligible ? "existing-route-alternative; use this navigation for the selected optional entry" : null,
      note: eligible ? "Read the returned required bodies and remaining required references. Claim or finish must independently revalidate the exact request; entry_digest is not a finish preview digest." : "Follow the existing compact route and resolve these reasons before using the optional Lean entry. Inspect pending lifecycle or finish diagnostics and follow the original request's recovery procedure; repeating entry does not repair or resume it." },
    coverage: { required_reads_waived: false, bootstrap_waived: false, provider_instruction_loading_verified: false, model_comprehension_verified: false, source_bodies_persisted: false } };
}
