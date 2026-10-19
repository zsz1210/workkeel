import { exactKeys, executionDigest } from './workkeel-execution-policy.mjs';
import { RISK_TIERS } from './workkeel-risk.mjs';

const fail = message => { throw Error('Loop comparison: ' + message); };
const text = v => { if (typeof v !== 'string' || !v.trim() || v.length > 4000) fail('nonempty bounded text required'); };
const hash = v => { if (!/^[a-f0-9]{64}$/.test(v ?? '')) fail('SHA256 required'); };
const revision = v => { if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(v ?? '')) fail('exact source revision required'); };
const number = v => { if (!Number.isFinite(v) || v < 0) fail('nonnegative measurement required'); };
const integer = v => { number(v); if (!Number.isSafeInteger(v)) fail('integer required'); };
const list = (xs, fn) => { if (!Array.isArray(xs) || xs.length > 1000) fail('bounded list required'); for(let i=0;i<xs.length;i++){if(!Object.hasOwn(xs,i))fail("sparse data is incomplete");fn(xs[i]);} };
const unique = xs => { if (new Set(xs).size !== xs.length) fail('duplicate case or attempt'); };
const date = v => { if (typeof v !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) fail('fixed cutoff with offset required'); };
const risk = v => { if (!RISK_TIERS.includes(v)) fail('known risk required'); };
const THRESHOLDS = Object.freeze({ min_pairs: 5, first_pass_increase: 0.20, average_rework_decrease: 0.2, other_metric_regression: 0, wall_clock_increase: 0.10, extra_human_rescues: 0 });

/** The hash seals all comparison inputs before L2 approval. Reapproval must
 * supply a new seal; authors cannot silently replace cases, judges or gates. */
export function validateLoopBaseline(seal) {
  exactKeys(seal, ['schema_version', 'source_revision', 'cutoff', 'timezone', 'tasks', 'cases', 'source_hashes', 'risk_distribution', 'model_settings', 'review_rules', 'required_checks', 'checks_version', 'calculation_version', 'judge', 'thresholds', 'sha256']);
  if (seal.schema_version !== 'workkeel.loop-baseline/v1') fail('unsupported baseline');
  revision(seal.source_revision); date(seal.cutoff);
  text(seal.timezone);
  try { new Intl.DateTimeFormat('en', { timeZone: seal.timezone }).format(); } catch { fail('timezone required'); }
  list(seal.tasks, text); if (!seal.tasks.length) fail('task list required'); unique(seal.tasks);
  list(seal.cases, c => { exactKeys(c, ['id', 'task_id', 'input_sha256', 'risk']); text(c.id); if (!seal.tasks.includes(c.task_id)) fail('case task outside baseline'); hash(c.input_sha256); risk(c.risk); });
  if (!seal.cases.length) fail('case list required'); unique(seal.cases.map(c => c.id));
  list(seal.source_hashes, p => { exactKeys(p, ['path', 'sha256']); text(p.path); hash(p.sha256); });
  if (!seal.source_hashes.length) fail('source hashes required'); unique(seal.source_hashes.map(p => p.path));
  exactKeys(seal.risk_distribution, RISK_TIERS);
  for (const tier of RISK_TIERS) { integer(seal.risk_distribution[tier]); if (seal.risk_distribution[tier] !== seal.cases.filter(c => c.risk === tier).length) fail('risk distribution differs from sealed cases'); }
  if (!seal.model_settings || typeof seal.model_settings !== 'object' || Array.isArray(seal.model_settings) || !Object.keys(seal.model_settings).length) fail('model settings required');
  for (const field of ['review_rules', 'checks_version', 'calculation_version']) text(seal[field]);
  list(seal.required_checks,text);if(!seal.required_checks.length)fail('required checks must be sealed');unique(seal.required_checks);
  exactKeys(seal.judge, ['agent_id', 'model_family', 'anonymous', 'randomized_order']); text(seal.judge.agent_id); text(seal.judge.model_family);
  if (seal.judge.anonymous !== true || seal.judge.randomized_order !== true) fail('anonymous randomized independent review required');
  if (executionDigest(seal.thresholds) !== executionDigest(THRESHOLDS)) fail('fixed trial thresholds changed; user reapproval required');
  const { sha256, ...body } = seal; hash(sha256); if (executionDigest(body) !== sha256) fail('baseline seal mismatch');
  return seal;
}
export const LOOP_COMPARISON_THRESHOLDS = THRESHOLDS;

function attempt(a, side, baseline, record, pair) {
  exactKeys(a, ['id', 'candidate', 'input_sha256', 'risk', 'model_settings_sha256', 'review_rules', 'checks_version', 'calculation_version', 'checks', 'review', 'findings', 'first_pass', 'rework_rounds', 'wall_ms', 'human_rescues', 'tokens', 'evidence']);
  text(a.id); if (a.candidate !== null) revision(a.candidate);
  if (a.input_sha256 !== pair.input_sha256 || a.risk !== pair.risk || a.model_settings_sha256 !== executionDigest(baseline.model_settings) || a.review_rules !== baseline.review_rules || a.checks_version !== baseline.checks_version || a.calculation_version !== baseline.calculation_version) fail('comparison conditions changed');
  if (a.first_pass !== null && typeof a.first_pass !== 'boolean') fail('first_pass must be measured or null');
  for (const field of ['rework_rounds', 'wall_ms', 'human_rescues']) if (a[field] !== null) integer(a[field]);
  exactKeys(a.tokens, ['input', 'output']); for (const v of Object.values(a.tokens)) if (v !== null) integer(v);
  if (a.checks !== null) list(a.checks, c => { exactKeys(c, ['id', 'required', 'status']); text(c.id); if (typeof c.required !== 'boolean' || !['pass', 'fail', 'unknown'].includes(c.status)) fail('invalid check result'); });
  if(a.checks !== null){unique(a.checks.map(c=>c.id));if(baseline.required_checks.some(id=>!a.checks.some(c=>c.id===id&&c.required)))fail('sealed required checks omitted or demoted');}
  if (a.review !== null) {
    exactKeys(a.review, ['agent_id', 'model_family', 'judgment', 'blind_id', 'order']);
    if (a.review.agent_id !== baseline.judge.agent_id || a.review.agent_id === record.author.agent_id || a.review.model_family !== baseline.judge.model_family || a.review.blind_id === side || !['pass', 'fail', 'unknown'].includes(a.review.judgment) || ![1, 2].includes(a.review.order)) fail('actual independent blind reviewer required');
    text(a.review.blind_id);
  }
  list(a.findings, f => { exactKeys(f, ['disposition', 'resolved', 'reason', 'counterevidence']); if (!['Must fix', 'Consider', 'Note', 'Dismiss'].includes(f.disposition) || typeof f.resolved !== 'boolean') fail('invalid finding'); text(f.reason); if (f.disposition === 'Dismiss') text(f.counterevidence); else if (f.counterevidence !== null) text(f.counterevidence); });
  list(a.evidence, e => { exactKeys(e, ['path', 'sha256']); text(e.path); hash(e.sha256); });
}
/** Data validation only: no model, mutation, comparison runner or acceptance.
 * Nulls and <5 pairs are retained as inconclusive, never converted to success. */
export function validateLoopComparison(record, baseline) {
  validateLoopBaseline(baseline);
  exactKeys(record, ['schema_version', 'baseline_sha256', 'approval_sha256', 'author', 'attempt_inventory', 'pairs', 'conclusion', 'reason', 'rollback_status'], ['learning_ids']);
  if (record.schema_version !== 'workkeel.loop-comparison/v1' || record.baseline_sha256 !== baseline.sha256) fail('comparison baseline differs from approved seal');
  hash(record.approval_sha256); exactKeys(record.author, ['agent_id', 'model_family']); text(record.author.agent_id); text(record.author.model_family);
  if (record.author.agent_id === baseline.judge.agent_id) fail('author cannot be judge');
  list(record.attempt_inventory, text); unique(record.attempt_inventory);
  const actual = [];
  list(record.pairs, pair => {
    exactKeys(pair, ['case_id', 'input_sha256', 'risk', 'before', 'after']);
    const c = baseline.cases.find(c => c.id === pair.case_id);
    if (!c || pair.input_sha256 !== c.input_sha256 || pair.risk !== c.risk) fail('fixed case input or risk differs');
    for (const side of ['before', 'after']) { list(pair[side], a => { attempt(a, side, baseline, record, pair); actual.push(a.id); }); }
    if (pair.before[0]?.review && pair.after[0]?.review && (pair.before[0].review.order === pair.after[0].review.order || pair.before[0].review.blind_id === pair.after[0].review.blind_id)) fail('before and after must have distinct anonymous randomized positions');
    for (const a of [...pair.before, ...pair.after]) if (a.review && ['high', 'critical'].includes(pair.risk) && (!['codex', 'claude'].includes(a.review?.model_family) || !['codex', 'claude'].includes(record.author.model_family) || a.review?.model_family === record.author.model_family)) fail('high/critical requires Codex/Claude cross-review');
  });
  unique(record.pairs.map(p => p.case_id)); unique(actual);
  if (executionDigest([...actual].sort()) !== executionDigest([...record.attempt_inventory].sort())) fail('all attempts, including failures, must be paired');
  if (!['support-retain', 'do-not-support-retain', 'inconclusive'].includes(record.conclusion)) fail('invalid trial conclusion');
  text(record.reason); if (!['not-requested', 'pending', 'restored', 'retained-by-user', 'unknown'].includes(record.rollback_status)) fail('rollback status required');
  if (record.learning_ids !== undefined) list(record.learning_ids, text); // provenance only
  const samples = record.pairs.flatMap(p => [...p.before, ...p.after]);
  const incomplete = record.pairs.length < 5 || record.pairs.length !== baseline.cases.length || record.pairs.some(p => !p.before.length || !p.after.length) || samples.some(a => a.candidate === null || !a.evidence.length || !a.checks?.length || a.checks.some(c => c.status === 'unknown') || a.review === null || a.review.judgment === 'unknown' || ['first_pass', 'rework_rounds', 'wall_ms', 'human_rescues'].some(f => a[f] === null));
  if (incomplete && record.conclusion !== 'inconclusive') fail('insufficient or incomplete data must be inconclusive');
  if (record.conclusion === 'support-retain') {
    if(samples.some(a=>a.findings.some(f=>f.disposition==='Must fix'&&!f.resolved)))fail('all Must fix findings require resolution');
    if (record.pairs.flatMap(p => [p.before.at(-1), p.after.at(-1)]).some(a => a.checks.some(c => c.required && c.status !== 'pass') || a.review.judgment !== 'pass' || a.findings.some(f => f.disposition === 'Must fix' && !f.resolved))) fail('quality floor blocks a retention claim');
    const metric = side => {
      const rows = record.pairs.map(p => p[side]);
      return { pass: rows.filter(xs => xs[0].first_pass).length / rows.length, rework: rows.reduce((s, xs) => s + xs.reduce((n, a) => n + a.rework_rounds, 0), 0) / rows.length,
        wall: rows.flat().reduce((n, a) => n + a.wall_ms, 0), rescues: rows.flat().reduce((n, a) => n + a.human_rescues, 0) };
    };
    const before = metric('before'), after = metric('after'), pass = after.pass - before.pass, rework = before.rework - after.rework;
    if (pass < -1e-12 || rework < -1e-12 || pass + 1e-12 < .2 && rework + 1e-12 < .2 || after.wall > before.wall * 1.1 || after.rescues > before.rescues) fail('fixed improvement thresholds not met');
  }
  return record;
}
