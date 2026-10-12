import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { OperationError } from "./operation-errors.mjs";

export const MAX_EVIDENCE_VIEW_BYTES = 8 * 1024 * 1024;
const invalid = message => new OperationError("INVALID_INPUT", message);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

// Ordinary concurrent changes are rejected; this is not a hostile filesystem sandbox.
async function readSource(root, source) {
  if (typeof source !== "string" || !source || source.includes("\\") || /[\x00-\x1f\x7f]/.test(source) ||
      path.posix.isAbsolute(source) || /^[A-Za-z]:/.test(source) || source.split("/").some(p => !p || p === "." || p === "..")) {
    throw invalid("--source must be a regular repository-relative path without traversal");
  }
  const base = await fs.realpath(root);
  let file = base;
  const parts = source.split("/");
  for (let i = 0; i < parts.length; i++) {
    file = path.join(file, parts[i]);
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw invalid(`Evidence source must not contain links or special files: ${source}`);
    }
  }
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_EVIDENCE_VIEW_BYTES)) throw invalid("Evidence source must be a regular file of at most 8 MiB");
    // One extra byte detects growth without an unbounded read/allocation.
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const current = await fs.lstat(file, { bigint: true });
    if (["dev", "ino", "size", "mtimeNs", "ctimeNs"].some(key => before[key] !== after[key] || after[key] !== current[key]) || BigInt(used) !== before.size) {
      throw invalid("Evidence source changed while reading; retry against a stable original");
    }
    const bytes = buffer.subarray(0, used);
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw invalid("Evidence source is not valid UTF-8"); }
    if (text.includes("\0")) throw invalid("Binary evidence is not supported by this text view");
    return { text, bytes: used, sha256: digest(bytes) };
  } finally { await handle.close(); }
}

// Validate syntax, but do not serialize parsed values: that would round large
// numbers, discard duplicate keys, change escapes and lose negative zero.
function compactJson(text) {
  try { JSON.parse(text); } catch { throw invalid("--format json requires valid JSON"); }
  let quoted = false, escaped = false, result = "";
  for (const character of text) {
    if (quoted) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') { quoted = true; result += character; }
    else if (!/[\t\n\r ]/.test(character)) result += character;
  }
  return result;
}

function compactNodeTest(text) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const start = lines.findIndex(line => /^ℹ tests \d+\r?\n?$/.test(line));
  const summaryKeys = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo", "duration_ms"];
  // Unknown / colored / incomplete output is preserved, not heuristically truncated.
  const recognized = start >= 0 && summaryKeys.every((key, i) =>
    new RegExp(`^ℹ ${key} \\d+(?:\\.\\d+)?\\r?\\n?$`).test(lines[start + i] ?? ""));
  if (!recognized) return { content: text, omitted: 0, summary: null, reason: "unrecognized-node-test-summary" };
  const summary = Object.fromEntries(summaryKeys.map((key, i) => [key, lines[start + i].trim().slice(key.length + 3)]));
  let omitted = 0;
  const content = lines.filter((line, index) => {
    const drop = index < start && /^✔ [^\r\n]+ \(\d+(?:\.\d+)?ms\)\r?\n$/.test(line);
    if (drop) omitted++;
    return !drop;
  }).join("");
  return { content, omitted, summary, reason: omitted ? "passing-result-lines-omitted" : "no-eligible-passing-lines" };
}

/** A local reading view; never test execution, stored evidence or acceptance. */
export async function evidenceView(root, { source, format = "text", compact = false, expectedSha256 } = {}) {
  if (!["text", "json", "node-test"].includes(format)) throw invalid("--format must be text, json or node-test");
  if (typeof compact !== "boolean") throw invalid("compact must be a boolean");
  if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedSha256)) throw invalid("--expected-sha256 requires 64 lowercase hexadecimal characters");
  const original = await readSource(root, source);
  if (expectedSha256 !== undefined && expectedSha256 !== original.sha256) throw invalid("Evidence source digest changed; inspect the current original before reusing this view");
  let content = original.text, omitted = 0, summary = null, reason = "original-content";
  if (format === "json") {
    const minified = compactJson(original.text);
    if (compact) { content = minified; reason = "json-whitespace-only"; }
  } else if (compact && format === "node-test") {
    ({ content, omitted, summary, reason } = compactNodeTest(original.text));
  } else if (compact) reason = "text-preserved";
  return {
    schema_version: "temple.evidence-view/v1", authority: "reading-view-only",
    mutation_performed: false, execution_started: false, acceptance_granted: false,
    source: { path: source, sha256: original.sha256, bytes: original.bytes },
    format, compact, reason, omitted_passing_lines: omitted, summary,
    content_bytes: Buffer.byteLength(content),
    limitations: ["This reading view is not independent acceptance or a new test run.",
      "Omitted passing-test names and timings require the original; absence here does not mean a test did not run.",
      "The source path is a local reference, not a retained snapshot; verify its digest when reading again.",
      "No token usage, provider cache or billing savings were measured by this command."],
    original_read: { command: "evidence view", source, format: "text", compact: false, expected_sha256: original.sha256 },
    content
  };
}

export function renderEvidenceView(view) {
  const sourceArgument = "'" + view.source.path.replaceAll("'", "'\"'\"'") + "'";
  return ["Evidence reading view — no acceptance granted", `Source: ${view.source.path}`,
    `SHA-256: ${view.source.sha256}`, `Bytes: ${view.source.bytes} -> ${view.content_bytes}; omitted passing lines: ${view.omitted_passing_lines}`,
    ...view.limitations.map(line => `Limit: ${line}`),
    `Original (POSIX shell arguments): evidence view --source ${sourceArgument} --format text --expected-sha256 ${view.source.sha256}`,
    "", view.content].join("\n");
}
