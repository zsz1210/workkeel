import { exactKeys } from "./workkeel-execution-policy.mjs";
import { readTaskFile } from "./task-contract.mjs";

/** Review expectations come from task/Skill descriptions, not a universal keyword classifier. */
export async function auditSkillUse(target, request) {
  exactKeys(request, ["expected", "selected", "records"]);
  if (![request.expected, request.selected, request.records].every(Array.isArray) ||
      request.expected.length > 32 || request.selected.length > 32 || request.records.length > 32 ||
      new Set(request.expected).size !== request.expected.length || new Set(request.selected).size !== request.selected.length ||
      [...request.expected, ...request.selected].some(value => typeof value !== "string" || !value.endsWith("/SKILL.md"))) throw new Error("Skill audit needs bounded distinct Skill paths");
  const issues = [], records = new Map();
  for (const record of request.records) {
    exactKeys(record, ["skill", "read_complete", "application_evidence", "verification_evidence"]);
    if (!request.selected.includes(record.skill) || records.has(record.skill) || typeof record.read_complete !== "boolean" ||
        ![record.application_evidence, record.verification_evidence].every(values => Array.isArray(values) && values.length <= 16 && values.every(value => typeof value === "string"))) throw new Error("Invalid Skill application record");
    records.set(record.skill, record);
  }
  for (const skill of request.expected) if (!request.selected.includes(skill)) issues.push({ skill, code: "missing-selection" });
  for (const skill of request.selected) {
    if (!request.expected.includes(skill)) issues.push({ skill, code: "unexpected-selection", note: "Review whether its trigger actually applies" });
    try { await readTaskFile(target, skill); } catch { issues.push({ skill, code: "source-unavailable" }); }
    const record = records.get(skill);
    if (!record?.read_complete) issues.push({ skill, code: "reading-not-recorded" });
    for (const [field, code] of [["application_evidence", "application-not-evidenced"], ["verification_evidence", "verification-not-evidenced"]]) {
      if (!record?.[field]?.length) { issues.push({ skill, code }); continue; }
      for (const ref of record[field]) {
        try { if (!(await readTaskFile(target, ref)).content.trim()) throw new Error("empty"); }
        catch { issues.push({ skill, code, path: ref }); }
      }
    }
  }
  return { schema_version: "workkeel.skill-audit/v1", issues, records_complete: !issues.length,
    authority: "observation-only", mutation_status: "no-write", quality_verified: false,
    limitations: ["Expected Skills must be reviewed against explicit requests and applicable descriptions.",
      "Self-reported reading and existing files do not prove comprehension, application or artifact quality; inspect the actual output."] };
}
