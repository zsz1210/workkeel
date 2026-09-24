import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";
import { binaryReviewDifferences } from "./binary-review-check.mjs";

const previous = JSON.parse(fs.readFileSync(".ai-org/artifacts/WI-0160/binary-review.json", "utf8"));
const addendum = JSON.parse(fs.readFileSync(".ai-org/artifacts/WI-0268/binary-review-addendum.json", "utf8"));
assert.equal(addendum.schema_version, "workkeel.publication-binary-addendum/v1");
assert.equal(addendum.prior_review, ".ai-org/artifacts/WI-0160/binary-review.json");
assert.equal(previous.records.length, addendum.reused_exact_count);

const tracked = execFileSync("git", ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
const binary = tracked.filter((pathname) => fs.statSync(pathname).isFile() && fs.readFileSync(pathname).includes(0));
const records = [...previous.records, ...addendum.records];
assert.equal(binary.length, addendum.inventory_count);
assert.equal(records.length, binary.length);
assert.equal(new Set(records.map((entry) => entry.path)).size, records.length);
const expected = new Map(records.map((entry) => [entry.path, entry.sha256]));
const actual = new Map(binary.map((pathname) => [pathname, crypto.createHash("sha256").update(fs.readFileSync(pathname)).digest("hex")]));
const priorProvenance = JSON.parse(fs.readFileSync(".ai-org/artifacts/WI-0241/public-evidence-provenance.json", "utf8"));
const diagnosticProvenance = JSON.parse(fs.readFileSync(".ai-org/artifacts/WI-0242/diagnostic-provenance.json", "utf8"));
const finalProvenance = JSON.parse(fs.readFileSync(".ai-org/artifacts/WI-0242/final-provenance.json", "utf8"));
const provenance = new Map(priorProvenance.archives.map((entry) => [entry.path, entry.public_archive_sha256]));
provenance.set(".ai-org/artifacts/WI-0242/diagnostic-evidence.tar.gz", diagnosticProvenance.archive_sha256);
provenance.set(".ai-org/artifacts/WI-0242/final-verification.tar.gz", finalProvenance.archive_sha256);
assert.equal(addendum.records.filter((entry) => entry.review === "reviewed-redaction-placeholder" && provenance.has(entry.path)).length, 7);
assert.deepEqual(binaryReviewDifferences(expected, actual, provenance), { stale: [], new: [], missing: [], tampered: [] });

const patterns = {
  private_key: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/g,
  provider_key: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  github_token: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  aws_key: /\bAKIA[0-9A-Z]{16}\b/g,
  npm_token: /\bnpm_[A-Za-z0-9]{20,}\b/g,
  home_path: /\/(?:Users|home)\/[A-Za-z0-9._-]+/g,
  private_ip: /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g,
  tailnet: /\b[a-z0-9][a-z0-9-]*\.tail[a-z0-9-]*\.ts\.net\b/gi
};
const redactionPlaceholders = new Set(["Users", "home"].map((root) => ["", root, "REDACTED"].join("/")));

function privacyCounts(bytes) {
  assert.equal(bytes.includes(0), false, "opaque archive member needs separate review");
  const content = bytes.toString("utf8");
  const counts = {};
  for (const [id, expression] of Object.entries(patterns)) {
    const count = [...content.matchAll(expression)].length;
    if (count) counts[id] = count;
  }
  const nonPlaceholderHomePaths = [...content.matchAll(patterns.home_path)]
    .filter((match) => !redactionPlaceholders.has(match[0])).length;
  return { counts, nonPlaceholderHomePaths };
}

function tarPayloads(bytes) {
  const payloads = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= bytes.length, "invalid TAR member");
    if (header[156] === 0 || header[156] === 48) payloads.push(bytes.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return payloads;
}

let reviewedPngs = 0;
let reviewedArchives = 0;
let placeholderArchives = 0;
let placeholderMatches = 0;
for (const record of records) {
  const bytes = fs.readFileSync(record.path);
  assert.equal(bytes.length, record.bytes, record.path);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), record.sha256, record.path);
  if (record.kind === "png" || record.path.endsWith(".png")) {
    assert.equal(bytes.toString("hex", 0, 8), "89504e470d0a1a0a", record.path);
    if (record.width !== undefined) assert.equal(bytes.readUInt32BE(16), record.width, record.path);
    if (record.height !== undefined) assert.equal(bytes.readUInt32BE(20), record.height, record.path);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset);
      const chunk = bytes.toString("ascii", offset + 4, offset + 8);
      assert.ok(!["tEXt", "zTXt", "iTXt", "eXIf"].includes(chunk), `${record.path}: embedded metadata requires review`);
      offset += size + 12;
      if (chunk === "IEND") break;
    }
    if (record.kind === "png") assert.equal(record.review, "visual-and-chunk-reviewed");
    else {
      assert.equal(record.review.visual, "pass", record.path);
      assert.equal(record.review.ocr_privacy, "pass", record.path);
      assert.equal(record.review.disposition, "retain-current-binary", record.path);
    }
    reviewedPngs += 1;
    continue;
  }
  assert.ok(record.kind === "gzip" || record.kind === "tar-gzip", record.path);
  const unpacked = zlib.gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 });
  const payloads = record.kind === "tar-gzip" ? tarPayloads(unpacked) : [unpacked];
  const counts = {};
  let nonPlaceholderHomePaths = 0;
  for (const payload of payloads) {
    const result = privacyCounts(payload);
    nonPlaceholderHomePaths += result.nonPlaceholderHomePaths;
    for (const [id, count] of Object.entries(result.counts)) counts[id] = (counts[id] ?? 0) + count;
  }
  const categories = Object.keys(counts);
  if (record.review === "reviewed-redaction-placeholder") {
    assert.deepEqual(categories, ["home_path"], record.path);
    assert.equal(nonPlaceholderHomePaths, 0, record.path);
    assert.equal(counts.home_path, record.placeholder_home_path_count, record.path);
    placeholderArchives += 1;
    placeholderMatches += counts.home_path;
  } else {
    assert.equal(record.review, "decompressed-pattern-reviewed", record.path);
    assert.deepEqual(categories, [], record.path);
    reviewedArchives += 1;
  }
}

console.log(JSON.stringify({
  status: "exact-inventory-reviewed",
  exact_prior_matches: previous.records.length,
  current_binary_paths: binary.length,
  visual_pngs: reviewedPngs,
  clear_archives: reviewedArchives,
  redaction_placeholder_archives: placeholderArchives,
  redaction_placeholder_matches: placeholderMatches,
  generic_binary_review_still_required: true,
  publication_authorized: false
}, null, 2));
