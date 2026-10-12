import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../src/files.mjs";
import { exportEvidenceBundle, importEvidenceBundle, inspectEvidenceDurability, recordEvidenceSources, retrieveEvidenceBundleArtifact, verifyEvidenceBundle } from "../src/evidence-bundle.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-field-evidence-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  const bodies = { "binary.dat": Buffer.from([0, 255, 10, 13, 2]), "empty.txt": Buffer.alloc(0), "space name.txt": Buffer.from("historical\n") };
  for (const [file, body] of Object.entries(bodies)) await fs.writeFile(path.join(root, file), body);
  git("add", "."); git("commit", "-qm", "historical fixture");
  const revision = git("rev-parse", "HEAD");
  const entry = { id: "EVID-fixture", work_item_id: "WI-0001", scope_revision: revision, kind: "test", outcome: "passed",
    invalidated_at: null, artifacts: Object.entries(bodies).map(([file, body]) => ({ path: file, sha256: sha256(body) })) };
  return { root, git, entry, bodies, registry: { entries: [entry] } };
}

test("V11: explicitly selected archive retrieves exact binary, empty and spaced historical bytes in a clone without the source commit", async t => {
  const { root, entry, registry, bodies, git } = await fixture(t);
  for (const file of Object.keys(bodies)) await fs.writeFile(path.join(root, file), "unrelated current content");
  const exported = await exportEvidenceBundle(root, { registry, evidenceIds: [entry.id] });
  assert.equal(exported.valid, true, exported.errors.join(";"));
  assert.equal(exported.artifact_count, 3);
  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), "temple-field-fresh-clone-"));
  t.after(() => fs.rm(fresh, { recursive: true, force: true }));
  // A real single-branch local clone intentionally has an unrelated root commit.
  git("checkout", "--orphan", "portable-target"); git("rm", "--cached", "-rf", ".");
  await fs.writeFile(path.join(root, "README.md"), "Unrelated current checkout\n");
  git("add", "README.md"); git("commit", "-qm", "clean clone baseline");
  const cloned = spawnSync("git", ["clone", "--quiet", "--no-local", "--single-branch", "--branch", "portable-target", root, fresh], { encoding: "utf8" });
  assert.equal(cloned.status, 0, cloned.stderr);
  const imported = await importEvidenceBundle(fresh, exported.bundle);
  assert.equal(imported.valid, true);
  assert.equal(imported.archive_integrity, "verified");
  assert.equal(imported.original_revision_availability[0].available, false);
  assert.equal(imported.registry_mutated, false);
  assert.equal(imported.acceptance_granted, false);
  assert.equal((await importEvidenceBundle(fresh, exported.bundle)).already_present, true);
  await assert.rejects(fs.access(path.join(fresh, ".ai-org/project/evidence.json")), { code: "ENOENT" });
  for (const [file, body] of Object.entries(bodies)) {
    const retrieved = await retrieveEvidenceBundleArtifact(exported.bundle, { evidenceId: entry.id, path: file });
    assert.deepEqual(retrieved.bytes, body);
  }
});

test("V11: missing historical bytes remain missing even when a current file has the recorded digest", async t => {
  const { root, entry } = await fixture(t);
  await fs.writeFile(path.join(root, "later.txt"), "later");
  const registry = { entries: [{ ...entry, artifacts: [{ path: "later.txt", sha256: sha256("later") }] }] };
  const inspected = await inspectEvidenceDurability(root, { registry, candidateRevision: entry.scope_revision });
  assert.equal(inspected.valid, false);
  assert.equal(inspected.current_candidate_debt, 1);
  assert.equal(inspected.items[0].artifacts[0].status, "missing");
  const exported = await exportEvidenceBundle(root, { registry, evidenceIds: [entry.id], outputPath: "archive.json" });
  assert.equal(exported.valid, false);
  assert.match(exported.errors[0], /absent at the recorded Git revision/);
  await assert.rejects(fs.access(path.join(root, "archive.json")), { code: "ENOENT" });
});

test("V11: tampering, path escape, duplicate records, size limits and manifest collisions fail closed", async t => {
  const { root, entry, registry } = await fixture(t);
  const { bundle } = await exportEvidenceBundle(root, { registry, evidenceIds: [entry.id] });
  const cases = [
    copy => { copy.artifacts[0].content_base64 = Buffer.from("wrong").toString("base64"); },
    copy => { copy.artifacts[0].path = "../outside"; },
    copy => { copy.entries[0].artifacts[0].path = "C:/outside"; },
    copy => { copy.entries.push(structuredClone(copy.entries[0])); },
    copy => { copy.artifacts.push(structuredClone(copy.artifacts[0])); },
    copy => { copy.artifacts[0].size_bytes = 99_999_999; },
    copy => { copy.entries[0].outcome = "invented acceptance"; },
    copy => { copy.artifacts.pop(); }
  ];
  for (const mutate of cases) {
    const copy = structuredClone(bundle); mutate(copy);
    assert.equal((await verifyEvidenceBundle(copy)).valid, false);
    assert.equal((await importEvidenceBundle(root, copy)).mutation_performed, false);
  }
  assert.equal((await verifyEvidenceBundle(bundle, { maxTotalBytes: 3 })).valid, false);
  assert.equal((await exportEvidenceBundle(root, { registry, evidenceIds: [entry.id], maxArtifactBytes: 2 })).valid, false);
});

test("V11: export selection, source symlinks and output symlink parents cannot leak or replace bytes", async t => {
  const { root, entry, registry, git } = await fixture(t);
  assert.equal((await exportEvidenceBundle(root, { registry })).valid, false);
  assert.equal((await exportEvidenceBundle(root, { registry, evidenceIds: ["missing"] })).valid, false);
  assert.equal((await exportEvidenceBundle(root, { registry, evidenceIds: [entry.id, entry.id] })).valid, false);
  await fs.symlink("binary.dat", path.join(root, "linked"));
  git("add", "."); git("commit", "-qm", "symlink fixture");
  const source = { ...entry, scope_revision: git("rev-parse", "HEAD"), artifacts: [{ path: "linked", sha256: sha256("binary.dat") }] };
  assert.match((await exportEvidenceBundle(root, { registry: { entries: [source] }, evidenceIds: [entry.id] })).errors[0], /regular Git file/);
  await fs.symlink(os.tmpdir(), path.join(root, "escaped"));
  assert.equal((await exportEvidenceBundle(root, { registry, evidenceIds: [entry.id], outputPath: "escaped/archive.json" })).valid, false);
});

test("V08/V11: scoped durability separates old debt and keeps invalidated attempt metadata", async t => {
  const { root, entry, registry } = await fixture(t);
  const invalidated = { ...entry, id: "EVID-invalidated", invalidated_at: "2026-09-16T00:00:00Z", invalidated_by: "reviewer", invalidation_reason: "superseded measurement" };
  const missing = { ...entry, id: "EVID-old-missing", scope_revision: "f".repeat(40) };
  registry.entries.push(invalidated, missing, { ...missing, id: "other-work", work_item_id: "WI-0002" });
  const scoped = await inspectEvidenceDurability(root, { registry, workItemIds: ["WI-0001"], candidateRevision: entry.scope_revision });
  assert.equal(scoped.items.length, 3);
  assert.equal(scoped.historical_debt, 1);
  assert.equal(scoped.current_candidate_debt, 0);
  const exported = await exportEvidenceBundle(root, { registry, evidenceIds: [invalidated.id] });
  assert.equal(exported.valid, true);
  assert.deepEqual(exported.invalidated_evidence_ids, [invalidated.id]);
  assert.equal(exported.bundle.entries[0].invalidation_reason, invalidated.invalidation_reason);
  assert.equal(exported.bundle.entries.length, 1);
  assert.equal(exported.acceptance_granted, false);
});

test("V11: self-consistent archive integrity does not authenticate its claimed source; available Git bytes detect contradiction", async t => {
  const { root, entry, registry } = await fixture(t);
  const { bundle } = await exportEvidenceBundle(root, { registry, evidenceIds: [entry.id] });
  const forged = structuredClone(bundle);
  const bytes = Buffer.from([1, 1, 1, 1, 1]);
  forged.artifacts[0].content_base64 = bytes.toString("base64");
  forged.artifacts[0].sha256 = sha256(bytes);
  forged.entries[0].artifacts[0].sha256 = sha256(bytes);
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const { bundle_sha256: _previous, ...body } = forged;
  forged.bundle_sha256 = sha256(JSON.stringify(canonical(body)));
  const withoutSource = await verifyEvidenceBundle(forged);
  assert.equal(withoutSource.valid, true);
  assert.equal(withoutSource.source_authentication, "not-established-by-archive");
  assert.equal(withoutSource.acceptance_granted, false);
  const againstGit = await verifyEvidenceBundle(forged, { target: root });
  assert.equal(againstGit.valid, false);
  assert.match(againstGit.errors[0], /contradicts available original Git source/);
});

async function delayedFixture(t) {
  const value = await fixture(t);
  const bytes = Buffer.from("A report written after the tested candidate\n");
  const entry = { ...value.entry, invalidated_at: "2026-09-25T00:00:00Z", outcome: "failed",
    invalidation_reason: "Keep the failed attempt", artifacts: [{ path: "report.md", sha256: sha256(bytes), size_bytes: bytes.length }] };
  // Squash delivery can leave tested and artifact commits on different branches.
  value.git("checkout", "--orphan", "squashed-delivery");
  value.git("rm", "--cached", "-rf", ".");
  await fs.writeFile(path.join(value.root, "report.md"), bytes);
  value.git("add", "report.md"); value.git("commit", "-qm", "report delivery");
  const request = { sources: [{ evidence_id: entry.id, path: "report.md", source_revision: value.git("rev-parse", "HEAD") }] };
  await fs.mkdir(path.join(value.root, ".ai-org/project"), { recursive: true });
  const registryText = JSON.stringify({ entries: [entry] }, null, 2);
  await fs.writeFile(path.join(value.root, ".ai-org/project/evidence.json"), registryText);
  return { ...value, entry, bytes, request, registryText, registry: { entries: [entry] } };
}

const canonicalValue = value => Array.isArray(value) ? value.map(canonicalValue) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])])) : value;
function resign(value, key) {
  const { [key]: _old, ...body } = value;
  value[key] = sha256(JSON.stringify(canonicalValue(body)));
  return value;
}

test("explicit sources recover delayed squash reports without rewriting registry, tested scope or failed state", async t => {
  const { root, entry, bytes, request, registryText } = await delayedFixture(t);
  assert.equal((await exportEvidenceBundle(root, { evidenceIds: [entry.id] })).valid, false);
  const recorded = await recordEvidenceSources(root, request);
  assert.equal(recorded.valid, true, recorded.errors.join(";"));
  assert.equal(recorded.registry_mutated, false);
  assert.equal(recorded.acceptance_granted, false);
  assert.equal((await recordEvidenceSources(root, request)).already_present, true);
  const options = { evidenceIds: [entry.id], sourceMapPath: recorded.source_map_path };
  assert.equal((await inspectEvidenceDurability(root, options)).valid, true);
  const exported = await exportEvidenceBundle(root, options);
  assert.equal(exported.valid, true, exported.errors.join(";"));
  assert.equal(exported.bundle.schema_version, "temple.evidence-bundle/v2");
  assert.deepEqual(exported.bundle.entries, [entry]);
  assert.equal(exported.source_relationships[0].tested_revision_is_ancestor, false);
  assert.equal(exported.bundle.artifacts[0].scope_revision, entry.scope_revision);
  assert.equal(exported.bundle.artifacts[0].source_revision, request.sources[0].source_revision);
  assert.deepEqual(exported.invalidated_evidence_ids, [entry.id]);
  assert.equal(await fs.readFile(path.join(root, ".ai-org/project/evidence.json"), "utf8"), registryText);
  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), "temple-mapped-portable-"));
  t.after(() => fs.rm(fresh, { recursive: true, force: true }));
  const imported = await importEvidenceBundle(fresh, exported.bundle);
  assert.equal(imported.valid, true);
  assert.equal(imported.original_revision_availability[0].available, false);
  assert.equal(imported.artifact_source_revision_availability[0].available, false);
  assert.equal(imported.source_relationships[0].tested_revision_is_ancestor, null);
  assert.equal(imported.source_authentication, "not-established-by-archive");
  assert.equal(imported.acceptance_granted, false);
  assert.deepEqual((await retrieveEvidenceBundleArtifact(exported.bundle, { target: fresh, evidenceId: entry.id, path: "report.md" })).bytes, bytes);
});

test("source recording rejects absent/wrong/symlink sources, unknown paths, overrides and limits before writing", async t => {
  const { root, entry, request, git, registry } = await delayedFixture(t);
  const wrong = structuredClone(request); wrong.sources[0].source_revision = "f".repeat(40);
  const invalid = [wrong, { sources: [...request.sources, ...request.sources] }, { sources: [] },
    { sources: [{ ...request.sources[0], path: "../report.md" }] },
    { sources: [{ ...request.sources[0], source_revision: "HEAD" }] },
    { sources: [{ ...request.sources[0], accepted: true }] }];
  for (const input of invalid) assert.equal((await recordEvidenceSources(root, input)).valid, false);
  assert.equal((await recordEvidenceSources(root, request, { maxArtifactBytes: 2 })).valid, false);
  assert.equal((await recordEvidenceSources(root, request, { maxTotalBytes: 2 })).valid, false);
  await fs.writeFile(path.join(root, "report.md"), "incorrect bytes");
  git("add", "report.md"); git("commit", "-qm", "wrong report");
  assert.equal((await recordEvidenceSources(root, { sources: [{ ...request.sources[0], source_revision: git("rev-parse", "HEAD") }] })).valid, false);
  await fs.rm(path.join(root, "report.md")); await fs.symlink("binary.dat", path.join(root, "report.md"));
  git("add", "report.md"); git("commit", "-qm", "symlink report");
  assert.equal((await recordEvidenceSources(root, { sources: [{ ...request.sources[0], source_revision: git("rev-parse", "HEAD") }] })).valid, false);
  const override = { ...entry, scope_revision: request.sources[0].source_revision };
  assert.match((await recordEvidenceSources(root, { sources: [{ ...request.sources[0], source_revision: git("rev-parse", "HEAD") }] },
    { registry: { entries: [override] } })).errors[0], /cannot override/);
  await assert.rejects(fs.access(path.join(root, ".ai-org/artifacts/evidence-sources")), { code: "ENOENT" });
  await fs.mkdir(path.join(root, ".ai-org/artifacts"), { recursive: true });
  await fs.symlink(os.tmpdir(), path.join(root, ".ai-org/artifacts/evidence-sources"));
  assert.equal((await recordEvidenceSources(root, request, { registry })).valid, false);
});

test("source map bindings fail closed on stale metadata, divergent artifacts and rehashed structural tampering", async t => {
  const { root, request, entry } = await delayedFixture(t);
  const { source_map: map } = await recordEvidenceSources(root, request);
  const { bundle } = await exportEvidenceBundle(root, { evidenceIds: [entry.id], sourceMap: map });
  const mutations = [
    b => { b.entries[0].invalidated_at = null; },
    b => { b.artifacts[0].source_revision = b.artifacts[0].scope_revision; },
    b => { delete b.source_map; },
    b => { b.source_map.sources.push(structuredClone(b.source_map.sources[0])); },
    b => { b.source_map.sources[0].path = "../escaped"; },
    b => { b.source_map.sources[0].evidence_id = "unknown"; },
    b => { b.source_map.sources[0].scope_revision = "a".repeat(40); },
    b => { b.source_map.acceptance_granted = true; }
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(bundle); mutate(bad);
    if (bad.source_map) resign(bad.source_map, "sources_sha256");
    resign(bad, "bundle_sha256");
    assert.equal((await verifyEvidenceBundle(bad, { target: root })).valid, false);
    assert.equal((await importEvidenceBundle(root, bad)).mutation_performed, false);
  }
  const stale = { ...entry, outcome: "passed" };
  assert.equal((await exportEvidenceBundle(root, { registry: { entries: [stale] }, evidenceIds: [entry.id], sourceMap: map })).valid, false);
});

test("v1 cannot opt into mapped retrieval through ignored extra fields", async t => {
  const { root, registry, entry } = await fixture(t);
  const { bundle } = await exportEvidenceBundle(root, { registry, evidenceIds: [entry.id] });
  for (const artifact of bundle.artifacts) artifact.source_revision = "f".repeat(40);
  resign(bundle, "bundle_sha256");
  const result = await verifyEvidenceBundle(bundle, { target: root });
  assert.equal(result.valid, true);
  assert.deepEqual(result.artifact_source_revision_availability, [{ revision: entry.scope_revision, available: true }]);
});

test("source map files and manifest destinations reject symlinks, collisions and annotated tag objects", async t => {
  const { root, request, entry, git } = await delayedFixture(t);
  const result = await recordEvidenceSources(root, request);
  const exported = await exportEvidenceBundle(root, { evidenceIds: [entry.id], sourceMap: result.source_map });
  git("tag", "-a", "source-tag", "-m", "tag");
  const tag = git("rev-parse", "source-tag");
  const bad = structuredClone(exported.bundle);
  bad.source_map.sources[0].source_revision = tag; bad.artifacts[0].source_revision = tag;
  resign(bad.source_map, "sources_sha256"); resign(bad, "bundle_sha256");
  assert.equal((await verifyEvidenceBundle(bad, { target: root })).valid, false);
  await fs.symlink(result.source_map_path, path.join(root, "map-link.json"));
  assert.equal((await exportEvidenceBundle(root, { evidenceIds: [entry.id], sourceMapPath: "map-link.json" })).valid, false);
  await fs.writeFile(path.join(root, result.source_map_path), "{}");
  const replay = await recordEvidenceSources(root, request);
  assert.equal(replay.valid, false);
  assert.match(replay.errors[0], /Conflicting/);
});

test("CLI records, replays, inspects and exports explicit source maps", async t => {
  const { root, request, entry, registryText } = await delayedFixture(t);
  await fs.writeFile(path.join(root, "request.json"), JSON.stringify(request));
  const run = (...args) => {
    const result = spawnSync(process.execPath, [new URL("../bin/temple.mjs", import.meta.url).pathname, "evidence", args[0], root, ...args.slice(1), "--json"], { encoding: "utf8", cwd: root });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return JSON.parse(result.stdout);
  };
  const recorded = run("record-sources", "--source", "request.json");
  assert.equal(recorded.valid, true);
  assert.equal(run("record-sources", "--source", "request.json").already_present, true);
  assert.equal(run("durability", "--work-item", "WI-0001", "--source-map", recorded.source_map_path).valid, true);
  const exported = run("export-bundle", "--evidence", entry.id, "--source-map", recorded.source_map_path, "--output", "export.json");
  assert.equal(exported.bundle.schema_version, "temple.evidence-bundle/v2");
  assert.equal(run("verify-bundle", "--bundle", "export.json").valid, true);
  assert.equal(run("import-bundle", "--bundle", "export.json").registry_mutated, false);
  assert.equal(await fs.readFile(path.join(root, ".ai-org/project/evidence.json"), "utf8"), registryText);
});
