const phases = ['waiting', 'implementation', 'review', 'rework', 'acceptance'];
const terminal = state => ['done', 'cancelled'].includes(state);

/** Elapsed lifecycle intervals, never active effort. Input comes from the verified task reader. */
export function projectTaskTiming(task, { now = new Date() } = {}) {
  const result = {
    coverage: 'unavailable', reason: 'invalid-history', as_of: null,
    ongoing: !terminal(task.state), elapsed_ms: null,
    phases: Object.fromEntries(phases.map(key => [key, null])),
    human_effort_ms: null, baseline_elapsed_ms: null, saved_time_ms: null,
    meaning: 'Disjoint lifecycle stage elapsed time, including waits and downtime. Not active effort. Adapter calls may overlap these intervals.'
  };
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isSafeInteger(nowMs)) return result;
  result.as_of = now.toISOString();
  const history = task.history;
  if (!Array.isArray(history) || !history.length || history[0].action !== 'create' || history[0].state !== 'intake' || history.at(-1).state !== task.state) return result;
  const times = history.map(e => typeof e.at === 'string' ? Date.parse(e.at) : NaN);
  if (times.some((at, i) => !Number.isSafeInteger(at) || at > nowMs || (i > 0 && at < times[i - 1]))) {
    result.reason = 'invalid-chronology'; return result;
  }
  const totals = Object.fromEntries(phases.map(key => [key, 0]));
  let reworking = false;
  for (let i = 0; i < history.length; i++) {
    const event = history[i];
    if (event.action === 'rework') reworking = true;
    if (terminal(event.state)) {
      if (i !== history.length - 1) return result;
      continue;
    }
    const phase = { intake: 'waiting', build: reworking ? 'rework' : 'implementation', test: 'review', release_gate: 'acceptance' }[event.state];
    if (!phase) return result;
    const end = times[i + 1] ?? nowMs;
    totals[phase] += end - times[i];
    if (!Number.isSafeInteger(totals[phase])) return result;
  }
  const elapsed = (terminal(task.state) ? times.at(-1) : nowMs) - times[0];
  if (!Number.isSafeInteger(elapsed) || elapsed < 0 || Object.values(totals).reduce((a, b) => a + b, 0) !== elapsed) return result;
  return { ...result, coverage: 'complete-history', reason: null, elapsed_ms: elapsed, phases: totals };
}
