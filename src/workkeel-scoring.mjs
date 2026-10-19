import { readTaskFile } from "./task-contract.mjs";
import { readNativeGit } from "./workkeel-project.mjs";
import { listTaskItems, readNativeTask } from "./workkeel-tasks.mjs";
import { RISK_TIERS, taskRisk } from "./workkeel-risk.mjs";

// Scores are statistics. Nothing here is read by the lifecycle: rework and
// acceptance follow the risk-tier review rules, never a score.

/** Rubrics by task type, each criterion scored 1-5. Other types come later. */
export const RUBRICS = Object.freeze({
  code: ["requirements", "correctness", "tests", "maintainability"],
  "non-code": ["requirements"]
});
const LEVELS = ["P1", "P2", "P3"];
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const label = v => v === null || typeof v === "string" && v.trim() !== "" && v.length <= 200;
const note = v => typeof v === "string" && v.trim() !== "" && v.length <= 1000;
function keys(value, allowed, required = allowed) {
  if (!isObject(value)) throw new Error("must be an object");
  const extra = Object.keys(value).find(k => !allowed.includes(k)), missing = required.find(k => !Object.hasOwn(value, k));
  if (extra || missing) throw new Error(extra ? `unknown field ${extra}` : `missing field ${missing}`);
}
const findings = list => {
  if (!Array.isArray(list) || list.length > 64) throw new Error("findings must be a bounded list");
  for (const f of list) { keys(f, ["level", "note"]); if (!LEVELS.includes(f.level) || !note(f.note)) throw new Error("finding needs a P1-P3 level and a short note"); }
  return list.map(f => ({ level: f.level, note: f.note }));
};
/**
 * The optional `score` block a reviewer appends to its own
 * workkeel.review-report/v1 file. Returns the normalized block or throws.
 */
export function validateReviewScore(score) {
  keys(score, ["model", "reasoning_effort", "external_score", "findings"], ["external_score"]);
  for (const k of ["model", "reasoning_effort"]) if (score[k] !== undefined && !label(score[k])) throw new Error(`${k} must be a short label or null`);
  const ext = score.external_score;
  keys(ext, ["reviewer_model", "rubric", "scores", "total"], ["rubric", "scores"]);
  if (ext.reviewer_model !== undefined && !label(ext.reviewer_model)) throw new Error("reviewer_model must be a short label or null");
  const criteria = RUBRICS[ext.rubric];
  if (!criteria) throw new Error(`rubric must be one of ${Object.keys(RUBRICS).join(", ")}`);
  keys(ext.scores, criteria);
  if (criteria.some(c => !Number.isInteger(ext.scores[c]) || ext.scores[c] < 1 || ext.scores[c] > 5)) throw new Error("each score is an integer from 1 to 5");
  const total = criteria.reduce((sum, c) => sum + ext.scores[c], 0);
  if (ext.total !== undefined && ext.total !== total) throw new Error("total must equal the sum of the scores");
  return { model: score.model ?? null, reasoning_effort: score.reasoning_effort ?? null,
    external_score: { reviewer_model: ext.reviewer_model ?? null, rubric: ext.rubric, scores: Object.fromEntries(criteria.map(c => [c, ext.scores[c]])), total, max: criteria.length * 5 },
    findings: findings(score.findings ?? []) };
}

/** Evidence as recorded: a candidate path is the blob in the reviewed revision, not the working tree. */
async function readReviewEvidence(target, review, ref) {
  if (ref.source !== "candidate") return (await readTaskFile(target, ref.path)).content;
  const bytes = await readNativeGit(target, ["cat-file", "blob", `${review.revision}:${ref.path}`], { encoding: "buffer" });
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * The scored review report among one review's evidence, if any. It must be the
 * actual reviewer's record of this candidate and judgment; an author's report or
 * a delivered file never counts. Two different scores for one review are unknown.
 */
async function reviewScore(target, item, review, errors) {
  const delivered = new Set([item.delivery, ...item.attempts.map(a => a.delivery)].flatMap(d => d?.evidence ?? []).map(p => p.path));
  const found = [];
  for (const ref of review?.evidence ?? []) {
    if (!ref.path.endsWith(".json") || delivered.has(ref.path)) continue;
    let report;
    try { report = JSON.parse(await readReviewEvidence(target, review, ref)); } catch { continue; }
    if (report?.schema_version !== "workkeel.review-report/v1" || report.score === undefined) continue;
    if (report.task_id !== item.id || report.revision !== review.revision || report.judgment !== review.judgment || report.reviewer?.agent_id !== review.actor?.agent_id || report.reviewer?.principal_id !== review.actor?.principal_id) {
      errors.push({ task_id: item.id, path: ref.path, message: "Score source differs from the actual reviewer, task, candidate or judgment" }); continue;
    }
    if (report.judgment !== review.judgment || report.reviewer?.agent_id !== review.actor?.agent_id || report.reviewer?.principal_id !== review.actor?.principal_id) continue;
    if (isObject(report.score)) delete report.score.self_eval;
    try { found.push(validateReviewScore(report.score)); }
    catch (error) { errors.push({ task_id: item.id, path: ref.path, message: `Invalid score: ${error.message}` }); return null; }
  }
  if (new Set(found.map(f => JSON.stringify(f))).size > 1) { errors.push({ task_id: item.id, message: "Conflicting reviewer scores; left unknown" }); return null; }
  return found[0] ?? null;
}

/** One task's score record, or null when it has no review yet. */
export async function taskScoreRecord(target, item, errors = []) {
  const rejected = item.attempts.filter(a => a.kind === "rejected");
  const reviews = [...rejected.map(a => a.review), ...(item.review ? [item.review] : [])];
  if (!reviews.length) return null;
  const scored = [];
  for (const review of reviews) scored.push(await reviewScore(target, item, review, errors));
  const reasons = [];
  rejected.forEach((attempt, i) => {
    const listed = scored[i]?.findings.filter(f => f.level !== "P3") ?? [];
    if (listed.length) for (const f of listed) reasons.push({ round: i + 1, ...f });
    else reasons.push({ round: i + 1, level: null, note: attempt.summary });
  });
  // The latest scored review describes the task; its round is counted from the lifecycle.
  const last = scored.findLastIndex(Boolean), latest = last < 0 ? null : scored[last];
  return { task_id: item.id, risk: taskRisk(item), model: latest?.model ?? null, reasoning_effort: latest?.reasoning_effort ?? null,
    external_score: latest && { ...latest.external_score, review_round: last + 1 },
    rework: { rounds: rejected.length, reasons } };
}

const average = values => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100 : null;

/** Read-only statistics over every native task's score record. */
export async function readScoreStats(target) {
  const errors = [], records = [];
  for (const summary of await listTaskItems(target, { isolateErrors: true })) {
    if (summary.mode !== "task-first") { errors.push({ task_id: summary.id, message: "Task record unavailable" }); continue; }
    const record = await taskScoreRecord(target, await readNativeTask(target, summary.id), errors);
    if (record) records.push(record);
  }
  const by_risk = {};
  for (const tier of RISK_TIERS) {
    const rows = records.filter(r => r.risk === tier);
    if (!rows.length) continue;
    const scores = {};
    for (const [rubric, criteria] of Object.entries(RUBRICS)) {
      const scored = rows.filter(r => r.external_score?.rubric === rubric).map(r => r.external_score);
      if (scored.length) scores[rubric] = { tasks: scored.length, max: criteria.length * 5, average_total: average(scored.map(s => s.total)),
        average_by_criterion: Object.fromEntries(criteria.map(c => [c, average(scored.map(s => s.scores[c]))])) };
    }
    const reasons = { P1: 0, P2: 0, unclassified: 0 };
    for (const reason of rows.flatMap(r => r.rework.reasons)) reasons[reason.level ?? "unclassified"]++;
    const rounds = rows.map(r => r.rework.rounds);
    by_risk[tier] = { tasks: rows.length, scores, rework: { total_rounds: rounds.reduce((a, b) => a + b, 0), average_rounds: average(rounds),
      max_rounds: Math.max(...rounds), tasks_reworked: rounds.filter(Boolean).length, reasons_by_level: reasons } };
  }
  return { schema_version: "workkeel.stats/v1", authority: "observation-only", mutation_status: "no-write", by_risk, records, errors,
    limitations: ["Scores are statistics only. They never trigger rework or block acceptance; the risk-tier review rules decide that.",
      "Only the actual reviewer's own workkeel.review-report/v1 file for that candidate and judgment is scored; author or delivered reports are ignored. Rework reasons without P-level findings use the rework summary."] };
}

export const REWORK_CATEGORIES = Object.freeze(['requirements', 'code-error', 'tests', 'evidence', 'scope', 'false-block', 'unknown']);
const sameReviewer = (a, b) => a?.agent_id === b?.agent_id && a?.principal_id === b?.principal_id;

/** Historical review rounds, including an unresolved FAIL and an unscored last
 * round. Never substitute the latest scored round for a missing first/last one. */
export async function taskObservationRecord(target, item, errors = [], { cutoff = Infinity } = {}) {
  const available = [...item.attempts.filter(a => a.kind === 'rejected').map(a => a.review), ...(item.review ? [item.review] : [])];
  const events = (item.history ?? []).filter(e => e.action === 'review' && Date.parse(e.at) < cutoff);
  const rounds = [];
  for (const [index, event] of events.entries()) {
    const review = available.find(r => r.revision === event.revision && r.judgment === event.judgment && sameReviewer(r.actor, event.actor));
    const independent = event.actor?.agent_id !== item.contract.actor?.agent_id && Boolean(event.actor?.agent_id);
    if (!review) errors.push({ task_id: item.id, message: 'Historical review evidence unavailable', round: index + 1 });
    const score = review && independent ? await reviewScore(target, item, review, errors) : null;
    rounds.push({ round: index + 1, at: event.at, candidate: event.revision, reviewer: event.actor, independent,
      judgment: event.judgment, score, evidence: review?.evidence ?? [], source: event });
  }
  const candidates=new Set((item.history??[]).filter(e=>e.action==='handoff'&&Date.parse(e.at)<cutoff).map(e=>e.revision));
  const historical={...item,delivery:candidates.has(item.delivery?.revision)?item.delivery:null,attempts:item.attempts.filter(a=>candidates.has(a.delivery?.revision))};
  return { task_id: item.id, risk: taskRisk(historical), reviews: rounds };
}

/** Full correction history, including failed-check repairs before handoff.
 * Preserve task-global ordinals before applying a report's period filter. */
export function projectReworkIterations(taskId, history, reviews, operations) {
  const at=value=>Date.parse(value), category=note=>{
    const label=/^\[([^\]]+)\]/.exec(note??'')?.[1];return REWORK_CATEGORIES.includes(label)?label:'unknown';
  };
  const ops=[...operations].sort((a,b)=>at(a.at)-at(b.at)),allReworks=[];
  for(const event of history.filter(e=>e.action==='rework')){
    const rejected=reviews.filter(r=>at(r.at)<=at(event.at)&&r.judgment==='fail').at(-1);
    const findings=rejected?.score?.findings.filter(f=>f.level!=='P3')??[];
    allReworks.push({task_id:taskId,round:null,candidate:event.revision??rejected?.candidate??null,at:event.at,
      reasons:(findings.length?findings.map(f=>f.note):[event.summary]).map(note=>({category:category(note),note})),
      kind:'review-repair',source:event,evidence:rejected?.evidence??[]});
  }
  for(const op of ops.filter(o=>o.phase==='repair')){
    const prior=ops.filter(o=>o.goal_id===op.goal_id&&o.phase==='verification'&&at(o.at)<=at(op.at)).at(-1);
    if(!prior?.result?.checks?.some(c=>c.status==='fail')||prior.cycle!==null&&op.cycle!==prior.cycle+1)continue;
    if(allReworks.some(r=>r.candidate===prior.candidate&&at(r.at)<=at(op.at)))continue;
    allReworks.push({task_id:taskId,round:null,candidate:prior.candidate,at:op.at,kind:'check-repair',
      reasons:[{category:'tests',note:'Recorded mandatory check failed before this repair iteration'}],source:op,evidence:[prior]});
  }
  allReworks.sort((a,b)=>at(a.at)-at(b.at)).forEach((r,i)=>{r.round=i+1;});
  return allReworks;
}
