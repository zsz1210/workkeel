import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { listTaskItems, readNativeTask } from './workkeel-tasks.mjs';
import { readTaskFile } from './task-contract.mjs';
import { safeDirectory } from './workkeel-project.mjs';
import { executionDigest } from './workkeel-execution-policy.mjs';
import { taskObservationRecord, projectReworkIterations, REWORK_CATEGORIES } from './workkeel-scoring.mjs';
import { RISK_TIERS } from './workkeel-risk.mjs';
import { LEGACY_CLI_VERSION, backupEntryRule, backupPathRule, isLegacyStatsProject, readLegacyStatsSource } from './workkeel-stats-legacy.mjs';

export const REPORT_RULES_VERSION = 'workkeel.stats-report-rules/3';
export const DEFAULT_REPORT_DAYS = 7;
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const at = value => Date.parse(value);


function reportWindow({ days = 7, cutoff, timezone = 'UTC', previous = null } = {}) {
  if (days !== 7) throw Error('--days must be 7 for the weekly report');
  if(typeof cutoff !== 'string')throw Error('--cutoff is required for a fixed weekly observation');
  const until = new Date(cutoff), end = until.getTime(), start = end - 7 * 86400000;
  if (!Number.isFinite(end) || cutoff !== undefined && !/(Z|[+-]\d\d:\d\d)$/.test(cutoff)) throw Error('--cutoff needs an explicit UTC offset');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(until); } catch { throw Error('Invalid --timezone'); }
  if (previous !== null && !/^[a-f0-9]{64}$/.test(previous)) throw Error('Invalid --previous fingerprint');
  return { until, start, end, timezone, previous, inPeriod: v => at(v) >= start && at(v) < end };
}
/** One wall-clock budget, shared by every source of one report. */
function readBudget() {
  const started = performance.now(), budget = { stop: null };
  budget.read = async fn => {
    const remaining = 7200000 - (performance.now() - started);
    if (remaining <= 0) { budget.stop = 'wall-clock-limit'; throw Error('L1 observation '+budget.stop); }
    let timer;
    try { return await Promise.race([fn(), new Promise((_,reject)=>{timer=setTimeout(()=>{budget.stop='wall-clock-limit';reject(Error('L1 observation wall-clock-limit'));},remaining);})]); }
    finally { clearTimeout(timer); }
  };
  return budget;
}
const reportPeriod = ({ start, until, timezone }) => ({ days: 7, since: new Date(start).toISOString(), until: until.toISOString(), timezone, interval: '[since, until)', cutoff_local: new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'full', timeStyle: 'long' }).format(until) });
const RULES = { repeat_min: 2, wall_ms: 7200000, rework_unit: 'one correction iteration; findings do not multiply rounds', first_pass_denominator: 'tasks whose first independent review happened in this period; pending first reviews excluded', tokens: 'recorded only', task_types: 'code and unknown; explicit non-code excluded' };
const MULTI_RULES = { ...RULES, sources: 'one cutoff, time zone and period for every source; each source keeps its own counts and errors',
  backup_exclusion: 'a project path segment or task store entry named "backup" or "backups", or ending with ".bak" or ".backup" (optionally followed by a "." "_" or "-" label) or "~", is not read; a <task-id>.json file is always read',
  duplicates: 'a task with the same ID and the same last history hash in several sources is counted once',
  failed_source: 'a source that cannot be read is not zero; merged counts cover readable sources only and stop_reason is source-error' };

/** Reads one project root: tasks in the period, their input digests and every read error. */
async function observeSource(target, { end, inPeriod }, budget) {
  const read = budget.read;
  const errors = [], tasks = [], goalOperations = [], sources = [];
  let format = 'current', excluded = [], summaries = [], readTask = id => readNativeTask(target, id);
  if (await isLegacyStatsProject(target)) {
    format = 'legacy-' + LEGACY_CLI_VERSION;
    try {
      const legacy = await readLegacyStatsSource(target, read), byId = new Map(legacy.items.map(item => [item.id, item]));
      errors.push(...legacy.errors); excluded = legacy.excluded;
      summaries = legacy.items.map(item => ({ id: item.id, mode: 'task-first' })); readTask = async id => byId.get(id);
    } catch (error) { errors.push({ message: error.message }); }
  } else {
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
    } catch (error) { errors.push({ source: `.ai-org/goals/${name}`, message: error.message }); if(budget.stop)break; }
  }
  try{if(!budget.stop)summaries=await read(() => listTaskItems(target, { isolateErrors: true, excludeRule: backupEntryRule, excluded }));}catch(error){errors.push({message:error.message});}
  }
  for (const summary of summaries) {
    try {
    if (summary.mode !== 'task-first') { errors.push({ task_id: summary.id, message: 'Task record unavailable; period and type unknown' }); continue; }
    const item = await read(() => readTask(summary.id));
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
    const entered = first && inPeriod(first.at);
    const tokens = ops.filter(o => inPeriod(o.at)).map(o => ({ operation_id: o.operation_id, usage: o.result?.usage ?? null }));
    for (const r of reviews) if (!r.score) gaps.push(`Review round ${r.round} has no usable actual-reviewer score`);
    const record = { ...observation, type, reviews, state: history.at(-1)?.state ?? 'unknown',
      first_review_entry: entry, first_review: first, last_review: last, first_pass: entered && first ? first.judgment === 'pass' : null,
      entered_first_review: Boolean(entered), not_yet_reviewed: !entry, pending_first_review: Boolean(entry && !first), rework: { rounds: gaps.some(g => g.startsWith('Check')) ? null : reworks.length, recorded_rounds: reworks.length, coverage: gaps.some(g => g.startsWith('Check')) ? 'partial' : 'recorded-only', iterations: reworks },
      tokens: { optimization_target: false, records: tokens, coverage: tokens.length && tokens.every(t => t.usage) ? 'recorded-only' : 'missing' },
      events: activity, goal_operations: ops.filter(o => inPeriod(o.at)), gaps };
    tasks.push(record);
    sources.push({ task_id: item.id, task_sha256: history.at(-1)?.hash ?? null, evidence_sha256: sha256(record) });
    }catch(error){errors.push({task_id:summary.id,message:error.message});if(budget.stop)break;}
  }
  return { format, tasks, errors, sources, excluded };
}

/** Weekly metrics over observed tasks. `incomplete` marks a merge that lost a source. */
function summarize(tasks, errors, { incomplete = false } = {}) {
  const sourceUnavailable = !tasks.length && errors.length > 0;
  const by_risk = Object.fromEntries(RISK_TIERS.map(risk => {
    const rows = tasks.filter(t => t.risk === risk), reviewed = rows.filter(t => t.entered_first_review), passes = reviewed.filter(t => t.first_pass).length;
    const rounds = rows.map(t => t.rework.rounds), complete = !sourceUnavailable && !incomplete && rounds.every(n => n !== null), recorded = rows.map(t => t.rework.recorded_rounds);
    return [risk, { tasks: sourceUnavailable ? null : rows.length, entered_first_review: sourceUnavailable ? null : reviewed.length, first_review_passed: sourceUnavailable ? null : passes,
      first_pass_rate: reviewed.length ? passes / reviewed.length : null, not_yet_reviewed: rows.filter(t => t.not_yet_reviewed).map(t => t.task_id), pending_first_review: rows.filter(t => t.pending_first_review).map(t => t.task_id),
      failed: rows.filter(t => t.reviews.at(-1)?.judgment === 'fail' || t.goal_operations.some(o => o.result?.checks?.some(c => c.status === 'fail'))).map(t => t.task_id),
      stopped: rows.filter(t => t.state === 'cancelled').map(t => t.task_id), unfinished: rows.filter(t => !['done', 'cancelled'].includes(t.state)).map(t => t.task_id),
      rework: { total_rounds: complete ? rounds.reduce((a, b) => a + b, 0) : null, average_rounds: complete ? avg(rounds) : null, max_rounds: complete && rounds.length ? Math.max(...rounds) : null, recorded_total_rounds: sourceUnavailable ? null : recorded.reduce((a, b) => a + b, 0), recorded_average_rounds: avg(recorded), recorded_max_rounds: recorded.length ? Math.max(...recorded) : null,
        coverage: !sourceUnavailable && !incomplete && rows.every(t => t.rework.coverage === 'recorded-only') ? 'recorded-only' : 'partial' } }];
  }));
  const reasons = Object.fromEntries(REWORK_CATEGORIES.map(key => [key, []]));
  for (const task of tasks) for (const round of task.rework.iterations) for (const reason of round.reasons) reasons[reason.category].push({ ...round, ...reason });
  const groups = new Map();
  for (const [reason, evidence] of Object.entries(reasons)) for (const e of evidence) {
    const key = reason === 'unknown' ? reason + ':' + (e.note ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : reason;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(e);
  }
  // Tasks from different sources can share an ID; the root keeps them apart.
  const suggestions = [...groups.values()].filter(evidence => new Set(evidence.map(e => `${e.root ?? ''}\0${e.task_id}:${e.round}`)).size >= 2)
    .map(evidence => ({ signal: 'repeated-rework-reason', category: evidence[0].category, task_ids: [...new Set(evidence.map(e => e.task_id))], evidence }));
  const coverage = { tasks: tasks.length, review_rounds: tasks.reduce((n, t) => n + t.reviews.length, 0),
    scored_rounds: tasks.reduce((n, t) => n + t.reviews.filter(r => r.score).length, 0), missing: tasks.flatMap(t => t.gaps.map(message => ({ ...(t.root ? { root: t.root } : {}), task_id: t.task_id, message }))), errors };
  return { sourceUnavailable, by_risk, reasons, suggestions, coverage };
}
const LIMITATIONS = ['Counts cover recorded events only; unavailable history is not zero.', 'No model calls, task creation or automatic follow-up.'];
const nextSteps = suggestions => suggestions.length ? ['Submit one L2 proposal for explicit user approval; then stop.'] : [];

/** One fixed seven-day observation. Reads only. No scheduler, host or model. */
export async function readStatsReport(target, options = {}) {
  const window = reportWindow(options), budget = readBudget();
  const { format, tasks, errors, sources, excluded } = await observeSource(target, window, budget);
  const { sourceUnavailable, by_risk, reasons, suggestions, coverage } = summarize(tasks, errors);
  const period = reportPeriod(window), rules = { ...RULES };
  const fingerprint = sha256({ period, rules, version: REPORT_RULES_VERSION, sources, errors });
  // A legacy project names its format and skipped backup files. A current project
  // lists skipped backups only when there are some, so other output is unchanged.
  const legacy = format === 'current' ? (excluded.length ? { excluded } : {}) : { format, excluded };
  return { schema_version: 'workkeel.stats-report/v1', authority: 'observation-only', mutation_status: 'no-write', model_called: false,
    rules_version: REPORT_RULES_VERSION, rules, period, input: { fingerprint, sources, ...legacy }, by_risk, tasks, reasons, suggestions, coverage,
    stop_reason: budget.stop ?? (sourceUnavailable ? 'source-error' : window.previous === fingerprint ? 'unchanged' : !tasks.length && !errors.length ? 'no-input' : suggestions.length ? 'complete' : 'no-candidate'),
    next_steps: nextSteps(suggestions), limitations: [...LIMITATIONS] };
}

/** Lines of a source list file: one path each, `#` comments, paths relative to the file. */
export async function readSourceList(file) {
  const base = path.dirname(path.resolve(file));
  return (await fs.readFile(file, 'utf8')).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => path.resolve(base, line));
}

/**
 * The same weekly observation over several project roots, with one period.
 * Each source keeps its own counts, coverage and errors; the merge never treats
 * a failed source as zero.
 */
export async function readMultiSourceStatsReport(roots, options = {}) {
  if (!Array.isArray(roots) || !roots.length) throw Error('At least one --project or --projects-file entry is required');
  const window = reportWindow(options), budget = readBudget(), period = reportPeriod(window);
  const seen = new Set(), excluded_sources = [], observed = [];
  for (const input of roots) {
    const root = path.resolve(input);
    let real = null;
    try { real = await fs.realpath(root); } catch { /* Reported below as an unreadable source. */ }
    const rule = backupPathRule(root) ?? (real && backupPathRule(real));
    if (rule) { excluded_sources.push({ root, rule }); continue; }
    if (seen.has(real ?? root)) { excluded_sources.push({ root, rule: 'duplicate' }); continue; }
    seen.add(real ?? root);
    let result;
    try {
      if (budget.stop) throw Error('L1 observation wall-clock-limit; source not read');
      if (!real || !(await fs.stat(real)).isDirectory()) throw Error('Source is not a readable directory');
      result = await observeSource(root, window, budget);
    } catch (error) { result = { format: 'unknown', tasks: [], errors: [{ message: error.message }], sources: [], excluded: [] }; }
    observed.push({ root, ...result });
  }
  const sourceLevel = e => !['task_id', 'path', 'source'].some(key => Object.hasOwn(e, key));
  const sources = observed.map(o => {
    const s = summarize(o.tasks, o.errors), failed = s.sourceUnavailable || o.errors.some(sourceLevel);
    return { root: o.root, format: o.format, status: failed ? 'failed' : o.errors.length ? 'partial' : 'ok',
      fingerprint: sha256({ period, rules: RULES, version: REPORT_RULES_VERSION, sources: o.sources, errors: o.errors }),
      by_risk: s.by_risk, coverage: { ...s.coverage, excluded: o.excluded } };
  });
  const tasks = [], inputs = [], duplicates = [], kept = new Map();
  for (const o of observed) for (const [i, task] of o.tasks.entries()) {
    const input = o.sources[i], key = `${task.task_id}\0${input.task_sha256}`;
    if (kept.has(key)) { duplicates.push({ task_id: task.task_id, task_sha256: input.task_sha256, counted_in: kept.get(key), skipped_in: o.root }); continue; }
    kept.set(key, o.root);
    tasks.push({ root: o.root, ...task, rework: { ...task.rework, iterations: task.rework.iterations.map(r => ({ root: o.root, ...r })) } });
    inputs.push({ root: o.root, ...input });
  }
  const errors = observed.flatMap(o => o.errors.map(e => ({ root: o.root, ...e })));
  const failed = sources.filter(s => s.status === 'failed').length;
  const { by_risk, reasons, suggestions, coverage } = summarize(tasks, errors, { incomplete: failed > 0 });
  const rules = { ...MULTI_RULES };
  const fingerprint = sha256({ period, rules, version: REPORT_RULES_VERSION, sources: sources.map(s => ({ root: s.root, fingerprint: s.fingerprint })), excluded_sources, duplicates });
  return { schema_version: 'workkeel.stats-multi-report/v1', authority: 'observation-only', mutation_status: 'no-write', model_called: false,
    rules_version: REPORT_RULES_VERSION, rules, period, input: { fingerprint, sources: inputs }, sources, excluded_sources, by_risk, tasks, reasons, suggestions,
    coverage: { ...coverage, duplicates, complete: failed === 0 && errors.length === 0,
      sources: { requested: roots.length, read: sources.length, ok: sources.filter(s => s.status === 'ok').length, partial: sources.filter(s => s.status === 'partial').length, failed, excluded: excluded_sources.length } },
    stop_reason: budget.stop ?? (failed ? 'source-error' : window.previous === fingerprint ? 'unchanged' : !tasks.length && !errors.length ? 'no-input' : suggestions.length ? 'complete' : 'no-candidate'),
    next_steps: nextSteps(suggestions), limitations: [...LIMITATIONS, 'Merged counts cover readable sources only. A failed source is listed, not counted as zero.'] };
}

/** True when a scheduler should treat the report as failed under --strict. */
export function strictFailure(report) {
  return ['source-error', 'wall-clock-limit'].includes(report.stop_reason) || report.coverage.errors.length > 0;
}

/** Embed the complete canonical data so Markdown and JSON lose no fields. */
export function formatStatsReport(report) {
  const show = value => value === null ? 'unknown' : String(value);
  const lines = ['# Workkeel stats report', '',
    `Period: ${report.period.since} to ${report.period.until} (${report.period.timezone}; start included, cutoff excluded).`, '',
    `Rules: ${report.rules_version}. Input fingerprint: \`${report.input.fingerprint}\`.`, '',
    `Stop reason: ${report.stop_reason}.`, ''];
  if (['no-input', 'unchanged'].includes(report.stop_reason)) lines.push('No new input.', '');
  if (report.sources) {
    lines.push('## Sources', '', '| Source | Format | Status | Tasks | Errors |', '| --- | --- | --- | ---: | ---: |');
    for (const s of report.sources) lines.push(`| ${s.root} | ${s.format} | ${s.status} | ${s.coverage.tasks} | ${s.coverage.errors.length} |`);
    for (const e of report.excluded_sources) lines.push(`| ${e.root} | not read | excluded (${e.rule}) | | |`);
    lines.push('');
  }
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
