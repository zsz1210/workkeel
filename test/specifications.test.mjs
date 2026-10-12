import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SPEC_INDEX_RELATIVE_PATH,
  emptySpecIndex,
  ensureSpecIndex,
  evaluateWorkItemSpecRefs,
  readSpecIndex,
  summarizeSpecIndex,
  validateRepositorySpecSources,
  validateSpecIndex
} from "../src/specifications.mjs";

const positions = ["product_manager", "ux_designer", "ui_designer", "tech_lead"];

function entry(overrides = {}) {
  return {
    id: "SPEC-0001",
    kind: "feature_spec",
    title: "Specification registry",
    authority: "temple_native",
    status: "approved",
    revision: "rev-1",
    source: {
      kind: "repository",
      location: "docs/specifications/registry.md",
      system: "git",
      content_sha256: "a".repeat(64)
    },
    owner_position: "product_manager",
    approved_by: "human",
    approved_at: "2026-08-29T00:00:00.000Z",
    approval_ref: ".ai-org/decisions/SPEC-0001-approval.md",
    source_refs: [],
    related_work_items: ["WI-0001"],
    updated_at: "2026-08-29T00:00:00.000Z",
    ...overrides
  };
}

function index(entries, adoptionProfile = "hybrid") {
  return {
    ...emptySpecIndex(),
    adoption_profile: adoptionProfile,
    entries
  };
}

function emptyWorkItem(overrides = {}) {
  return {
    spec_refs: [],
    ux_refs: [],
    ui_refs: [],
    contract_refs: [],
    ...overrides
  };
}

test("empty index creation is exclusive, idempotent, and readable", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-spec-index-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const created = await ensureSpecIndex(temporaryRoot);
  assert.equal(created.path, path.join(temporaryRoot, SPEC_INDEX_RELATIVE_PATH));
  assert.equal(created.created, true);
  assert.match(created.afterHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(await readSpecIndex(temporaryRoot), emptySpecIndex());

  const repeated = await ensureSpecIndex(temporaryRoot);
  assert.equal(repeated.created, false);
  assert.equal(repeated.afterHash, null);
});

test("repository source integrity detects unrevisioned content drift", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-spec-source-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const source = "# Governed specification\n";
  await fs.mkdir(path.join(temporaryRoot, "docs/specifications"), { recursive: true });
  await fs.writeFile(path.join(temporaryRoot, "docs/specifications/registry.md"), source);
  const document = index([
    entry({
      source: {
        kind: "repository",
        location: "docs/specifications/registry.md",
        system: "git",
        content_sha256: crypto.createHash("sha256").update(source).digest("hex")
      }
    })
  ]);
  assert.deepEqual(await validateRepositorySpecSources(temporaryRoot, document), { valid: true, errors: [] });
  await fs.writeFile(path.join(temporaryRoot, "docs/specifications/registry.md"), "changed without revision\n");
  const drifted = await validateRepositorySpecSources(temporaryRoot, document);
  assert.equal(drifted.valid, false);
  assert.match(drifted.errors.join("\n"), /content does not match source\.content_sha256/);
  assert.deepEqual(await validateRepositorySpecSources(temporaryRoot, document, []), { valid: true, errors: [] });
  assert.deepEqual(await validateRepositorySpecSources(temporaryRoot, document, ["SPEC-UNRELATED-1"]), {
    valid: true,
    errors: []
  });
});

test("validates Temple-native, federated, and hybrid specification indexes", () => {
  const internal = index([entry()], "temple-native");
  const externalEntry = entry({
    id: "SPEC-EXT-1",
    authority: "authoritative_external",
    source: { kind: "external", location: "https://example.com/specs/1", system: "Example Docs", content_sha256: null }
  });
  const external = index([externalEntry], "federated");
  const hybrid = index([entry(), externalEntry], "hybrid");

  for (const document of [internal, external, hybrid]) {
    assert.deepEqual(validateSpecIndex(document, positions), { valid: true, errors: [], warnings: [] });
  }

  const summary = summarizeSpecIndex(hybrid);
  assert.equal(summary.total_entries, 2);
  assert.equal(summary.approved_entries, 2);
  assert.equal(summary.by_authority.temple_native, 1);
  assert.equal(summary.by_authority.authoritative_external, 1);
  assert.equal(summary.by_kind.ux_flow, 0);
  assert.equal(summary.by_source_kind.external, 1);
});

test("accepts a repository projection only when it cites a known authority", () => {
  const external = entry({
    id: "SPEC-EXT-1",
    authority: "authoritative_external",
    source: { kind: "external", location: "https://example.com/specs/1", system: "Example Docs", content_sha256: null }
  });
  const projection = entry({
    id: "SPEC-PROJECTION-1",
    title: "Local projection",
    authority: "derived_projection",
    status: "draft",
    source: { kind: "repository", location: "docs/projections/spec-1.md", system: "git", content_sha256: null },
    approved_by: null,
    approved_at: null,
    approval_ref: null,
    source_refs: [{ id: external.id, revision: external.revision }]
  });

  assert.equal(validateSpecIndex(index([external, projection]), positions).valid, true);

  const invalidApproved = validateSpecIndex(index([external, { ...projection, status: "approved" }]), positions);
  assert.equal(invalidApproved.valid, false);
  assert.match(invalidApproved.errors.join("\n"), /derived_projection authority must be draft/);

  const chainedProjection = {
    ...projection,
    id: "SPEC-PROJECTION-2",
    source_refs: [{ id: projection.id, revision: projection.revision }]
  };
  const invalidChain = validateSpecIndex(index([external, projection, chainedProjection]), positions);
  assert.equal(invalidChain.valid, false);
  assert.match(invalidChain.errors.join("\n"), /must cite a canonical authority/);
});

test("rejects duplicate IDs, unknown or self source refs, and unknown owner positions", () => {
  const document = index([
    entry({ source_refs: [{ id: "SPEC-0001", revision: "rev-1" }] }),
    entry({ source_refs: [{ id: "SPEC-MISSING", revision: "rev-1" }], owner_position: "unknown_position" })
  ]);
  const result = validateSpecIndex(document, positions);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /duplicate specification ID/);
  assert.match(result.errors.join("\n"), /cannot reference itself/);
  assert.match(result.errors.join("\n"), /unknown specification/);
  assert.match(result.errors.join("\n"), /owner_position is unknown/);
});

test("rejects unstable specification IDs", () => {
  const document = index([
    entry({ id: "feature checkout", kind: "feature_spec" })
  ]);

  const validation = validateSpecIndex(document, positions);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /stable uppercase specification ID/);
});

test("rejects unknown index, entry, source, and revision-reference properties", () => {
  const document = index([
    entry({
      extra_entry_field: true,
      source: {
        kind: "repository",
        location: "docs/specifications/registry.md",
        system: "git",
        content_sha256: "a".repeat(64),
        extra_source_field: true
      },
      source_refs: [{ id: "SPEC-AUTHORITY", revision: "rev-1", extra_ref_field: true }]
    }),
    entry({ id: "SPEC-AUTHORITY" })
  ]);
  document.extra_index_field = true;
  const validation = validateSpecIndex(document, positions);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /unknown properties/);
});

test("rejects unsafe repository paths, invalid external URLs, and inconsistent authority sources", () => {
  const document = index([
    entry({ id: "SPEC-UNSAFE", source: { kind: "repository", location: "../outside.md", system: "git" } }),
    entry({
      id: "SPEC-BAD-URL",
      authority: "authoritative_external",
      source: { kind: "external", location: "docs.example.com/spec", system: "Example Docs" }
    }),
    entry({
      id: "SPEC-BAD-AUTHORITY",
      authority: "temple_native",
      source: { kind: "external", location: "https://example.com/spec", system: "Example Docs" }
    })
  ]);
  const result = validateSpecIndex(document, positions);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /safe repository-relative path/);
  assert.match(result.errors.join("\n"), /HTTP\(S\) URL/);
  assert.match(result.errors.join("\n"), /temple_native authority requires a repository source/);
});

test("requires traceable approval evidence and never approves legacy-unverified entries", () => {
  const missingApproval = entry({ approved_by: null, approved_at: null, approval_ref: null });
  const legacyApproved = entry({ id: "SPEC-LEGACY", authority: "legacy_unverified" });
  const invalidTimestamp = entry({ id: "SPEC-BAD-TIME", approved_at: "not-a-date" });
  const result = validateSpecIndex(index([missingApproval, legacyApproved, invalidTimestamp]), positions);

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /requires approved_by, approved_at, and approval_ref/);
  assert.match(result.errors.join("\n"), /ISO 8601 UTC timestamp/);
  assert.match(result.errors.join("\n"), /legacy_unverified authority cannot be approved/);
});

test("evaluates current and stale work-item references by category", () => {
  const document = index([
    entry(),
    entry({ id: "UX-0001", kind: "ux_flow", revision: "ux-2", owner_position: "ux_designer" }),
    entry({ id: "UI-0001", kind: "ui_contract", revision: "ui-1", owner_position: "ui_designer" }),
    entry({ id: "API-0001", kind: "api_contract", revision: "api-1", owner_position: "tech_lead" }),
    entry({ id: "TECH-0001", kind: "technical_design", revision: "tech-1", owner_position: "tech_lead" })
  ]);
  const workItem = emptyWorkItem({
    spec_refs: [{ id: "SPEC-0001", revision: "rev-1" }],
    ux_refs: [{ id: "UX-0001", revision: "ux-1" }],
    ui_refs: [{ id: "UI-0001", revision: "ui-1" }],
    contract_refs: [
      { id: "API-0001", revision: "api-1" },
      { id: "TECH-0001", revision: "tech-1" }
    ]
  });
  const result = evaluateWorkItemSpecRefs(workItem, document);

  assert.equal(result.valid, true);
  assert.equal(result.stale_count, 1);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.resolved_refs.length, 5);
  assert.equal(result.resolved_refs.find((ref) => ref.id === "UX-0001").stale, true);
});

test("rejects malformed, unknown, and category-mismatched work-item references", () => {
  const document = index([
    entry(),
    entry({ id: "UX-0001", kind: "ux_flow", owner_position: "ux_designer" })
  ]);
  const workItem = emptyWorkItem({
    spec_refs: [null, { id: "SPEC-MISSING", revision: "rev-1" }, { id: "UX-0001", revision: "rev-1" }]
  });
  const result = evaluateWorkItemSpecRefs(workItem, document);

  assert.equal(result.valid, false);
  assert.equal(result.stale_count, 0);
  assert.match(result.errors.join("\n"), /must contain non-empty id and revision strings/);
  assert.match(result.errors.join("\n"), /unknown specification/);
  assert.match(result.errors.join("\n"), /category does not accept ux_flow/);
});

test("legacy work items may omit reference arrays, while duplicate and derived references are rejected", () => {
  const external = entry({
    id: "SPEC-EXT-1",
    authority: "authoritative_external",
    source: { kind: "external", location: "https://example.com/specs/1", system: "Example Docs", content_sha256: null }
  });
  const projection = entry({
    id: "SPEC-PROJECTION-1",
    authority: "derived_projection",
    status: "draft",
    approved_by: null,
    approved_at: null,
    approval_ref: null,
    source: { kind: "repository", location: "docs/projections/spec-1.md", system: "git", content_sha256: null },
    source_refs: [{ id: external.id, revision: external.revision }]
  });
  assert.equal(evaluateWorkItemSpecRefs({}, index([external, projection])).valid, true);
  const invalid = evaluateWorkItemSpecRefs(
    { spec_refs: [{ id: projection.id, revision: projection.revision }, { id: projection.id, revision: projection.revision }] },
    index([external, projection])
  );
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /derived projection/);
  assert.match(invalid.errors.join("\n"), /duplicate reference/);
});
