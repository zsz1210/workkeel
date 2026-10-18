import fs from 'node:fs/promises';
import Ajv from 'ajv';
import { formatJson, sha256 } from './files.mjs';
import { readTaskFile, validateTaskContract } from './task-contract.mjs';
import { readTaskProject, assertActor, safeDirectory, readNativeGit } from './workkeel-project.mjs';
import { readNativeTask, inspectTaskCandidate } from './workkeel-tasks.mjs';
import { elevatedRisk, isTeamPolicy, taskRisk } from './workkeel-risk.mjs';

const hash = value => sha256(formatJson(value));
const text = { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revision = { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (items, minItems = 0) => ({ type: 'array', items, minItems, maxItems: 64, uniqueItems: true });
const pin = object({ path: text, sha256: digest });
const versions = list(object({ name: text, version: text }));
const environment = {
  tests: list(pin, 1), oracles: list(pin, 1), inputs: list(pin, 1),
  runtime: { ...versions, minItems: 1 }, tools: { ...versions, minItems: 1 },
  packages: versions, command: text, configuration: list(pin)
};
const measurement = object({
  id: text,
  dimensions: object({ candidate_revision: revision, contract_sha256: digest, policy_sha256: digest,
    dependency_snapshot_sha256: digest, ...environment }),
  coverage: list(object({ criterion: text, extent: { enum: ['complete', 'partial'] } }), 1),
  status: { enum: ['pass', 'fail', 'incomplete', 'unknown'] },
  provenance: object({ kind: { enum: ['captured', 'asserted', 'unknown'] }, source: text,
    actor: object({ agent_id: text, principal_id: text }), files: list(pin),
    completed: { type: 'boolean' }, exit_code: { type: ['integer', 'null'] } })
});
const inputSchema = { type: 'object', additionalProperties: false, properties: {
  schema_version: { const: 'workkeel.review-assessment-input/v1' }, candidate_revision: revision,
  impact_ref: text, current: object(environment), measurements: list(measurement), blockers: list(text)
} };
const validateInput = new Ajv({ strict: true, allErrors: true }).compile(inputSchema);
const validateImpact = new Ajv({ strict: true }).compile(object({
  schema_version: { const: 'workkeel.review-impact/v1' }, task_id: text, approved_by: text,
  irreversible_impact: { enum: ['none', 'material', 'unknown'] }
}));
const fileDimensions = ['tests', 'oracles', 'inputs', 'configuration'];
const versionDimensions = ['runtime', 'tools', 'packages'];
function normalizedEnvironment(value) {
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key,
    Array.isArray(v) ? [...v].sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name)) : v]));
}
function checkInput(input) {
  if (!validateInput(input) || Object.keys(input).length && !input.schema_version ||
      Buffer.byteLength(JSON.stringify(input)) > 1024 * 1024) throw Error('Invalid bounded review assessment input or unsupported version');
  const ids = input.measurements?.map(m => m.id) ?? [];
  if (new Set(ids).size !== ids.length) throw Error('Measurement IDs must be unique');
  for (const env of [input.current, ...(input.measurements ?? []).map(m => m.dimensions)].filter(Boolean)) {
    for (const key of [...fileDimensions, ...versionDimensions]) {
      const names = env[key].map(x => x.path ?? x.name);
      if (new Set(names).size !== names.length) throw Error('Dimension entries must have unique paths or names');
    }
  }
}
async function git(target, args) {
  return readNativeGit(target, args, { maxBuffer: 1024 * 1024 });
}

/** Advisory snapshot only. No lifecycle writer, command execution, or model call. */
export async function assessNativeTask(targetInput, id, input = {}) {
  checkInput(input);
  const target = await fs.realpath(targetInput);
  const observedFiles = new Map(), reasons = [], missing = [], measurements = [];
  const issue = (code, detail, blocking = true) => reasons.push({ code, detail, blocking });
  const read = async ref => {
    if (!observedFiles.has(ref) && observedFiles.size >= 1024) throw Error('Assessment exceeds 1024 observed files');
    const result = await readTaskFile(target, ref);
    const old = observedFiles.get(ref);
    if (old && old !== result.bytes_digest) throw Error('Assessment input changed during observation');
    observedFiles.set(ref, result.bytes_digest);
    return result;
  };
  await read('workkeel.lock');
  const project = await readTaskProject(target);
  await read(`.ai-org/work-items/${id}.json`);
  const item = await readNativeTask(target, id);
  const contract = item.contract;
  const checkPins = async (pins, category) => {
    if (!Array.isArray(pins) || pins.length > 256) throw Error('Invalid or oversized evidence pin collection');
    for (const p of pins) {
      try {
        if ((await read(p.path)).digest !== p.sha256) issue(`${category}-changed`, p.path);
      } catch (error) { issue(`${category}-unavailable`, `${p.path}: ${error.message}`); }
    }
  };
  const checkAuthority = async task => {
    if (hash(project.policy) !== task.policy_sha256) issue('policy-changed', task.id);
    const validation = validateTaskContract(task.contract);
    if (!validation.contract_complete) issue('authority-unresolved', `${task.id}: ${[...validation.errors, ...validation.incomplete_fields].join('; ')}`);
    try { assertActor(project.policy, task.contract.actor); }
    catch (error) { issue('actor-unresolved', error.message); }
    if (!project.policy.approvers.includes(task.contract.authorization?.approved_by)) issue('approver-unresolved', task.id);
    await checkPins(task.authority_pins, 'authority');
  };
  await checkAuthority(item);
  try { await safeDirectory(target, contract.environment.cwd); }
  catch (error) { issue('working-directory-unavailable', error.message); }
  let dependencyReads = 0;
  const dependencySnapshot = async (task, ancestors = new Set()) => {
    if (ancestors.has(task.id)) throw Error('Cyclic dependency snapshot');
    dependencyReads += 1;
    if (dependencyReads > 128 || ancestors.size > 32) throw Error('Dependency assessment exceeds its task or depth bound');
    const result = [];
    for (const dependencyId of task.contract.dependencies) {
      await read(`.ai-org/work-items/${dependencyId}.json`);
      const dep = await readNativeTask(target, dependencyId);
      await checkAuthority(dep);
      if (dep.state !== 'done' || !dep.delivery || dep.review?.judgment !== 'pass' || dep.closeout?.revision !== dep.delivery.revision)
        throw Error(`Dependency ${dependencyId} has no accepted native candidate`);
      await checkPins([...dep.delivery.evidence, ...dep.review.evidence, ...dep.closeout.evidence], 'dependency-evidence');
      await dependencySnapshot(dep, new Set([...ancestors, task.id]));
      if (task.base_revision) await git(target, ['merge-base', '--is-ancestor', dep.delivery.revision, task.base_revision]);
      result.push({ id: dep.id, version: dep.version, revision: dep.delivery.revision,
        record_sha256: hash(Object.fromEntries(Object.entries(dep).filter(([key]) => key !== 'history'))) });
    }
    if (task.dependency_pins && hash(result) !== hash(task.dependency_pins)) throw Error('Accepted dependency snapshot changed');
    return result;
  };
  let dependencies = null;
  try { dependencies = await dependencySnapshot(item); }
  catch (error) { issue('dependency-unresolved', error.message); }
  for (const stage of ['delivery', 'review', 'closeout']) if (item[stage]) await checkPins(item[stage].evidence, `${stage}-evidence`);
  if (item.review?.judgment === 'fail') issue('failed-independent-review', 'The current candidate has a failed independent review.');
  if (item.state === 'cancelled') issue('cancelled-task', 'This task is cancelled.');
  for (const blocker of input.blockers ?? []) issue('declared-blocker', blocker);

  let impact = { value: 'unknown', source: null, basis: 'unresolved' };
  if (input.impact_ref) {
    const authorityPin = item.authority_pins.find(p => p.path === input.impact_ref);
    try {
      const file = await read(input.impact_ref), document = JSON.parse(file.content);
      if (!authorityPin || authorityPin.sha256 !== file.digest || !validateImpact(document) ||
          document.task_id !== id || document.approved_by !== contract.authorization.approved_by ||
          !project.policy.approvers.includes(document.approved_by)) throw Error('Impact statement must match a current pinned task authority file and approving Principal');
      impact = { value: document.irreversible_impact, source: input.impact_ref, basis: 'approved-declaration-not-authentication' };
    } catch (error) { issue('impact-authority-unresolved', error.message); }
  }
  if (impact.value === 'unknown') { missing.push('approved irreversible-impact assessment'); issue('irreversible-impact-unknown', 'Native v1 does not encode irreversible impact; do not infer it from diff size or network scope.'); }
  // Delivery escalation counts: the effective tier, not the contract's declared one.
  const risk = taskRisk(item), elevated = elevatedRisk(risk);
  const assurance = elevated || contract.environment.data.classification === 'sensitive' || impact.value === 'material';
  if (assurance) issue('elevated-review-required', 'High or critical risk, sensitive data or material irreversible impact requires elevated review: a reviewer Agent from another model family with its own review report, and close by the approving Principal.', false);
  const separation = project.policy.review_separation === 'distinct-principal' || contract.verification.separation === 'distinct-principal' ||
    elevated && isTeamPolicy(project.policy) ? 'distinct-principal' : 'distinct-agent';
  if (!['distinct-agent', 'distinct-principal'].includes(contract.verification.separation) ||
      project.policy.review_separation === 'distinct-principal' && contract.verification.separation !== 'distinct-principal')
    issue('review-floor-unresolved', 'The task must meet the current project review separation.');

  const head = (await git(target, ['rev-parse', 'HEAD'])).trim();
  const candidate = input.candidate_revision ?? item.delivery?.revision ?? head;
  let inspection = null, changes = [], inspectionInput;
  try {
    if (!item.base_revision) throw Error('Candidate assessment requires a recorded claim base');
    const action = item.delivery ? 'review' : 'handoff';
    inspectionInput = { action, request: { operation_id: 'advisory-assessment', expected_version: item.version,
      actor: contract.actor, revision: candidate, evidence: [] } };
    inspection = await inspectTaskCandidate(target, id, inspectionInput);
    if (!inspection.candidate_files_passed) for (const problem of inspection.issues) issue(problem.code, problem.path);
    const raw = await git(target, ['diff', '--no-ext-diff', '--no-textconv', '--raw', '--no-abbrev', '--no-renames', '-z', item.base_revision, candidate, '--']);
    const entries = raw.split('\0').filter(Boolean);
    if (entries.length > 512) throw Error('Candidate exceeds 256 changed paths');
    for (let n = 0; n < entries.length; n += 2) {
      const [oldMode, newMode, oldObject, newObject, status] = entries[n].slice(1).split(' ');
      changes.push({ path: entries[n + 1], old_mode: oldMode, new_mode: newMode, old_object: oldObject, new_object: newObject, status });
      if ([oldMode, newMode].some(mode => !['000000', '100644', '100755'].includes(mode)))
        issue('unsupported-candidate-file-type', entries[n + 1]);
    }
    if (changes.length) issue('actual-changes-require-review', 'Inspect actual changed objects and requirements; extension, line count and self-test counts cannot waive independent review.', false);
    if (changes.some(c => /\.(?:md|txt|rst)$/.test(c.path))) issue('prose-semantics-unresolved', 'Prose can contain instructions, specifications or executable examples; non-normative use is not proven.', false);
  } catch (error) { issue('candidate-unresolved', error.message); }

  const observedDimensions = { candidate_revision: candidate, contract_sha256: item.contract_sha256,
    policy_sha256: hash(project.policy), dependency_snapshot_sha256: dependencies === null ? null : hash(dependencies) };
  const checkDimensionFiles = async (env, failures) => {
    for (const key of fileDimensions) for (const p of env[key]) {
      try { if ((await read(p.path)).bytes_digest !== p.sha256) failures.push(`${key}-bytes-changed:${p.path}`); }
      catch (error) { failures.push(`${key}-unavailable:${p.path}:${error.message}`); }
    }
    for (const key of versionDimensions) if (env[key].some(v => /^(?:unknown|latest|\*|unresolved)$/i.test(v.version.trim()))) failures.push(`${key}-version-unknown`);
  };
  const currentProblems = [];
  if (input.current) await checkDimensionFiles(input.current, currentProblems);
  else missing.push('current test, oracle, input, runtime, tool, package, command and configuration dimensions');
  for (const m of input.measurements ?? []) {
    const failures = [...currentProblems];
    if (!input.current) failures.push('current-dimensions-missing');
    for (const [key, value] of Object.entries(observedDimensions)) if (m.dimensions[key] !== value) failures.push(`${key}-mismatch`);
    if (input.current) for (const key of Object.keys(environment)) {
      if (hash(normalizedEnvironment({ [key]: input.current[key] })) !== hash(normalizedEnvironment({ [key]: m.dimensions[key] }))) failures.push(`${key}-mismatch`);
    }
    await checkDimensionFiles(m.dimensions, failures);
    if (m.status !== 'pass') failures.push(`measurement-${m.status}`);
    if (m.provenance.kind !== 'captured') failures.push('execution-provenance-not-captured');
    if (!m.provenance.completed) failures.push('execution-incomplete');
    if (m.provenance.exit_code !== 0) failures.push('execution-not-successful');
    if (!m.provenance.files.length) failures.push('capture-files-missing');
    try { assertActor(project.policy, m.provenance.actor); } catch { failures.push('source-actor-unregistered'); }
    for (const p of m.provenance.files) {
      try { if ((await read(p.path)).bytes_digest !== p.sha256) failures.push(`capture-bytes-changed:${p.path}`); }
      catch (error) { failures.push(`capture-unavailable:${p.path}:${error.message}`); }
    }
    const criteria = m.coverage.map(c => c.criterion);
    if (new Set(criteria).size !== criteria.length || criteria.some(c => !contract.acceptance.criteria.includes(c))) throw Error('Coverage must name unique exact approved criteria');
    if (m.coverage.some(c => c.extent !== 'complete')) failures.push('coverage-incomplete');
    if (m.status === 'fail' && m.dimensions.candidate_revision === candidate) issue('current-measurement-failed', m.id);
    measurements.push({ id: m.id, status: m.status, candidate_revision: m.dimensions.candidate_revision,
      candidate_status: m.dimensions.candidate_revision === candidate ? 'current' : 'historical',
      declared_dimensions: m.dimensions, coverage: m.coverage, provenance: m.provenance,
      reuse: failures.length ? 'ineligible' : 'candidate-for-independent-confirmation', reasons: [...new Set(failures)] });
  }
  // Recheck every observed byte and candidate diagnostic. This is not a lock or
  // a durable snapshot; the actual lifecycle operation still checks afresh.
  for (const [ref, expected] of observedFiles) {
    try { if ((await readTaskFile(target, ref)).bytes_digest !== expected) issue('concurrent-input-change', ref); }
    catch (error) { issue('concurrent-input-change', `${ref}: ${error.message}`); }
  }
  if ((await git(target, ['rev-parse', 'HEAD'])).trim() !== head) issue('concurrent-head-change', 'HEAD changed during assessment.');
  if (inspection) {
    try { if (hash(await inspectTaskCandidate(target, id, inspectionInput)) !== hash(inspection)) issue('concurrent-candidate-change', 'Candidate diagnostics changed during assessment.'); }
    catch (error) { issue('concurrent-candidate-change', error.message); }
  }
  const blocked = reasons.some(r => r.blocking);
  if (blocked || assurance) for (const m of measurements) if (m.reuse === 'candidate-for-independent-confirmation') {
    m.reuse = 'ineligible'; m.reasons.push('assessment-blocked-or-assurance-required');
  }
  const coverage = contract.acceptance.criteria.map(criterion => {
    const applicable = measurements.filter(m => m.coverage.some(c => c.criterion === criterion));
    const candidates = applicable.filter(m => m.reuse === 'candidate-for-independent-confirmation').map(m => m.id);
    const failed = applicable.filter(m => m.status === 'fail' && m.candidate_status === 'current').map(m => m.id);
    const historicalFailed = applicable.filter(m => m.status === 'fail' && m.candidate_status === 'historical').map(m => m.id);
    if (!candidates.length) missing.push(`compatible complete measurement for: ${criterion}`);
    return { criterion, status: failed.length ? 'failure-reported' : candidates.length ? 'declared-coverage-awaiting-independent-confirmation' : 'missing-or-ineligible',
      reuse_candidates: candidates, failed_measurements: failed, historical_failed_measurements: historicalFailed };
  });
  return {
    schema_version: 'workkeel.review-assessment/v1', authority: 'observation-only', mutation_status: 'no-write',
    execution_authorized: false, task_id: id, task_version: item.version,
    route: blocked ? 'blocked' : assurance ? 'elevated-independent-review' : 'focused-independent-review',
    current_review_floor: { separation, independent_judgment_required: true, mechanical_owner_acceptance: 'unsupported-in-v1',
      distinct_model_family_required: elevated, review_report_required: elevated, approving_principal_closes: elevated },
    repository_observed: { dimensions: observedDimensions, head_revision: head, base_revision: item.base_revision,
      risk_tier: risk, declared_risk_tier: contract.verification.risk_tier, data_classification: contract.environment.data.classification,
      dependencies, changes, candidate_inspection: inspection },
    declarations: { irreversible_impact: impact, current_measurement_environment: input.current ?? null, blockers: input.blockers ?? [] },
    reasons, missing_facts: missing, coverage, measurements,
    limitations: ['Advisory observations never authorize or accept work; current lifecycle guards and required suites remain unchanged.',
      'File digests establish byte integrity, not test execution or semantic correctness. Coverage and execution provenance are caller declarations.',
      'Runtime, tool, package, command and configuration completeness require independent confirmation; commands are never executed.',
      'Reuse concerns captured measurements only, never another actor\'s acceptance judgment. No mechanical exemption is implemented.',
      'This bounded local read is rechecked but is not an atomic or authenticated snapshot.']
  };
}
