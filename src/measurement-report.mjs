import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sha256 } from "./files.mjs";
import { isWorkItemId } from "./ids.mjs";
import { OperationError } from "./operation-errors.mjs";
import { inspectMeasurement } from "./verification.mjs";

const exec = promisify(execFile);
const git = async (root, args) => (await exec("git", ["-C", root, ...args], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 })).stdout;
const invalid = message => new OperationError("INVALID_INPUT", message);

// Walk each component without following links. Exclusive writes below never replace
// evidence. Like the existing store, this is not a hostile concurrent-FS sandbox.
async function safePath(root, relative, create = false) {
  let current = await fs.realpath(root);
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat = await fs.lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!stat && create && i < parts.length - 1) {
      await fs.mkdir(current).catch(error => { if (error.code !== "EEXIST") throw error; });
      stat = await fs.lstat(current);
    }
    if (stat?.isSymbolicLink() || stat && (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw invalid(`Unsafe evidence path: ${relative}`);
  }
  return current;
}

async function candidateBinding(root, revision, fingerprint) {
  if (!fingerprint.complete) return { matches: false, reason: "measurement-inputs-unavailable", mismatches: [] };
  const entries = new Map((await git(root, ["ls-tree", "-rz", "--full-tree", revision])).toString("utf8").split("\0").filter(Boolean).map(row => {
    const tab = row.indexOf("\t"), [mode, type, oid] = row.slice(0, tab).split(" ");
    return [row.slice(tab + 1), { mode, type, oid }];
  }));
  const mismatches = [];
  const inventory = fingerprint.inventory;
  for (const [name, record] of Object.entries(inventory)) {
    if (record.type === "directory") {
      if (![...entries.keys()].some(candidatePath => candidatePath.startsWith(name + "/"))) mismatches.push(name);
      // Extra committed files absent from the measured directory also invalidate it.
      for (const candidatePath of entries.keys()) if (candidatePath.startsWith(name + "/") && !inventory[candidatePath]) mismatches.push(candidatePath);
      continue;
    }
    const entry = entries.get(name);
    if (!entry || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode) ||
        (entry.mode === "100755") !== Boolean(record.mode & 0o111) ||
        sha256(await git(root, ["cat-file", "blob", entry.oid])) !== record.sha256) mismatches.push(name);
  }
  return { matches: mismatches.length === 0, reason: mismatches.length ? "declared-inputs-differ-from-candidate" : "declared-inputs-match-candidate",
    mismatches: [...new Set(mismatches)].sort(), coverage: "declared-inputs-only; reviewer must assess omitted dependencies and relevance" };
}

/** Mechanical evidence, never an independent judgment, a rerun, or a lifecycle write. */
export async function measurementReport(root, plan, { workItemId, revision, output, ...inspectionOptions } = {}) {
  const started = performance.now();
  if (!isWorkItemId(workItemId)) throw invalid("Select an existing --work-item ID");
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision ?? "")) throw invalid("--revision requires an exact full lowercase Git commit ID");
  if (output !== undefined && (typeof output !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.md$/.test(output))) throw invalid("--output must be a Markdown filename, stored only under this Work Item's artifact directory");
  const itemPath = await safePath(root, `.ai-org/work-items/${workItemId}.json`);
  const item = JSON.parse(await fs.readFile(itemPath, "utf8"));
  if (item.id !== workItemId) throw invalid("Work Item identity does not match its path");
  try {
    if ((await git(root, ["rev-parse", "--verify", `${revision}^{commit}`])).toString("utf8").trim() !== revision) throw invalid("Select a commit, not a tag object");
  } catch { throw invalid("The exact candidate commit is unavailable locally"); }
  const observed = await inspectMeasurement(root, plan, inspectionOptions);
  const binding = await candidateBinding(root, revision, observed.fingerprint);
  // Recheck after Git reads so ordinary concurrent input changes cannot become a pass.
  const refreshed = await inspectMeasurement(root, plan, inspectionOptions);
  const stable = observed.fingerprint.key === refreshed.fingerprint.key && observed.reason === refreshed.reason && observed.result_ref === refreshed.result_ref;
  const result = observed.result;
  const report = {
    schema_version: "temple.measurement-report/v1", authority: "mechanical-observation-only",
    work_item_id: workItemId, candidate_revision: revision, work_item_state: item.state,
    execution_started: false, acceptance_granted: false, independent_review_required: true,
    applicable: stable && observed.cache_status === "hit" && binding.matches,
    cache_status: observed.cache_status, reason: stable ? observed.reason : "measurement-changed-during-report",
    candidate_binding: binding, result_ref: observed.result_ref ?? null,
    observation: result ? { attempt_id: result.attempt_id, status: result.status, successful: result.successful,
      started_at_ms: result.started_at_ms, completed_at_ms: result.completed_at_ms,
      elapsed_ms: result.elapsed_ms ?? null, monotonic_elapsed_ms: result.monotonic_elapsed_ms ?? null,
      exit_code: result.exit_code ?? null, timed_out: result.timed_out ?? null,
      instrument_error: result.instrument_error ?? null,
      tests: Number.isSafeInteger(result.tests) ? result.tests : null,
      artifact_integrity: observed.cache_status === "hit" ? "verified" : "not-established",
      artifacts: (result.artifacts ?? []).map(({ path, sha256, bytes, kind }) => ({ path, sha256, bytes, kind })) } : null,
    token_usage: null, cost: null,
    limitations: ["No test command was executed by this report; elapsed values belong to the original attempt.",
      "Reuse eligibility is not proof that any particular caller reused this attempt.",
      "Candidate binding covers declared inputs only; command output is not independent acceptance.",
      "Token usage and billing were not observed."],
    next_action: "The eligible reviewer must assess candidate applicability and record their own judgment; retain this measurement as supporting evidence."
  };
  if (!report.applicable) report.next_action = "Resolve the reported measurement or candidate mismatch; preserve this attempt and obtain applicable evidence before acceptance.";
  const markdown = `# Mechanical measurement evidence\n\nGenerated from the immutable measurement store. No independent acceptance is granted.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
  let evidenceRef = null, mutationStatus = "not-performed";
  if (output !== undefined) {
    evidenceRef = `.ai-org/artifacts/${workItemId}/${output}`;
    const overlaps = name => name === evidenceRef || name.startsWith(evidenceRef + "/") || evidenceRef.startsWith(name + "/");
    if ([...Object.values(plan.inputs).flat(), ...plan.toolchain.files, ...plan.outputs].some(overlaps)) throw invalid("Evidence output cannot overlap declared measurement inputs or outputs");
    const file = await safePath(root, evidenceRef, true);
    try { await fs.writeFile(file, markdown, { flag: "wx", mode: 0o600 }); mutationStatus = "performed"; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await fs.readFile(file, "utf8") !== markdown) throw invalid("Evidence already exists with different contents; choose a new attempt-specific filename");
      mutationStatus = "unchanged";
    }
  }
  return { ...report, mutation_status: mutationStatus, evidence_ref: evidenceRef, markdown, report_elapsed_ms: performance.now() - started };
}
