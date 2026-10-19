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
/** Reserved for a self-evaluation flow; tasks with an external review leave it off. */
export const DEFAULT_SELF_EVAL = Object.freeze({ enabled: false, round: null, pass_line: null, requirements: [], issues: [], stars: null, result: null, blocked_needs: [] });

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
function selfEval(value) {
  if (value === undefined) return structuredClone(DEFAULT_SELF_EVAL);
  keys(value, Object.keys(DEFAULT_SELF_EVAL));
  if (typeof value.enabled !== "boolean") throw new Error("self_eval.enabled must be boolean");
  for (const k of ["requirements", "issues", "blocked_needs"]) if (!Array.isArray(value[k]) || value[k].length > 64) throw new Error(`self_eval.${k} must be a bounded list`);
  return structuredClone(value);
}

/**
 * The optional `score` block a reviewer appends to its own
 * workkeel.review-report/v1 file. Returns the normalized block or throws.
 */
export function validateReviewScore(score) {
  keys(score, ["model", "reasoning_effort", "external_score", "findings", "self_eval"], ["external_score"]);
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
  return { model: score.model ?? null, reasoning_effort: score.reasoning_effort ?? null, self_eval: selfEval(score.self_eval),
    external_score: { reviewer_model: ext.reviewer_model ?? null, rubric: ext.rubric, scores: Object.fromEntries(criteria.map(c => [c, ext.scores[c]])), total, max: criteria.length * 5 },
    findings: findings(score.findings ?? []) };
}

/** Evidence as recorded: a candidate path is the blob in the reviewed revision, not the working tree. */
async function readReviewEvidence(target, review, ref) {
  if (ref.source !== "candidate") return (await readTaskFile(target, ref.path)).content;
  const bytes = await readNativeGit(target, ["cat-file", "blob", `${review.revision}:${ref.path}`], { encoding: "buffer" });
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** The scored review report among one review's evidence, if any. */
async function reviewScore(target, item, review, errors) {
  for (const ref of review?.evidence ?? []) {
    if (!ref.path.endsWith(".json")) continue;
    let report;
    try { report = JSON.parse(await readReviewEvidence(target, review, ref)); } catch { continue; }
    if (report?.schema_version !== "workkeel.review-report/v1" || report.task_id !== item.id || report.revision !== review.revision || report.score === undefined) continue;
    try { return validateReviewScore(report.score); }
    catch (error) { errors.push({ task_id: item.id, path: ref.path, message: `Invalid score: ${error.message}` }); return null; }
  }
  return null;
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
    self_eval: latest?.self_eval ?? structuredClone(DEFAULT_SELF_EVAL),
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
      "Only reviews whose own workkeel.review-report/v1 file carries a score block are scored. Rework reasons without P-level findings use the rework summary."] };
}
