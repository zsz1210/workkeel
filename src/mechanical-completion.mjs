import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sha256 } from "./files.mjs";

export const MECHANICAL_POLICY = ".ai-org/project/mechanical-policy.json";
const notePath = value => typeof value === "string" && /^docs\/notes\/[a-z0-9][a-z0-9-]{0,79}\.txt$/.test(value);
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const requireThat = (ok, reason) => { if (!ok) throw new Error(`Mechanical completion: ${reason}`); };
function git(root, args, raw = false) {
  return execFileSync("git", ["-c", "core.fsmonitor=false", "-C", root, ...args],
    { encoding: raw ? null : "utf8", maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
}
async function regular(root, relative) {
  let current = root;
  for (const [i, component] of relative.split("/").entries()) {
    current = path.join(current, component);
    const stat = await fs.lstat(current);
    requireThat(!stat.isSymbolicLink() && (i === relative.split("/").length - 1 ? stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o111) : stat.isDirectory()), "regular unlinked non-executable files required");
    requireThat(i < relative.split("/").length - 1 || stat.size <= 65536, "file exceeds bounded size");
  }
  return fs.readFile(current);
}
function blob(root, revision, file) {
  const entry = git(root, ["ls-tree", revision, "--", file]).trim();
  requireThat(entry.startsWith("100644 blob ") && entry.endsWith(`\t${file}`), "committed regular non-executable file required");
  return git(root, ["show", `${revision}:${file}`], true);
}
const text = bytes => {
  const value = bytes.toString("utf8");
  requireThat(bytes.equals(Buffer.from(value, "utf8")) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "plain UTF-8 text required");
  return value;
};

// Read-only qualification. Repository records are an approval trust boundary,
// not proof of a human signature or of semantic harmlessness.
export async function verifyMechanicalCompletion(root, item, request) {
  requireThat(item.state === "build" && item.owner_position === "developer" && item.workflow_profile === "lean" &&
    item.risk_tier === "low" && item.profile_assessment?.scope_class === "bounded" &&
    !item.profile_assessment?.escalation_triggers?.length && item.ui_delivery_mode === "not-applicable" &&
    !item.unresolved?.length && !item.spec_refs?.length && !item.ux_refs?.length && !item.ui_refs?.length && !item.contract_refs?.length &&
    !item.dependencies?.length && !item.shared_contract_refs?.length, "ordinary verification required for this scope");
  requireThat(item.claim?.status === "active" && item.claim.id === request.claim_id && item.claim.agent_id === request.agent_id &&
    item.claim.principal_id === request.principal_id && request.position === "developer", "active Developer claim required");
  const base = item.claim.base_revision;
  requireThat(/^[a-f0-9]{40}$/.test(base ?? "") && /^[a-f0-9]{40}$/.test(request.candidate_revision ?? "") && base !== request.candidate_revision,
    "exact distinct base and candidate required");
  requireThat(git(root, ["rev-parse", "HEAD"]).trim() === request.candidate_revision, "candidate must be HEAD");
  git(root, ["merge-base", "--is-ancestor", base, request.candidate_revision]);
  const contractRef = `.ai-org/artifacts/${item.id}/mechanical-contract.json`;
  requireThat(request.mechanical_contract === contractRef &&
    ["approved_scope", "acceptance_criteria"].every(gate => item.gate_evidence?.[gate]?.length === 1 && item.gate_evidence[gate][0] === contractRef), "sole prior approved scope and acceptance contract required");
  const policyBytes = await regular(root, MECHANICAL_POLICY), contractBytes = await regular(root, contractRef);
  requireThat(policyBytes.equals(blob(root, base, MECHANICAL_POLICY)) && contractBytes.equals(blob(root, base, contractRef)), "approval inputs changed since claimed base");
  const policy = JSON.parse(text(policyBytes)), contract = JSON.parse(text(contractBytes));
  requireThat(exactKeys(policy, ["schema_version", "enabled", "approved_by", "non_normative_files"]) &&
    policy.schema_version === "temple.mechanical-policy/v1" && policy.enabled === true && policy.approved_by === request.principal_id &&
    Array.isArray(policy.non_normative_files) && policy.non_normative_files.length > 0 && policy.non_normative_files.length <= 20 &&
    policy.non_normative_files.every(notePath) && new Set(policy.non_normative_files).size === policy.non_normative_files.length, "disabled or invalid project opt-in");
  requireThat(exactKeys(contract, ["schema_version", "work_item_id", "approved_by", "file", "before_sha256", "old_text", "new_text"]) &&
    contract.schema_version === "temple.mechanical-contract/v1" && contract.work_item_id === item.id &&
    contract.approved_by === request.principal_id && notePath(contract.file) && policy.non_normative_files.includes(contract.file) &&
    /^[a-f0-9]{64}$/.test(contract.before_sha256 ?? ""), "invalid or unapproved exact-text contract");
  const collaboration = JSON.parse(await fs.readFile(path.join(root, ".ai-org/project/collaboration.json")));
  requireThat(collaboration.profile === "solo", "ordinary verification required outside Solo");
  const lock = JSON.parse(await fs.readFile(path.join(root, "temple.lock")));
  requireThat(Array.isArray(lock.managed_files) && lock.managed_files.every(entry =>
    entry && typeof entry.path === "string" && typeof entry.sha256 === "string"), "valid managed-file inventory required");
  requireThat(!lock.managed_files.some(entry => entry.path === contract.file), "managed content excluded");
  const index = JSON.parse(await fs.readFile(path.join(root, ".ai-org/project/spec-index.json")));
  requireThat(!(index.entries ?? []).some(e => e.source?.location === contract.file || e.approval_ref === contract.file), "authority-indexed content excluded");
  requireThat((item.affected_paths ?? []).filter(p => !p.startsWith(".ai-org/")).join("\n") === contract.file, "one exact affected note required");
  for (const value of [contract.old_text, contract.new_text]) requireThat(typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= 4096 && !/[\r\n\u0000-\u001f\u007f]/.test(value), "one nonempty literal line fragment required");
  requireThat(contract.old_text !== contract.new_text, "replacement must change text");
  const beforeBytes = blob(root, base, contract.file), before = text(beforeBytes);
  requireThat(beforeBytes.length <= 65536, "original file exceeds bounded size");
  requireThat(sha256(beforeBytes) === contract.before_sha256, "original content digest mismatch");
  const at = before.indexOf(contract.old_text);
  requireThat(at >= 0 && before.indexOf(contract.old_text, at + 1) < 0, "old literal must occur exactly once");
  const expected = before.slice(0, at) + contract.new_text + before.slice(at + contract.old_text.length);
  const actual = await regular(root, contract.file), committed = blob(root, request.candidate_revision, contract.file);
  requireThat(text(actual) === expected && actual.equals(committed), "candidate differs from exact authorized replacement");
  const changed = git(root, ["diff", "--no-ext-diff", "--name-only", "--no-renames", "-z", base, request.candidate_revision]).split("\0").filter(Boolean);
  requireThat(changed.length === 1 && changed[0] === contract.file, "additional committed changes require ordinary verification");
  // Canonical delivery bookkeeping may be uncommitted, but no product change,
  // untracked product file, native instruction or integration input may be hidden.
  const dirty = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
  const bookkeeping = file => file === `.ai-org/work-items/${item.id}.json` || file === ".ai-org/events/events.jsonl" ||
    file.startsWith(".ai-org/views/") || file.startsWith(`.ai-org/artifacts/${item.id}/`);
  requireThat(dirty.every(row => /^(?: [MAD]|[MAD?][ MAD?])/.test(row) && bookkeeping(row.slice(3))), "uncommitted product or authority changes require ordinary verification");
  return { schema_version: "temple.mechanical-proof/v1", kind: "exact-text-replacement", base_revision: base,
    candidate_revision: request.candidate_revision, file: contract.file, before_sha256: contract.before_sha256,
    after_sha256: sha256(actual), contract_ref: contractRef, contract_sha256: sha256(contractBytes),
    policy_sha256: sha256(policyBytes), independent_qa: false,
    input_paths: [MECHANICAL_POLICY, contractRef, contract.file] };
}
