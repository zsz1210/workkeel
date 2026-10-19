import test from 'node:test';
import assert from 'node:assert/strict';
import { executionDigest } from '../src/workkeel-execution-policy.mjs';
import { RISK_TIERS } from '../src/workkeel-risk.mjs';
import { validateLoopBaseline, validateLoopComparison, LOOP_COMPARISON_THRESHOLDS } from '../src/workkeel-loop-comparison.mjs';
const hash = 'a'.repeat(64);
function fixture() {
  const seal = { schema_version: 'workkeel.loop-baseline/v1', source_revision: 'a'.repeat(40), cutoff: '2026-10-19T00:00:00Z', timezone: 'Asia/Tokyo', tasks: ['WK-synthetic'],
    cases: Array.from({ length: 5 }, (_, i) => ({ id: `case-${i}`, task_id: 'WK-synthetic', input_sha256: hash, risk: 'standard' })),
    source_hashes: [{ path: 'src/synthetic.mjs', sha256: hash }], risk_distribution: Object.fromEntries(RISK_TIERS.map(r => [r, r === 'standard' ? 5 : 0])),
    model_settings: { builder: 'synthetic-codex', reviewer: 'synthetic-claude' }, review_rules: 'rules-v1', required_checks: ['syntax'], checks_version: 'checks-v1', calculation_version: 'calc-v1',
    judge: { agent_id: 'independent', model_family: 'claude', anonymous: true, randomized_order: true }, thresholds: LOOP_COMPARISON_THRESHOLDS };
  seal.sha256 = executionDigest(seal);
  const record = { schema_version: 'workkeel.loop-comparison/v1', baseline_sha256: seal.sha256, approval_sha256: hash, author: { agent_id: 'builder', model_family: 'codex' }, attempt_inventory: [], pairs: [], conclusion: 'support-retain', reason: 'Synthetic first pass improves by 20 percentage points.', rollback_status: 'pending' };
  record.pairs = seal.cases.map((c, n) => ({ case_id: c.id, input_sha256: hash, risk: 'standard', ...Object.fromEntries(['before', 'after'].map(side => {
    const id = `${c.id}-${side}`; record.attempt_inventory.push(id);
    return [side, [{ id, candidate: 'b'.repeat(40), input_sha256: hash, risk: 'standard', model_settings_sha256: executionDigest(seal.model_settings), review_rules: seal.review_rules, checks_version: seal.checks_version, calculation_version: seal.calculation_version,
      checks: [{ id: 'syntax', required: true, status: 'pass' }], review: { agent_id: 'independent', model_family: 'claude', judgment: 'pass', blind_id: side === 'before' ? 'X' : 'Y', order: side === 'before' ? 1 : 2 },
      findings: [], first_pass: side === 'after' || n > 0, rework_rounds: side === 'before' && n === 0 ? 1 : 0, wall_ms: 100, human_rescues: 0, tokens: { input: null, output: null }, evidence: [{ path: 'evidence/synthetic.json', sha256: hash }] }]];
  })) }));
  return { seal, record };
}
test('baseline seals revision, cutoff, cases, hashes, risk, models, judges, rules, checks and thresholds', () => {
  const { seal } = fixture(); assert.equal(validateLoopBaseline(seal), seal);
  for (const field of ['source_revision', 'cutoff', 'timezone', 'tasks', 'cases', 'source_hashes', 'risk_distribution', 'model_settings', 'review_rules', 'checks_version', 'calculation_version', 'judge', 'thresholds']) {
    const bad = structuredClone(seal); delete bad[field]; assert.throws(() => validateLoopBaseline(bad));
  }
  const changed = structuredClone(seal); changed.cases[0].input_sha256 = 'b'.repeat(64); assert.throws(() => validateLoopBaseline(changed), /seal/);
});
test('five fixed pairs and all attempts validate; learning IDs are optional provenance only and tokens have no gate', () => {
  const { seal, record } = fixture(); assert.equal(validateLoopComparison(record, seal), record);
  record.learning_ids = ['LEARN-synthetic']; record.pairs[0].after[0].tokens.input = 10000000;
  assert.equal(validateLoopComparison(record, seal), record);
  record.attempt_inventory.push('omitted-failure'); assert.throws(() => validateLoopComparison(record, seal), /all attempts/);
});
test('insufficient/missing measurements require inconclusive and changed conditions are refused', () => {
  const { seal, record } = fixture(); record.pairs[0].after[0].wall_ms = null;
  assert.throws(() => validateLoopComparison(record, seal), /inconclusive/); record.conclusion = 'inconclusive'; validateLoopComparison(record, seal);
  record.pairs[0].after[0].input_sha256 = 'b'.repeat(64); assert.throws(() => validateLoopComparison(record, seal), /conditions/);
  const small = fixture(); small.record.pairs.pop(); small.record.attempt_inventory = small.record.pairs.flatMap(p => [...p.before, ...p.after].map(a => a.id));
  assert.throws(() => validateLoopComparison(small.record, small.seal), /inconclusive/);
});
test('quality, distinct judge, Must fix, Dismiss evidence, no metric regression, wall and rescue gates', () => {
  for (const change of [
    a => { a.checks[0].status = 'fail'; }, a=>{a.checks[0].required=false;}, a=>{a.checks[0].id='other';}, a => { a.review.judgment = 'fail'; }, a => { a.review.agent_id = 'builder'; },
    a => { a.findings = [{ disposition: 'Must fix', resolved: false, reason: 'Synthetic defect', counterevidence: null }]; },
    a => { a.findings = [{ disposition: 'Dismiss', resolved: true, reason: 'Synthetic dismissal', counterevidence: null }]; },
    a => { a.rework_rounds = 2; }, a => { a.wall_ms = 151; }, a => { a.human_rescues = 1; }
  ]) { const { seal, record } = fixture(); change(record.pairs[0].after[0]); assert.throws(() => validateLoopComparison(record, seal)); }
});

test('sparse pair and attempt lists cannot fake the minimum sample size',()=>{
 const {seal,record}=fixture();delete record.pairs[4];record.attempt_inventory=record.pairs.flatMap(p=>[...p.before,...p.after].map(a=>a.id));assert.throws(()=>validateLoopComparison(record,seal),/sparse/);
});

test('high and critical pairs require distinct Codex/Claude cross-review',()=>{
  for(const risk of ['high','critical']){
    const {seal,record}=fixture();seal.cases.forEach(c=>{c.risk=risk;});seal.risk_distribution=Object.fromEntries(RISK_TIERS.map(r=>[r,r===risk?5:0]));
    const {sha256,...body}=seal;seal.sha256=executionDigest(body);record.baseline_sha256=seal.sha256;
    record.pairs.forEach(p=>{p.risk=risk;[...p.before,...p.after].forEach(a=>{a.risk=risk;});});
    validateLoopComparison(record,seal);
    seal.judge.model_family='codex';const {sha256:old,...changed}=seal;seal.sha256=executionDigest(changed);record.baseline_sha256=seal.sha256;
    record.pairs.forEach(p=>[...p.before,...p.after].forEach(a=>{a.review.model_family='codex';}));
    assert.throws(()=>validateLoopComparison(record,seal),/cross-review/);
  }
});
