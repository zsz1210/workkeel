import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { cachedFixture as fixture, cli, canonicalBytes, deliveryArgs } from "./helpers/lean-delivery-fixture.mjs";
import { PACKET_SOURCE_LIMIT } from "../src/context-packet.mjs";

async function setup(t) { const f = await fixture(); t.after(f.cleanup); return f; }
const args = f => ["context", "packet", f.target, "--work-item", f.item.id, "--position", "developer", "--no-write", "--json"];
function packet(f, extra = []) {
  const result = cli([...args(f), ...extra], { allowFailure: true });
  return { result, value: JSON.parse(result.stdout) };
}

for (const referenceKind of ["context-route", "specification"]) {
  test(`stage material preserves whole authority sources independently required by ${referenceKind}`, async t => {
    const f = await setup(t);
    const paths = ["temple.lock", ".ai-org/core/positions.json"];
    const itemFile = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`);
    const item = JSON.parse(await fs.readFile(itemFile));
    if (referenceKind === "context-route") {
      const mapFile = path.join(f.target, ".ai-org/project/context-map.json");
      const map = JSON.parse(await fs.readFile(mapFile));
      map.routes.push({ id: "full-inventories", kind: "documentation", title: "Whole inventories",
        summary: "Read complete inventory sources", paths, tags: [], positions: ["developer"],
        work_items: [f.item.id], read_when: ["Need source records"], owner_position: "developer", status: "active" });
      item.context_refs = ["full-inventories"];
      await fs.writeFile(mapFile, JSON.stringify(map));
    } else {
      const indexFile = path.join(f.target, ".ai-org/project/spec-index.json");
      const index = JSON.parse(await fs.readFile(indexFile));
      for (const [offset, location] of paths.entries()) {
        const id = `SPEC-000${offset + 1}`;
        const content_sha256 = createHash("sha256").update(await fs.readFile(path.join(f.target, location))).digest("hex");
        index.entries.push({ id, kind: "feature_spec", title: "Complete inventory contract",
          authority: "temple_native", status: "approved", revision: "rev-1",
          source: { kind: "repository", location, system: "git", content_sha256 },
          owner_position: "product_manager", approved_by: "human", approved_at: "2026-08-29T00:00:00.000Z",
          approval_ref: "docs/brief.md", source_refs: [], related_work_items: [f.item.id], updated_at: "2026-08-29T00:00:00.000Z" });
        item.spec_refs.push({ id, revision: "rev-1" });
      }
      item.specification_mode = "indexed";
      await fs.writeFile(indexFile, JSON.stringify(index));
    }
    await fs.writeFile(itemFile, JSON.stringify(item));
    const before = await canonicalBytes(f);
    const { result, value } = packet(f, ["--material", "stage"]);
    assert.equal(result.status, 0, JSON.stringify(value.problems ?? value));
    assert.equal(value.acquisition, "complete");
    for (const relative of paths) {
      const source = value.sources.find(row => row.path === relative);
      assert.ok(source.reasons.includes(referenceKind));
      assert.equal(source.representation, "whole-source");
      assert.equal(source.representation_reason, "independently-required-whole-source");
      assert.equal(source.body, await fs.readFile(path.join(f.target, relative), "utf8"));
    }
    assert.deepEqual(await canonicalBytes(f), before);
  });
}

test("cold stage acquisition deduplicates whole sources, binds provenance and leaves all canonical bytes unchanged", async t => {
  const f = await setup(t);
  const before = await canonicalBytes(f);
  const { result, value } = packet(f);
  assert.equal(result.status, 0, JSON.stringify(value.problems));
  assert.equal(value.acquisition, "complete");
  assert.equal(value.coverage.mutation_authorized, false);
  assert.equal(value.coverage.instruction_loading_verified, false);
  assert.equal(value.coverage.required_reads_waived, false);
  assert.equal(value.coverage.semantic_completeness, "not-asserted");
  const paths = value.sources.map(source => source.path);
  assert.equal(new Set(paths).size, paths.length);
  for (const required of ["AGENTS.md", "TEMPLE.md", "docs/brief.md", ".agents/skills/temple-work/SKILL.md", ".agents/skills/temple-work/references/lean-delivery.md"]) assert.ok(paths.includes(required), required);
  assert.equal(value.sources.find(source => source.path === "docs/brief.md").reasons.filter(reason => reason.startsWith("gate:")).length, 6);
  for (const source of value.sources) {
    const bytes = await fs.readFile(path.join(f.target, source.path));
    assert.equal(source.body, bytes.toString("utf8"));
    assert.equal(source.bytes, bytes.length);
    assert.equal(source.sha256, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  }
  assert.deepEqual(await canonicalBytes(f), before);
  assert.equal(packet(f, ["--expected-plan", value.packet_digest]).value.packet_digest, value.packet_digest);
  const full = JSON.parse(cli(["context", "resolve", f.target, "--work-item", f.item.id, "--no-write", "--json"]).stdout);
  assert.equal(full.schema_version, "temple.context-capsule/v2");
  assert.equal(full.source_manifest.source_bodies_retained, false);
  assert.equal(JSON.stringify(full).includes('"body":'), false);
});

test("root-level gate evidence is acquired whole and deduplicated like nested evidence", async t => {
  const f = await setup(t);
  const file = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`);
  const item = JSON.parse(await fs.readFile(file));
  const body = "# Root evidence\nValid local artifact at repository root.\n";
  await fs.writeFile(path.join(f.target, "root-evidence.md"), body);
  item.gate_evidence.approved_scope = ["root-evidence.md"];
  item.gate_evidence.acceptance_criteria = ["root-evidence.md"];
  await fs.writeFile(file, JSON.stringify(item));
  const before = await canonicalBytes(f);
  const { result, value } = packet(f);
  assert.equal(result.status, 0, JSON.stringify(value.problems));
  const sources = value.sources.filter(source => source.path === "root-evidence.md");
  assert.equal(sources.length, 1);
  assert.equal(sources[0].body, body);
  assert.deepEqual(sources[0].reasons, ["gate:acceptance_criteria", "gate:approved_scope"]);
  assert.deepEqual(await canonicalBytes(f), before);
});

test("fresh Verifier receives exact candidate, latest handoff and its own stage procedure", async t => {
  const f = await setup(t);
  const old = packet(f).value.packet_digest;
  cli(deliveryArgs(f));
  const result = cli(args(f).map(value => value === "developer" ? "quality_evaluator" : value));
  const value = JSON.parse(result.stdout);
  assert.equal(value.entry.candidate.developer_revision, f.request.revision);
  assert.equal(value.entry.responsibility.recorded_agent.id, f.qualityAgent);
  assert.ok(value.sources.some(source => source.path === value.entry.candidate.handoff.artifact));
  assert.ok(value.sources.some(source => source.path.endsWith("assurance-and-recovery.md")));
  assert.equal(value.sources.some(source => source.path.endsWith("lean-delivery.md")), false);
  assert.notEqual(value.packet_digest, old);
  const wrong = packet(f);
  assert.equal(wrong.result.status, 1);
  assert.ok(wrong.value.problems.some(problem => problem.code === "wrong-stage-owner"));
  assert.deepEqual(wrong.value.sources, []);
});

test("stale source or authority bindings reject the old digest without emitting bodies or mutating", async t => {
  const f = await setup(t);
  for (const file of ["docs/brief.md", "AGENTS.md", ".ai-org/project/usage-policy.json"]) {
    const old = packet(f).value.packet_digest;
    await fs.appendFile(path.join(f.target, file), "\n ");
    const before = await canonicalBytes(f);
    const stale = packet(f, ["--expected-plan", old]);
    assert.equal(stale.result.status, 1);
    assert.equal(stale.value.code, "STALE_PREVIEW");
    assert.equal(stale.value.mutation_status, "not_started");
    assert.equal(stale.value.sources, undefined);
    assert.deepEqual(await canonicalBytes(f), before);
  }
});

test("missing and hostile source paths fail closed without leaking content", async t => {
  const f = await setup(t);
  const brief = path.join(f.target, "docs/brief.md");
  await fs.unlink(brief);
  const missing = packet(f);
  assert.equal(missing.result.status, 1);
  assert.deepEqual(missing.value.sources, []);
  assert.ok(missing.value.binding.sources.some(source => source.path === "docs/brief.md" && source.reason === "missing-source"));
  const secret = path.join(f.temporary, "outside.txt");
  await fs.writeFile(secret, "outside-sentinel-must-not-appear");
  await fs.symlink(secret, brief);
  const unsafe = packet(f);
  assert.equal(unsafe.result.status, 1);
  assert.equal(unsafe.result.stdout.includes("outside-sentinel-must-not-appear"), false);
  assert.ok(unsafe.value.binding.sources.some(source => source.reason === "non-regular-path"));
});

test("non-text and oversized sources are explicit unavailable inputs, never truncated successes", async t => {
  const f = await setup(t);
  for (const bytes of [Buffer.from([0xff, 0xfe]), Buffer.from("contains\0binary"), Buffer.alloc(PACKET_SOURCE_LIMIT + 1, 65)]) {
    await fs.writeFile(path.join(f.target, "docs/brief.md"), bytes);
    const value = packet(f);
    assert.equal(value.result.status, 1);
    assert.equal(value.value.acquisition, "incomplete");
    assert.deepEqual(value.value.sources, []);
    assert.ok(value.value.binding.sources.some(source => source.path === "docs/brief.md" && source.status === "unavailable"));
  }
});

test("unsafe gate references and unresolved Evidence IDs cannot count as acquired evidence", async t => {
  const f = await setup(t);
  const file = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`);
  const item = JSON.parse(await fs.readFile(file));
  item.gate_evidence.extra = ["../outside.txt", ".git/config", "EVID-9999"];
  await fs.writeFile(file, JSON.stringify(item));
  const before = await canonicalBytes(f);
  const value = packet(f);
  assert.equal(value.result.status, 1);
  assert.deepEqual(value.value.sources, []);
  assert.ok(value.value.problems.some(problem => problem.code === "unresolved-evidence-reference" && problem.source === "EVID-9999"));
  assert.deepEqual(await canonicalBytes(f), before);
});

test("unsupported profile, missing contract and resolver warnings remain incomplete", async t => {
  const f = await setup(t);
  const file = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`);
  const item = JSON.parse(await fs.readFile(file));
  item.risk_tier = "standard";
  item.acceptance_criteria = [];
  item.unresolved = ["Unresolved scope fixture"];
  await fs.writeFile(file, JSON.stringify(item));
  const value = packet(f);
  assert.equal(value.result.status, 1);
  for (const code of ["unsupported-stage-or-profile", "missing-task-contract", "unresolved-work"]) {
    assert.ok(value.value.problems.some(problem => problem.code === code), code);
  }
  assert.deepEqual(value.value.sources, []);
});

test("packet CLI rejects writes, duplicates, missing identity and unsupported selectors before acquisition", async t => {
  const f = await setup(t);
  const before = await canonicalBytes(f);
  const cases = [args(f).filter(arg => arg !== "--no-write"), [...args(f), "--stage", "test"], [...args(f), "--compact"], [...args(f), "--force"], [...args(f), "--position", "developer"], [...args(f), "--expected-plan", "bad"]];
  const withoutPosition = args(f); withoutPosition.splice(withoutPosition.indexOf("--position"), 2); cases.push(withoutPosition);
  for (const argv of cases) {
    const result = cli(argv, { allowFailure: true });
    assert.equal(result.status, 1);
    const value = JSON.parse(result.stdout);
    assert.equal(value.code, "INVALID_INPUT");
    assert.equal(value.mutation_status, "not_started");
    assert.deepEqual(await canonicalBytes(f), before);
  }
});

test("stage mode reduces same-snapshot output while preserving whole rules and distinct original/emitted hashes", async t => {
  const f = await setup(t);
  const before = await canonicalBytes(f);
  const fullRun = packet(f);
  const full = fullRun.value;
  assert.deepEqual(packet(f, ["--material", "full"]).value, full);
  const stage = packet(f, ["--material", "stage"]);
  assert.equal(stage.result.status, 0, JSON.stringify(stage.value.problems));
  assert.equal(stage.value.schema_version, "temple.context-packet/v2");
  assert.equal(stage.value.measurements.projected_source_count, 2);
  assert.ok(stage.value.measurements.emitted_source_bytes < full.measurements.emitted_source_bytes);
  assert.ok(Buffer.byteLength(JSON.stringify(stage.value)) < Buffer.byteLength(JSON.stringify(full)));
  assert.ok(stage.result.output_bytes < fullRun.result.output_bytes, "actual formatted CLI response must be smaller");
  assert.equal(stage.value.measurements.acquired_source_bytes, full.measurements.acquired_source_bytes);
  for (const source of stage.value.sources) {
    const original = full.sources.find(row => row.path === source.path);
    assert.equal(source.source_sha256, original.sha256);
    assert.equal(source.source_bytes, original.bytes);
    assert.equal(source.body_bytes, Buffer.byteLength(source.body));
    assert.equal(source.body_sha256, `sha256:${createHash("sha256").update(source.body).digest("hex")}`);
    if (!["temple.lock", ".ai-org/core/positions.json"].includes(source.path)) {
      assert.equal(source.representation, "whole-source");
      assert.equal(source.body, original.body, source.path);
    }
  }
  const positions = stage.value.sources.find(row => row.path === ".ai-org/core/positions.json");
  const originalPositions = JSON.parse(full.sources.find(row => row.path === positions.path).body).positions;
  const retained = JSON.parse(positions.body).positions;
  assert.deepEqual(retained.map(row => row.id).sort(), ["developer", "quality_evaluator"]);
  for (const row of retained) assert.deepEqual(row, originalPositions.find(original => original.id === row.id));
  const lock = stage.value.sources.find(row => row.path === "temple.lock");
  const raw = JSON.parse(full.sources.find(row => row.path === "temple.lock").body);
  const projected = JSON.parse(lock.body);
  assert.deepEqual({...projected, managed_files:raw.managed_files}, raw);
  for (const observation of lock.selection.observations) assert.deepEqual(observation.exact_managed_entry, raw.managed_files.find(row => row.path === observation.path) ?? null);
  assert.equal(stage.value.coverage.required_reads_waived, false);
  assert.equal(stage.value.coverage.mutation_authorized, false);
  assert.deepEqual(await canonicalBytes(f), before);
});

test("material mode and omitted inventory changes participate in stale binding", async t => {
  const f = await setup(t);
  const full = packet(f).value;
  const stage = packet(f, ["--material", "stage"]).value;
  assert.notEqual(full.packet_digest, stage.packet_digest);
  assert.equal(packet(f, ["--material", "stage", "--expected-plan", full.packet_digest]).value.code, "STALE_PREVIEW");
  assert.equal(packet(f, ["--expected-plan", stage.packet_digest]).value.code, "STALE_PREVIEW");
  assert.equal(packet(f, ["--material", "stage", "--expected-plan", stage.packet_digest]).result.status, 0);
  const lockPath = path.join(f.target, "temple.lock");
  const lock = JSON.parse(await fs.readFile(lockPath));
  lock.managed_files.push({path:"unrelated-managed-file.md",sha256:"a".repeat(64)});
  await fs.writeFile(lockPath, JSON.stringify(lock));
  const stale = packet(f, ["--material", "stage", "--expected-plan", stage.packet_digest]);
  assert.equal(stale.result.status, 1);
  assert.equal(stale.value.code, "STALE_PREVIEW");
  assert.equal(stale.value.sources, undefined);
});

test("unknown structured fields and recovery preserve whole source bodies", async t => {
  const f = await setup(t);
  const recovery = packet(f, ["--material", "stage", "--purpose", "recovery"]).value;
  assert.equal(recovery.measurements.projected_source_count, 0);
  const lockPath = path.join(f.target, "temple.lock");
  const originalLock = await fs.readFile(lockPath, "utf8");
  const malformedLock = JSON.parse(originalLock);
  malformedLock.boundaries = [];
  await fs.writeFile(lockPath, JSON.stringify(malformedLock));
  const malformed = packet(f, ["--material", "stage"]);
  assert.equal(malformed.result.status, 0);
  assert.equal(malformed.value.sources.find(source => source.path === "temple.lock").representation_reason, "unknown-source-shape");
  await fs.writeFile(lockPath, originalLock);
  for (const file of ["temple.lock", ".ai-org/core/positions.json"]) {
    const absolute = path.join(f.target, file);
    const document = JSON.parse(await fs.readFile(absolute));
    document.custom_restriction = "Never drop this project extension";
    await fs.writeFile(absolute, JSON.stringify(document));
    const result = packet(f, ["--material", "stage"]);
    assert.equal(result.result.status, 0, JSON.stringify(result.value.problems));
    const source = result.value.sources.find(row => row.path === file);
    assert.equal(source.representation, "whole-source");
    assert.equal(source.representation_reason, "unknown-source-shape");
    assert.equal(source.body, await fs.readFile(absolute, "utf8"));
  }
});

test("explicit gate references and ambiguous affected scopes retain full inventories", async t => {
  const f = await setup(t);
  const itemPath = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`);
  const item = JSON.parse(await fs.readFile(itemPath));
  item.gate_evidence.extra = ["temple.lock", ".ai-org/core/positions.json"];
  await fs.writeFile(itemPath, JSON.stringify(item));
  const explicit = packet(f, ["--material", "stage"]).value;
  for (const file of item.gate_evidence.extra) assert.equal(explicit.sources.find(row => row.path === file).representation_reason, "independently-required-whole-source");
  delete item.gate_evidence.extra;
  for (const scope of [["docs"], ["*.mjs"], ["new-file.mjs"], ["../outside"]]) {
    item.affected_paths = scope;
    await fs.writeFile(itemPath, JSON.stringify(item));
    const result = packet(f, ["--material", "stage"]);
    assert.equal(result.result.status, 0, JSON.stringify(result.value.problems));
    assert.equal(result.value.measurements.projected_source_count, 0);
    assert.ok(result.value.sources.some(row => row.representation_reason === "ambiguous-stage-scope"));
  }
});

test("fresh Verifier stage retains current, handoff and next-owner Position restrictions", async t => {
  const f = await setup(t);
  cli(deliveryArgs(f));
  const argv = args(f).map(arg => arg === "developer" ? "quality_evaluator" : arg);
  const fullRun = cli(argv);
  const stageRun = cli([...argv,"--material","stage"]);
  const full = JSON.parse(fullRun.stdout);
  const stage = JSON.parse(stageRun.stdout);
  const positions = JSON.parse(stage.sources.find(source => source.path === ".ai-org/core/positions.json").body).positions;
  assert.deepEqual(positions.map(row => row.id).sort(), ["developer", "engineering_manager", "quality_evaluator"]);
  const original = JSON.parse(full.sources.find(source => source.path === ".ai-org/core/positions.json").body).positions;
  for (const row of positions) assert.deepEqual(row, original.find(entry => entry.id === row.id));
  const handoff = stage.sources.find(source => source.path === stage.entry.candidate.handoff.artifact);
  assert.equal(handoff.representation, "whole-source");
  assert.equal(handoff.body, full.sources.find(source => source.path === handoff.path).body);
  assert.ok(Buffer.byteLength(JSON.stringify(stage)) < Buffer.byteLength(JSON.stringify(full)));
  assert.ok(stageRun.output_bytes < fullRun.output_bytes, "actual formatted Verifier response must be smaller");
  const representations = stage.sources.map(({path:sourcePath,representation,representation_reason,body_sha256,selection}) =>
    ({path:sourcePath,representation,representation_reason,body_sha256,selection}));
  assert.equal(stage.binding.representation_digest,createHash("sha256").update(JSON.stringify(representations)).digest("hex"));
});

test("stage mode retains acquisition failures and rejects invalid or duplicated material options", async t => {
  const f = await setup(t);
  for (const extra of [["--material","automatic"],["--material","stage","--material","full"]]) {
    const result=packet(f,extra);
    assert.equal(result.result.status,1);
    assert.equal(result.value.code,"INVALID_INPUT");
  }
  await fs.unlink(path.join(f.target,"docs/brief.md"));
  const full=packet(f).value;
  const stage=packet(f,["--material","stage"]);
  assert.equal(stage.result.status,1);
  assert.deepEqual(stage.value.sources,[]);
  assert.deepEqual(stage.value.problems,full.problems);
});

test("allowed roots do not imply exact ownership and custom inventory/Position records fall back whole", async t => {
  const f = await setup(t);
  const itemPath = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`);
  const item = JSON.parse(await fs.readFile(itemPath));
  const relative = ".ai-org/core/project-owned.json";
  await fs.writeFile(path.join(f.target, relative), "{}\n");
  item.affected_paths = [relative];
  await fs.writeFile(itemPath, JSON.stringify(item));
  let stage = packet(f, ["--material", "stage"]).value;
  let lock = stage.sources.find(source => source.path === "temple.lock");
  assert.equal(lock.selection.observations.find(row => row.path === relative).exact_managed_entry, null);
  assert.ok(lock.selection.observations.some(row => row.exact_managed_entry !== null));
  for (const [file, list] of [["temple.lock", "managed_files"], [".ai-org/core/positions.json", "positions"]]) {
    const absolute = path.join(f.target, file);
    const document = JSON.parse(await fs.readFile(absolute));
    document[list][0].custom_rule = "Preserve this unknown extension";
    await fs.writeFile(absolute, JSON.stringify(document));
    stage = packet(f, ["--material", "stage"]).value;
    const source = stage.sources.find(row => row.path === file);
    assert.equal(source.representation_reason, "unknown-source-shape");
    assert.equal(source.body, await fs.readFile(absolute, "utf8"));
  }
});
