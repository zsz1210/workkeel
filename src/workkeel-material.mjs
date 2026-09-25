import fs from "node:fs/promises";
import path from "node:path";
import { readTaskFile, validateTaskContract } from "./task-contract.mjs";
import { executionDigest, exactKeys } from "./workkeel-execution-policy.mjs";
import { sourceRevision, assertCandidateSource } from "./workkeel-continuation-state.mjs";

export const WORK_TYPES = ["initial", "repair", "takeover", "review", "rereview", "reconsideration"];
const under = (file, root) => root === "." || file === root || file.startsWith(`${root}/`);
const text = value => typeof value === "string" && value.trim() && Buffer.byteLength(value) <= 8000;
const safeRef = value => typeof value === "string" && /^[A-Za-z0-9_.\-/]+$/.test(value) && !value.startsWith("/") && value.split("/").every(p => p && p !== "." && p !== "..");
const guidance = {
  initial: "Implement the current task and its required dependencies.",
  repair: "Repair the recorded failures; report remaining issues and affected behavior.",
  takeover: "Inspect the confirmed partial state and complete the remaining approved work. Historical checks are not acceptance of new edits.",
  review: "Review the exact candidate and relevant complete source against acceptance criteria. Report reproducible findings and unverified outcomes.",
  rereview: "Review the repair diff, previous findings and affected dependencies. State this review's coverage; do not upgrade partial coverage to whole-candidate acceptance.",
  reconsideration: "Reconsider only the named finding on the unchanged candidate, using counterevidence and the complete relevant parser/call chain. Return a point judgment, never a new global PASS."
};

/** A derived navigation packet. It grants no authority and never truncates required documents. */
export async function prepareTaskMaterial(target, contract, request) {
  exactKeys(request, ["kind", "instruction", "write_paths", "materials"], ["candidate_revision", "prior_revision"]);
  if (!validateTaskContract(contract).contract_complete) throw Error("Material requires a complete current contract");
  if (!WORK_TYPES.includes(request.kind) || !text(request.instruction) || !Array.isArray(request.write_paths) ||
      !Array.isArray(request.materials) || request.materials.length > 64) throw Error("Invalid work type or bounded material request");
  if (new Set(request.write_paths).size !== request.write_paths.length || request.write_paths.some(ref =>
    typeof ref !== "string" || !contract.environment.write_paths.includes(ref))) throw Error("Material write scope must select exact approved roots");
  if (["review", "rereview", "reconsideration"].includes(request.kind)) {
    if (request.write_paths.length || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(request.candidate_revision ?? "")) throw Error("Review material requires a pinned candidate and read-only scope");
    if (contract.verification.candidate_revision && contract.verification.candidate_revision !== request.candidate_revision) throw Error("Review candidate differs from contract");
    if (await sourceRevision(target) !== request.candidate_revision) throw Error("Review candidate differs from current HEAD");
  }
  if (request.kind === "reconsideration" && request.prior_revision !== request.candidate_revision) throw Error("Reconsideration requires the unchanged prior candidate");
  const sources = new Map();
  const add = (ref, use, purpose) => {
    const old = sources.get(ref);
    sources.set(ref, { path: ref, use: old?.use === "required" ? "required" : use, purposes: [...new Set([...(old?.purposes ?? []), purpose])] });
  };
  for (const ref of [...contract.environment.data.policy_refs, contract.authorization.approval_ref, ...contract.skills]) add(ref, "required", "contract-required");
  const purposes = new Set();
  for (const material of request.materials) {
    exactKeys(material, ["path", "use", "purpose"], ["kinds"]);
    if (!["required", "reference"].includes(material.use) || !text(material.purpose) || !safeRef(material.path) ||
        material.kinds !== undefined && (!Array.isArray(material.kinds) || material.kinds.some(k => !WORK_TYPES.includes(k)))) throw Error("Invalid material selection");
    if (material.kinds?.length && !material.kinds.includes(request.kind)) continue;
    if (!contract.environment.read_paths.some(root => under(material.path, root)) && !sources.has(material.path)) throw Error("Selected material is outside approved read roots");
    add(material.path, material.use, material.purpose);
    if (material.use === "required") purposes.add(material.purpose);
  }
  const needs = { repair: ["findings"], takeover: ["checkpoint"], review: ["source", "diff"], rereview: ["source", "findings", "diff"], reconsideration: ["source", "findings", "counterevidence"] };
  for (const purpose of needs[request.kind] ?? []) if (!purposes.has(purpose)) throw Error(`Work type requires ${purpose} material`);
  // Discover applicable root/nested instructions, but never a global Skill catalog.
  const dirs = new Set(["."]);
  for (const ref of [...sources.keys(), ...request.write_paths]) {
    let dir = path.posix.dirname(ref);
    while (dir !== ".") { dirs.add(dir); dir = path.posix.dirname(dir); }
    if (request.write_paths.includes(ref)) dirs.add(ref);
  }
  for (const dir of dirs) for (const name of ["AGENTS.md", "WORKKEEL.md"]) {
    const ref = dir === "." ? name : `${dir}/${name}`;
    try { await fs.lstat(path.join(target, ref)); add(ref, "required", "project-instructions"); }
    catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; }
  }
  const manifest = [];
  let total = 0;
  for (const source of sources.values()) {
    const file = await readTaskFile(target, source.path, { preserveBom: true });
    if (request.candidate_revision && source.purposes.includes("source")) await assertCandidateSource(target, request.candidate_revision, source.path, file.content);
    if (!file.content.trim()) throw Error(`Empty material: ${source.path}`);
    total += Buffer.byteLength(file.content);
    if (total > 1024 * 1024) throw Error("Selected material exceeds 1 MiB; split work without truncating requirements");
    manifest.push({ ...source, sha256: file.bytes_digest, bytes: Buffer.byteLength(file.content) });
  }
  const prompt = [
    `Work type: ${request.kind}`, request.instruction, guidance[request.kind],
    `Goal: ${JSON.stringify(contract.goal)}`,
    `Write roots (within the full contract): ${JSON.stringify(request.write_paths)}`,
    ...(request.candidate_revision ? [`Candidate: ${request.candidate_revision}`] : []),
    `Acceptance: ${JSON.stringify(contract.acceptance.criteria)}`,
    "Read required material completely; references can be expanded when relevant. Required nested instructions and matching Skills still apply. Source hashes do not prove reading or test execution.",
    ...manifest.map(s => `${s.use}: ${JSON.stringify(s.path)} (${s.purposes.join(", ")})`),
    "Report work performed, actual checks and unverified outcomes within this work type's scope."
  ].join("\n");
  const body = { schema_version: "workkeel.task-material/v1", contract_sha256: executionDigest(contract), request, sources: manifest, prompt };
  return { ...body, sha256: executionDigest(body), authority: "navigation-only" };
}

export async function validateTaskMaterial(target, contract, packet, writePaths) {
  exactKeys(packet, ["schema_version", "contract_sha256", "request", "sources", "prompt", "sha256", "authority"]);
  const current = await prepareTaskMaterial(target, contract, packet.request);
  if (executionDigest(current) !== executionDigest(packet)) throw Error("Prepared material changed; refresh the packet before dispatch");
  if (executionDigest(packet.request.write_paths) !== executionDigest(writePaths)) throw Error("Prepared material and workflow node write scopes differ");
  return packet.prompt;
}

/** Exact grouping retains test IDs and provenance; similar messages are never guessed equal. */
export function summarizeChecks(checks) {
  if (!Array.isArray(checks) || checks.length > 10000) throw Error("Invalid bounded checks");
  const groups = new Map(); const ids = new Set();
  for (const check of checks) {
    exactKeys(check, ["id", "status", "message"]);
    if (!text(check.id) || ids.has(check.id) || !["pass", "fail", "unverified"].includes(check.status) || typeof check.message !== "string" || Buffer.byteLength(check.message) > 8000) throw Error("Invalid or duplicate check");
    ids.add(check.id);
    const key = JSON.stringify([check.status, check.message]);
    const group = groups.get(key) ?? { status: check.status, message: check.message, count: 0, test_ids: [] };
    group.count++; group.test_ids.push(check.id); groups.set(key, group);
  }
  return { total: checks.length, groups: [...groups.values()], acceptance: "not-established" };
}
