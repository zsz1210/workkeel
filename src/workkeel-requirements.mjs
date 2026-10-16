import {readTaskFile} from './task-contract.mjs';
import {exactKeys, executionDigest} from './workkeel-execution-policy.mjs';

const fail = message => { throw Error(`Requirements: ${message}`); };
const text = value => typeof value === 'string' && value.trim() && value.length <= 8000;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value);
const under = (file, root) => root === '.' || file === root || file.startsWith(root + '/');
const relative = value => typeof value === 'string' && value.length <= 1024 && value.trim() === value &&
  value && !/[\\\x00-\x1f\x7f*?\[\]{}:]/.test(value) && !value.startsWith('/') &&
  (value === '.' || value.split('/').every(part => part && part !== '.' && part !== '..'));
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const list = (value, max = 64) => Array.isArray(value) && value.length > 0 && value.length <= max;

/** Optional, authority-pinned decision sources. Hashes establish identity, not truth. */
export async function loadTaskRequirements(target, contract, {enforceCoverage = true, requiredRefs = []} = {}) {
  const documents = [], requirements = [], sources = new Map(), ids = new Set();
  let sourceBytes = 0;
  for (const ref of contract.environment.data.policy_refs) {
    const file = await readTaskFile(target, ref, {preserveBom: true});
    let document;
    try { document = JSON.parse(file.content.replace(/^\uFEFF/, '')); } catch { continue; }
    if (!document?.schema_version?.startsWith?.('workkeel.requirements/')) continue;
    if (document.schema_version !== 'workkeel.requirements/v1') fail('unsupported decision source version');
    exactKeys(document, ['schema_version', 'id', 'requirements']);
    if (!id(document.id) || !list(document.requirements)) fail('invalid bounded decision source');
    if (documents.length >= 8) fail('too many decision sources');
    const local = new Map();
    for (const requirement of document.requirements) {
      exactKeys(requirement, ['id', 'criterion', 'paths', 'sources', 'superseded_by', 'visual']);
      if (!id(requirement.id) || ids.has(requirement.id) || !text(requirement.criterion) ||
          !list(requirement.paths, 32) || requirement.paths.some(p => !relative(p)) ||
          new Set(requirement.paths).size !== requirement.paths.length || !list(requirement.sources, 8) ||
          typeof requirement.visual !== 'boolean' || requirement.superseded_by !== null && !id(requirement.superseded_by)) fail('invalid or duplicate requirement');
      ids.add(requirement.id); local.set(requirement.id, requirement);
      if (ids.size > 64) fail('too many requirements');
      const sourcePaths = new Set();
      for (const source of requirement.sources) {
        exactKeys(source, ['path', 'sha256', 'quote']);
        if (!relative(source.path) || source.path === '.' || !hash(source.sha256) || !text(source.quote) || sourcePaths.has(source.path)) fail('invalid original source');
        sourcePaths.add(source.path);
        if (!contract.environment.read_paths.some(root => under(source.path, root))) fail('original source is outside task read scope');
        const actual = await readTaskFile(target, source.path, {preserveBom: true});
        if (!sources.has(source.path)) sourceBytes += Buffer.byteLength(actual.content);
        if (sourceBytes > 1024 * 1024) fail('original decision sources exceed 1 MiB; split the approved scope');
        if (actual.bytes_digest !== source.sha256 || !actual.content.includes(source.quote)) fail('original decision source changed or quote is missing');
        const existing = sources.get(source.path);
        if (existing && existing.sha256 !== source.sha256) fail('conflicting original source versions');
        sources.set(source.path, {path: source.path, sha256: source.sha256});
      }
      const applicable = requirement.superseded_by === null && requirement.paths.some(p =>
        contract.environment.write_paths.some(root => under(p, root) || under(root, p)));
      if (enforceCoverage && applicable && !contract.acceptance.criteria.includes(requirement.criterion)) fail(`approved requirement omitted: ${requirement.id}`);
      requirements.push({...requirement, applicable, document_ref: ref});
    }
    for (const requirement of local.values()) {
      const seen = new Set([requirement.id]); let next = requirement.superseded_by;
      while (next !== null) {
        if (!local.has(next) || seen.has(next)) fail('supersession must resolve to an active decision in the same document');
        seen.add(next); next = local.get(next).superseded_by;
      }
    }
    documents.push({path: ref, sha256: file.bytes_digest});
  }
  if (requiredRefs.some(ref => !documents.some(document => document.path === ref))) fail('required project decision source has no valid requirement bundle');
  return {documents, sources: [...sources.values()], requirements,
    active: requirements.filter(r => r.superseded_by === null),
    applicable: requirements.filter(r => r.applicable),
    sha256: executionDigest({documents, sources: [...sources.values()]})};
}

export function requirementInstructions(set) {
  if (!set.documents.length) return '';
  return ['Approved decision sources (summaries and existing UI cannot replace these):',
    ...set.active.map(r => `${r.id}: ${r.criterion}\n${r.sources.map(s => `Original ${s.path}: ${JSON.stringify(s.quote)}`).join('\n')}`),
    'Before work, compare the assigned instruction, exclusions and selected references with these original decisions. Report semantic conflicts or omissions; do not silently rewrite a decision or treat an old/current implementation as approval.',
    'Read-only discovery assesses these requirements; it does not claim product fulfillment. Prioritize known unmet requirements and user-reported failures before speculative improvements.',
    'Delivery and independent review need separate workkeel.requirement-outcomes/v1 reports for every applicable requirement, exact candidate, original source pins and actual evidence. A hash or passing unrelated test is not semantic or visual proof.'
  ].join('\n');
}

/** An explicit declaration can be checked; arbitrary prose still needs actual review. */
export function assertRequirementAlignment(set, alignment) {
  if (!set.documents.length && alignment === undefined) return;
  if (!Array.isArray(alignment) || alignment.length !== set.active.length) fail('alignment must cover each active decision');
  const seen = new Set();
  for (const row of alignment) {
    exactKeys(row, ['id', 'status', 'observation']);
    if (!set.active.some(r => r.id === row.id) || seen.has(row.id) || !text(row.observation)) fail('invalid requirement alignment');
    seen.add(row.id);
    if (row.status !== 'aligned') fail(`instruction conflict or uncertainty: ${row.id}`);
  }
}

/** Discovery reports observations, never delivery completion. Unknown/unmet
 * decisions must yield a linked proposal, even when the proposal needs a human. */
export async function assertRequirementAssessment(target, contract, report) {
  const set = await loadTaskRequirements(target, contract);
  if (!set.active.length) return [];
  if (!Array.isArray(report?.requirement_assessments) || report.requirement_assessments.length !== set.active.length) fail('discovery must assess every active decision');
  const seen = new Set(), pins = [...set.documents, ...set.sources];
  const {checkEvidenceFile} = await import('./workkeel-evidence-file.mjs');
  for (const row of report.requirement_assessments) {
    exactKeys(row, ['id','status','observation','sources','evidence','proposal_id']);
    const requirement = set.active.find(r => r.id === row.id);
    if (!requirement || seen.has(row.id) || !text(row.observation) || !['observed-satisfied','unmet','unverified','not-applicable'].includes(row.status) ||
        !Array.isArray(row.evidence) || row.evidence.length > 32) fail('invalid discovery assessment');
    seen.add(row.id);
    if (executionDigest(row.sources) !== executionDigest(requirement.sources.map(({path,sha256}) => ({path,sha256})))) fail('discovery omitted original decision sources');
    if (['unmet','unverified'].includes(row.status)) {
      if (!id(row.proposal_id) || !report.proposals?.some(p => p.id === row.proposal_id)) fail('unmet or unknown decision needs a linked proposal');
    } else if (row.proposal_id !== null) fail('unexpected discovery proposal link');
    if (['observed-satisfied','unmet'].includes(row.status) && !row.evidence.length) fail('discovery observation needs actual evidence');
    for (const pin of row.evidence) {
      await checkEvidenceFile(target, contract.environment.read_paths, contract.id, pin);
      pins.push({path:pin.path,sha256:pin.sha256});
    }
  }
  return [...new Map(pins.map(pin => [pin.path,pin])).values()];
}

/** Enforced at native handoff/review. This validates an authored judgment, not its truth. */
export async function assertRequirementOutcomes(target, item, request, phase) {
  const set = await loadTaskRequirements(target, item.contract);
  if (!set.applicable.length) return;
  const reports = [];
  for (const ref of request.evidence) {
    let report;
    try { report = JSON.parse((await readTaskFile(target, ref)).content); } catch { continue; }
    if (report?.schema_version === 'workkeel.requirement-outcomes/v1' && report.phase === phase && report.candidate_revision === request.revision) reports.push(report);
  }
  if (reports.length !== 1) fail(`one ${phase} requirement outcome report is required`);
  const report = reports[0];
  exactKeys(report, ['schema_version', 'task_id', 'contract_sha256', 'candidate_revision', 'requirements_sha256', 'phase', 'actor', 'requirements', 'open_findings']);
  exactKeys(report.actor, ['agent_id', 'principal_id']);
  if (report.task_id !== item.id || report.contract_sha256 !== item.contract_sha256 ||
      report.candidate_revision !== request.revision || report.requirements_sha256 !== set.sha256 ||
      report.actor.agent_id !== request.actor.agent_id || report.actor.principal_id !== request.actor.principal_id) fail('requirement report authority, actor or candidate mismatch');
  if (!Array.isArray(report.requirements) || report.requirements.length !== set.applicable.length ||
      !Array.isArray(report.open_findings) || report.open_findings.length > 64 || report.open_findings.some(v => !text(v))) fail('invalid requirement outcome coverage');
  const passing = phase === 'delivery' || request.judgment === 'pass';
  if (passing && report.open_findings.length) fail('unresolved requirement findings');
  const seen = new Set();
  const {checkEvidenceFile} = await import('./workkeel-evidence-file.mjs');
  for (const row of report.requirements) {
    exactKeys(row, ['id', 'status', 'observation', 'sources', 'evidence']);
    const requirement = set.applicable.find(r => r.id === row.id);
    if (!requirement || seen.has(row.id) || !text(row.observation) || !['pass', 'fail', 'partial', 'unverified'].includes(row.status) || !list(row.evidence, 32)) fail('invalid or missing requirement observation');
    seen.add(row.id);
    if (passing && row.status !== 'pass') fail(`requirement is not passing: ${row.id}`);
    if (executionDigest(row.sources) !== executionDigest(requirement.sources.map(({path, sha256}) => ({path, sha256})))) fail('original decision sources were not identified');
    let screenshot = false;
    for (const pin of row.evidence) screenshot = await checkEvidenceFile(target, item.contract.environment.read_paths, item.id, pin) || screenshot;
    if (passing && requirement.visual && !screenshot) fail(`visual evidence missing: ${row.id}`);
  }
}
