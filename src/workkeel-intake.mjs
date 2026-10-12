import { readTaskFile, validateTaskContract } from './task-contract.mjs';
import { readTaskProject, assertActor, assertApprover } from './workkeel-project.mjs';
import { createNativeTask } from './workkeel-tasks.mjs';
import { exactKeys, executionDigest } from './workkeel-execution-policy.mjs';
import { formatJson, sha256 } from './files.mjs';

/** A brief reduces repeated structure; it does not infer approval or tool grants. */
export async function previewTaskIntake(target, brief) {
  exactKeys(brief, ['schema_version','id','goal','actor','acceptance','environment','authorization'],
    ['include','exclude','execution','dependencies','risk_tier','skills','operation_id']);
  if (brief.schema_version !== 'workkeel.task-brief/v1') throw Error('Unsupported task brief');
  const project = await readTaskProject(target);
  assertActor(project.policy, brief.actor);
  assertApprover(project.policy, brief.actor);
  const contract = {
    schema_version: 'workkeel.task-contract/v1', id: brief.id, goal: brief.goal,
    actor: brief.actor, state: 'intake', scope: {include: brief.include ?? [brief.goal], exclude: brief.exclude ?? []},
    dependencies: brief.dependencies ?? [], acceptance: {criteria: brief.acceptance, evidence: []},
    verification: {risk_tier: brief.risk_tier ?? 'standard', separation: project.policy.review_separation,
      implementer: null, reviewer: null, candidate_revision: null}, handoff: null,
    environment: brief.environment, authorization: brief.authorization, skills: brief.skills ?? [],
    execution: brief.execution ?? {runtime: {kind: 'host-owned', adapter_id: null, required_features: []}, model_connection: {kind: 'native'}},
    legacy: null
  };
  const validation = validateTaskContract(contract);
  if (!validation.contract_complete) throw Error('Incomplete brief: '+[...validation.errors,...validation.incomplete_fields].join('; '));
  if (!['low','standard'].includes(contract.verification.risk_tier) || contract.environment.data.classification === 'sensitive') throw Error('Use the established assurance workflow for high-risk or sensitive tasks');
  if (contract.authorization.approved_by !== brief.actor.principal_id) throw Error('Brief actor must be its registered approving Principal');
  const refs = [...new Set([contract.authorization.approval_ref,...contract.environment.data.policy_refs,...contract.skills])];
  const pins = [];
  for (const ref of refs) {
    const file = await readTaskFile(target, ref);
    if (!file.content.trim()) throw Error('Approval and policy references must not be empty');
    pins.push({path:ref,sha256:file.digest});
  }
  const request = {operation_id:brief.operation_id ?? 'intake-'+executionDigest(contract).slice(0,24),expected_version:0,actor:brief.actor};
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(request.operation_id)) throw Error('Invalid intake operation ID');
  return {schema_version:'workkeel.task-intake/v1',contract,request,pins,
    policy_digest:sha256(formatJson(project.policy)),
    fingerprint:executionDigest({contract,request,policy:project.policy,pins}),
    mutation_status:'no-write',execution_authorized:false,
    next_action:'Inspect the generated contract and approval references; apply this exact preview fingerprint to create the task.'};
}

export async function applyTaskIntake(target, brief, fingerprint) {
  const preview = await previewTaskIntake(target, brief);
  if (typeof fingerprint !== 'string' || fingerprint !== preview.fingerprint) throw Error('Stale intake preview; inspect a fresh preview before applying');
  return createNativeTask(target, preview.contract, preview.request, {expectedPolicyDigest:preview.policy_digest,expectedAuthorityPins:preview.pins});
}
