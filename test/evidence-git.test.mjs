import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { validateEvidenceArtifacts, evidencePreservationTag } from "../src/evidence.mjs";
import { sha256 } from "../src/files.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-evidence-git-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = cp.spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  const bodies = { "binary.dat": Buffer.from([0, 10, 255, 13, 32]), "space name.txt": Buffer.from("hello\nworld\n"), "empty": Buffer.alloc(0) };
  for (const [file, body] of Object.entries(bodies)) await fs.writeFile(path.join(root, file), body);
  git("add", "."); git("commit", "-qm", "fixture");
  const revision = git("rev-parse", "HEAD");
  const entry = { id: "evidence", work_item_id: "WI-0001", scope_revision: revision, artifacts: Object.entries(bodies).map(([file, body]) => ({ path: file, sha256: sha256(body) })) };
  return { root, git, entry };
}

function intercept(t, handler) {
  const original = cp.spawnSync;
  t.mock.method(cp, "spawnSync", (...args) => handler(original, ...args));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

test("historical evidence batches binary/empty/space-path blobs and deduplicates revisions", async (t) => {
  const { root, entry } = await fixture(t);
  const calls = [];
  intercept(t, (original, ...args) => { calls.push(args[1]); return original(...args); });
  const result = await validateEvidenceArtifacts(root, { entries: Array.from({ length: 100 }, (_, n) => ({ ...entry, id: `e-${n}` })) });
  assert.deepEqual(result, { valid: true, errors: [] });
  assert.equal(calls.length, 3, "one revision check, one ancestry check, one batch");
  assert.equal(calls.filter((args) => args.includes("--batch")).length, 1);
});

test("cache does not suppress per-entry mismatches, unknown Work Items or missing revisions", async (t) => {
  const { root, entry } = await fixture(t);
  const result = await validateEvidenceArtifacts(root, { entries: [entry,
    { ...entry, id: "bad", artifacts: [{ ...entry.artifacts[0], sha256: "0".repeat(64) }] },
    { ...entry, id: "missing", scope_revision: "f".repeat(40) },
    { ...entry, id: "invalidated", invalidated_at: "2026-01-01" }
  ] }, new Set());
  assert.equal(result.valid, false);
  assert.equal(result.errors.filter((error) => error.includes("unknown Work Item")).length, 4);
  assert.ok(result.errors.some((error) => error.startsWith("bad:") && error.includes("digest mismatch")));
  assert.ok(result.errors.some((error) => error.startsWith("missing:") && error.includes("unavailable")));
});

test("absent historical artifacts keep working-tree fallback and never cache mutable files across calls", async (t) => {
  const { root, entry } = await fixture(t);
  const artifact = { path: "local.txt", sha256: sha256("fresh") };
  const registry = { entries: [{ ...entry, artifacts: [artifact] }] };
  assert.match((await validateEvidenceArtifacts(root, registry)).errors[0], /is missing/);
  await fs.writeFile(path.join(root, artifact.path), "fresh");
  assert.equal((await validateEvidenceArtifacts(root, registry)).valid, true);
  await fs.writeFile(path.join(root, artifact.path), "changed");
  assert.match((await validateEvidenceArtifacts(root, registry)).errors[0], /digest mismatch/);
});

test("durability and preservation tags are rechecked on the next invocation", async (t) => {
  const { root, git, entry } = await fixture(t);
  await fs.writeFile(path.join(root, "next"), "next");
  git("add", "."); git("commit", "-qm", "next");
  const next = git("rev-parse", "HEAD");
  git("checkout", "--detach", entry.scope_revision);
  const registry = { entries: [{ ...entry, scope_revision: next }] };
  assert.match((await validateEvidenceArtifacts(root, registry)).errors[0], /not durable/);
  const tag = evidencePreservationTag(next);
  git("tag", tag, next);
  assert.equal((await validateEvidenceArtifacts(root, registry)).valid, true);
  git("tag", "-f", tag, entry.scope_revision);
  assert.match((await validateEvidenceArtifacts(root, registry)).errors[0], /tag targets/);
});

test("failed or truncated batches fall back to real per-object integrity checks", async (t) => {
  const { root, entry } = await fixture(t);
  for (const broken of [Buffer.from("truncated"), Buffer.from("a".repeat(40) + " blob 900000\nshort\n")]) {
    intercept(t, (original, command, args, options) => args.includes("--batch")
      ? { status: 0, stdout: broken, stderr: Buffer.alloc(0) }
      : original(command, args, options));
    assert.equal((await validateEvidenceArtifacts(root, { entries: [entry] })).valid, true);
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});

test("newline paths use safe individual calls and non-blob objects cannot validate", async (t) => {
  const { root, git, entry } = await fixture(t);
  await fs.writeFile(path.join(root, "line\nname"), "line");
  await fs.mkdir(path.join(root, "directory"));
  await fs.writeFile(path.join(root, "directory/file"), "file");
  git("add", "."); git("commit", "-qm", "unusual paths");
  const revision = git("rev-parse", "HEAD");
  assert.equal((await validateEvidenceArtifacts(root, { entries: [{ ...entry, scope_revision: revision,
    artifacts: [{ path: "line\nname", sha256: sha256("line") }] }] })).valid, true);
  const result = await validateEvidenceArtifacts(root, { entries: [{ ...entry, scope_revision: revision,
    artifacts: [{ path: "directory", sha256: sha256("") }] }] });
  assert.match(result.errors[0], /cannot be read/);
});
