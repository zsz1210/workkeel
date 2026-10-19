import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { listTaskItems, readNativeTask } from './workkeel-tasks.mjs';
import { readTaskFile } from './task-contract.mjs';
import { safeDirectory } from './workkeel-project.mjs';
import { executionDigest } from './workkeel-execution-policy.mjs';
import { taskObservationRecord, projectReworkIterations, REWORK_CATEGORIES } from './workkeel-scoring.mjs';
import { RISK_TIERS } from './workkeel-risk.mjs';

export const REPORT_RULES_VERSION = 'workkeel.stats-report-rules/2';
export const DEFAULT_REPORT_DAYS = 7;
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const at = value => Date.parse(value);


/** One fixed seven-day observation. Reads only. No scheduler, host or model. */
export async function readStatsReport(target, { days = 7, cutoff, timezone = 'UTC', previous = null } = {}) {
  if (days !== 7) throw Error('--days must be 7 for the weekly report');
  if(typeof cutoff !== 'string')throw Error('--cutoff is required for a fixed weekly observation');
  const until = new Date(cutoff), end = until.getTime(), start = end - 7 * 86400000;
  if (!Number.isFinite(end) || cutoff !== undefined && !/(Z|[+-]\d\d:\d\d)$/.test(cutoff)) throw Error('--cutoff needs an explicit UTC offset');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(until); } catch { throw Error('Invalid --timezone'); }
  if (previous !== null && !/^[a-f0-9]{64}$/.test(previous)) throw Error('Invalid --previous fingerprint');
  const inPeriod = v => at(v) >= start && at(v) < end;
  const started = performance.now(); let operations = 0, budgetStop = null;
  const read = async fn => {
    const remaining = 7200000 - (performance.now() - started);
    if (operations >= 60 || remaining <= 0) { budgetStop = remaining <= 0 ? 'wall-clock-limit' : 'operation-limit'; throw Error('L1 observation '+budgetStop); }
    operations++;
    let timer;
    try { return await Promise.race([fn(), new Promise((_,reject)=>{timer=setTimeout(()=>{budgetStop='wall-clock-limit';reject(Error('L1 observation wall-clock-limit'));},remaining);})]); }
    finally { clearTimeout(timer); }
  };
  const errors = [], tasks = [], goalOperations = [], sources = [];
  // Operations retain check attempts that never reached a native task handoff.
  let names = [];
  try { names = (await read(async () => fs.readdir(await safeDirectory(target, '.ai-org/goals')))).filter(n => n !== '.gitignore').sort(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of names) {
    try {
      const file = await read(() => readTaskFile(target, `.ai-org/goals/${name}/state.json`)), envelope = JSON.parse(file.content), goal = envelope.value;
      if (executionDigest(goal) !== envelope.sha256) throw Error('Goal state integrity failure');
      for (const op of goal.operations) {
        const completedAt = op.timing?.execution?.ended_at ?? op.at;
        const pending = at(completedAt) >= end;
        const time = pending ? op.at : completedAt;
        if (at(time) >= end) continue;
        goalOperations.push({ goal_id: goal.id, operation_id: op.id, task_id: op.input.task_id, phase: op.input.phase,
          candidate: op.input.candidate ?? op.result?.candidate_revision ?? null, cycle: op.input.cycle ?? null, at: time,
          status: pending ? 'pending-at-cutoff' : op.status, result: pending ? null : op.result, input: { phase: op.input.phase, cycle: op.input.cycle, actor: op.input.actor }, source: { path: `.ai-org/goals/${name}/state.json`, sha256: file.bytes_digest } });
      }
    } catch (error) { errors.push({ source: `.ai-org/goals/${name}`, message: error.message }); if(budgetStop)break; }
  }
  let summaries=[];try{if(!budgetStop)summaries=await read(() => listTaskItems(target, { isolateErrors: true }));}catch(error){errors.push({message:error.message});}
  for (const summary of summaries) {
    try {
    if (summary.mode !== 'task-first') { errors.push({ task_id: summary.id, message: 'Task record unavailable; period and type unknown' }); continue; }
    const item = await read(() => readNativeTask(target, summary.id));
    const history = item.history.filter(e => at(e.at) < end), activity = history.filter(e => inPeriod(e.at));
    const ops = goalOperations.filter(o => o.task_id === item.id);
    if (!activity.length && !ops.some(o => inPeriod(o.at))) continue;
    const observation = await read(() => taskObservationRecord(target, item, errors, { cutoff: end }));
    const reviews = observation.reviews.filter(r => at(r.at) < end), independent = reviews.filter(r => r.independent);
    // Native contracts do not declare task type. Explicit non-code scores are
    // excluded; unknown type stays in the sample with an explicit coverage gap.
    const type = reviews.some(r => r.score?.external_score.rubric === 'code') ? 'code' : reviews.some(r => r.score?.external_score.rubric === 'non-code') ? 'non-code' : 'unknown';
    if (type === 'non-code') continue;
    const gaps = [];
    if (type === 'unknown') gaps.push('Task type is not recorded; included conservatively as unknown');
    if (!ops.some(o => o.phase === 'verification')) gaps.push('Check history unavailable; unrecorded check repairs are unknown');
    const reworks = projectReworkIterations(item.id, history, reviews, ops).filter(r => inPeriod(r.at));
    const first = independent[0] ?? null, last = independent.at(-1) ?? null;
    const entry = history.find(e => e.action === 'handoff') ?? first;
    const entered = entry && inPeriod(entry.at);
    const tokens = ops.filter(o => inPeriod(o.at)).map(o => ({ operation_id: o.operation_id, usage: o.result?.usage ?? null }));
    for (const r of reviews) if (!r.score) gaps.push(`Review round ${r.round} has no usable actual-reviewer score`);
    const record = { ...observation, type, reviews, state: history.at(-1)?.state ?? 'unknown',
      first_review_entry: entry, first_review: first, last_review: last, first_pass: entered && first ? first.judgment === 'pass' : null,
      entered_first_review: Boolean(entered), not_yet_reviewed: !entry, pending_first_review: Boolean(entry && !first), rework: { rounds: gaps.some(g => g.startsWith('Check')) ? null : reworks.length, recorded_rounds: reworks.length, coverage: gaps.some(g => g.startsWith('Check')) ? 'partial' : 'recorded-only', iterations: reworks },
      tokens: { optimization_target: false, records: tokens, coverage: tokens.length && tokens.every(t => t.usage) ? 'recorded-only' : 'missing' },
      events: activity, goal_operations: ops.filter(o => inPeriod(o.at)), gaps };
    tasks.push(record);
    sources.push({ task_id: item.id, task_sha256: history.at(-1)?.hash ?? null, evidence_sha256: sha256(record) });
    }catch(error){errors.push({task_id:summary.id,message:error.message});if(budgetStop)break;}
  }
  const by_risk = Object.fromEntries(RISK_TIERS.map(risk => {
    const rows = tasks.filter(t => t.risk === risk), reviewed = rows.filter(t => t.entered_first_review), passes = reviewed.filter(t => t.first_pass).length;
    const rounds = rows.map(t => t.rework.rounds), complete = rounds.every(n => n !== null), recorded = rows.map(t => t.rework.recorded_rounds);
    return [risk, { tasks: rows.length, entered_first_review: reviewed.length, first_review_passed: passes,
      first_pass_rate: reviewed.length ? passes / reviewed.length : null, not_yet_reviewed: rows.filter(t => t.not_yet_reviewed).map(t => t.task_id), pending_first_review: rows.filter(t => t.pending_first_review).map(t => t.task_id),
      failed: rows.filter(t => t.reviews.at(-1)?.judgment === 'fail' || t.goal_operations.some(o => o.result?.checks?.some(c => c.status === 'fail'))).map(t => t.task_id),
      stopped: rows.filter(t => t.state === 'cancelled').map(t => t.task_id), unfinished: rows.filter(t => !['done', 'cancelled'].includes(t.state)).map(t => t.task_id),
      rework: { total_rounds: complete ? rounds.reduce((a, b) => a + b, 0) : null, average_rounds: complete ? avg(rounds) : null, max_rounds: complete && rounds.length ? Math.max(...rounds) : null, recorded_total_rounds: recorded.reduce((a, b) => a + b, 0), recorded_average_rounds: avg(recorded), recorded_max_rounds: recorded.length ? Math.max(...recorded) : null,
        coverage: rows.every(t => t.rework.coverage === 'recorded-only') ? 'recorded-only' : 'partial' } }];
  }));
  const reasons = Object.fromEntries(REWORK_CATEGORIES.map(key => [key, []]));
  for (const task of tasks) for (const round of task.rework.iterations) for (const reason of round.reasons) reasons[reason.category].push({ ...round, ...reason });
  const groups = new Map();
  for (const [reason, evidence] of Object.entries(reasons)) for (const e of evidence) {
    const key = reason === 'unknown' ? reason + ':' + (e.note ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : reason;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(e);
  }
  const suggestions = [...groups.values()].filter(evidence => new Set(evidence.map(e => `${e.task_id}:${e.round}`)).size >= 2)
    .map(evidence => ({ signal: 'repeated-rework-reason', category: evidence[0].category, task_ids: [...new Set(evidence.map(e => e.task_id))], evidence }));
  const period = { days: 7, since: new Date(start).toISOString(), until: until.toISOString(), timezone, interval: '[since, until)', cutoff_local: new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'full', timeStyle: 'long' }).format(until) };
  const rules = { repeat_min: 2, max_operations: 60, wall_ms: 7200000, rework_unit: 'one correction iteration; findings do not multiply rounds', first_pass_denominator: 'tasks entering their first independent review in this period', tokens: 'recorded only', task_types: 'code and unknown; explicit non-code excluded' };
  const fingerprint = sha256({ period, rules, version: REPORT_RULES_VERSION, sources, errors });
  return { schema_version: 'workkeel.stats-report/v1', authority: 'observation-only', mutation_status: 'no-write', model_called: false,
    rules_version: REPORT_RULES_VERSION, rules, period, input: { fingerprint, sources }, by_risk, tasks, reasons, suggestions,
    coverage: { tasks: tasks.length, review_rounds: tasks.reduce((n, t) => n + t.reviews.length, 0),
      scored_rounds: tasks.reduce((n, t) => n + t.reviews.filter(r => r.score).length, 0), missing: tasks.flatMap(t => t.gaps.map(message => ({ task_id: t.task_id, message }))), errors },
    stop_reason: budgetStop ?? (previous === fingerprint ? 'unchanged' : !tasks.length && !errors.length ? 'no-input' : suggestions.length ? 'complete' : 'no-candidate'),
    next_steps: suggestions.length ? ['Submit one L2 proposal for explicit user approval; then stop.'] : [],
    limitations: ['Counts cover recorded events only; unavailable history is not zero.', 'No model calls, task creation or automatic follow-up.'] };
}

/** Embed the complete canonical data so Markdown and JSON lose no fields. */
export function formatStatsReport(report) {
  const show = value => value === null ? 'unknown' : String(value);
  const lines = ['# Workkeel stats report', '',
    `Period: ${report.period.since} to ${report.period.until} (${report.period.timezone}; start included, cutoff excluded).`, '',
    `Rules: ${report.rules_version}. Input fingerprint: \`${report.input.fingerprint}\`.`, '',
    `Stop reason: ${report.stop_reason}.`, ''];
  if (['no-input', 'unchanged'].includes(report.stop_reason)) lines.push('No new input.', '');
  lines.push('## Weekly metrics', '', '| Risk | Tasks | First passes / entered | First-pass rate | Rework total / average / max | Recorded rounds |',
    '| --- | ---: | ---: | ---: | --- | ---: |');
  for(const [risk,row] of Object.entries(report.by_risk))lines.push(`| ${risk} | ${row.tasks} | ${row.first_review_passed} / ${row.entered_first_review} | ${show(row.first_pass_rate)} | ${show(row.rework.total_rounds)} / ${show(row.rework.average_rounds)} / ${show(row.rework.max_rounds)} | ${row.rework.recorded_total_rounds} |`);
  lines.push('', '## Coverage and candidates', '',
    `Scored review rounds: ${report.coverage.scored_rounds} / ${report.coverage.review_rounds}. Missing-data records: ${report.coverage.missing.length}. Source errors: ${report.coverage.errors.length}.`, '');
  if(!report.suggestions.length)lines.push('No qualifying candidate.', '');
  for(const s of report.suggestions)lines.push(`- ${s.signal}: ${s.category}; tasks ${s.task_ids.join(', ')}. Evidence is retained in the complete record below.`);
  lines.push('', ...report.next_steps, '', '## Complete observation record', '', '```json', JSON.stringify(report,null,2), '```', '');
  return lines.join('\n');
}
