import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createLocalHybridRetrievalProvider, createRepositoryRetrievalProvider } from "../src/context.mjs";
import { buildSkillPromotionCandidates, validateSkillProposal } from "../src/learning.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-learning-op-test-"));
  const target = path.join(temporaryRoot, "learning-product");
  const configPath = path.join(temporaryRoot, "init.json");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await fs.writeFile(configPath, `${JSON.stringify({
    schema_version: "temple.init/v1",
    project: { id: "learning-product", name: "Learning Product" },
    naming_mode: "manual",
    agents: [
      { display_name: "Fixture Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Fixture Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Fixture Ellis", positions: ["tech_lead"] },
      { display_name: "Fixture Devon", positions: ["developer"] },
      { display_name: "Fixture Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  }, null, 2)}\n`);
  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  for (const relativePath of ["docs/spec.md", "docs/work-order.md"]) {
    const absolutePath = path.join(target, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `Fixture evidence for ${relativePath}\n`);
  }
  return { target };
}

function createDesignReviewWorkItem(target) {
  const created = run([
    "work-item", "create", target,
    "--title", "Review a Skill promotion candidate",
    "--scope", "Review the evidence-backed candidate without creating a Skill",
    "--acceptance", "A Human Principal can decide the proposal",
    "--affected-path", ".ai-org/learning/proposals/**",
    "--base-revision", "fixture-base",
    "--integration-owner", "agent-fixture-rowan",
    "--ui-mode", "not-applicable"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  for (const [state, evidence] of [
    ["spec", ["work_order=docs/work-order.md"]],
    ["design", ["approved_scope=docs/spec.md", "acceptance_criteria=docs/spec.md"]]
  ]) {
    const args = ["transition", target, "--work-item", "WI-0001", "--to", state];
    for (const entry of evidence) args.push("--satisfy", entry);
    const transitioned = run(args);
    assert.equal(transitioned.status, 0, transitioned.stderr || transitioned.stdout);
  }
  const claimed = run([
    "work-item", "claim", target,
    "--work-item", "WI-0001",
    "--agent-id", "agent-fixture-ellis",
    "--base-revision", "fixture-base",
    "--branch", "fixture/skill-review",
    "--worktree", target
  ]);
  assert.equal(claimed.status, 0, claimed.stderr || claimed.stdout);
}

function addEligiblePractice(target, number) {
  const lessonIds = [];
  for (const source of [`WI-${String(number * 2 - 1).padStart(4, "0")}`, `WI-${String(number * 2).padStart(4, "0")}`]) {
    const added = run([
      "learning", "add-lesson", target,
      "--title", `Recurring procedure evidence ${source}`,
      "--summary", `The bounded procedure worked in ${source}.`,
      "--confidence", "high",
      "--source-work-item", source
    ]);
    assert.equal(added.status, 0, added.stderr || added.stdout);
    lessonIds.push(/Created (LESSON-[0-9]+):/.exec(added.stdout)?.[1]);
  }
  assert.ok(lessonIds.every(Boolean));
  const practice = run([
    "learning", "add-practice", target,
    "--title", `Reusable bounded procedure ${number}`,
    "--summary", "Run the same bounded checks before making the local change.",
    "--confidence", "high",
    "--derived-from", lessonIds[0],
    "--derived-from", lessonIds[1],
    "--owner-position", "tech_lead"
  ]);
  assert.equal(practice.status, 0, practice.stderr || practice.stdout);
  const practiceId = /Created (PRACTICE-[0-9]+):/.exec(practice.stdout)?.[1];
  assert.ok(practiceId);
  const revalidated = run([
    "learning", "revalidate", target,
    "--learning-id", practiceId,
    "--result", "confirmed",
    "--evidence", `.ai-org/artifacts/practice-${number}-validation.md`
  ]);
  assert.equal(revalidated.status, 0, revalidated.stderr || revalidated.stdout);
  return practiceId;
}

test("Skill candidate blockers explain near misses without changing Learning state", () => {
  const index = {
    schema_version: "ai-org.learning-index/v2",
    entries: [
      {
        id: "LESSON-0001",
        kind: "lesson",
        title: "One bounded observation",
        summary: "One case does not establish recurrence.",
        status: "validated",
        confidence: "high",
        tags: [],
        applies_to: [],
        source_work_items: ["WI-0001"],
        path: ".ai-org/learning/lessons/LESSON-0001.md",
        updated_at: "2026-08-31T00:00:00.000Z",
        last_validated_at: "2026-08-31T00:00:00.000Z",
        promotion: { target: "none", status: "none", reference: null },
        derived_from: [],
        owner_position: null,
        revalidation: { last_result: "confirmed", review_after: null, evidence_refs: [], history: [] }
      },
      {
        id: "PRACTICE-0001",
        kind: "practice",
        title: "Near-miss Practice",
        summary: "The procedure is promising but has only one bounded case.",
        status: "active",
        confidence: "high",
        tags: [],
        applies_to: [],
        source_work_items: [],
        path: ".ai-org/learning/practices/PRACTICE-0001.md",
        updated_at: "2026-08-31T00:00:00.000Z",
        last_validated_at: "2026-08-31T00:00:00.000Z",
        promotion: { target: "none", status: "none", reference: null },
        derived_from: ["LESSON-0001"],
        owner_position: "tech_lead",
        revalidation: { last_result: "confirmed", review_after: null, evidence_refs: [], history: [] }
      }
    ]
  };
  const before = JSON.stringify(index);
  const report = buildSkillPromotionCandidates(index, new Date("2026-08-31T12:00:00.000Z"));
  assert.equal(report.summary.eligible, 0);
  assert.deepEqual(report.candidates[0].blockers, ["recurrence-evidence-missing"]);
  assert.equal(JSON.stringify(index), before);

  const malformed = validateSkillProposal({ schema_version: "temple.skill-proposal/v1", id: "unsafe/name" });
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors.includes("id is invalid"));
});

test("learning CLI keeps Markdown, index, and revalidation signals consistent", async (context) => {
  const { target } = await fixture(context);
  const lesson = run([
    "learning", "add-lesson", target,
    "--title", "Bind runtime evidence to a revision",
    "--summary", "Runtime evidence is reusable only when its exact revision is preserved.",
    "--confidence", "medium",
    "--tag", "runtime",
    "--tag", "verification",
    "--applies-to", "independent-qa",
    "--evidence", ".ai-org/artifacts/runtime.json"
  ]);
  assert.equal(lesson.status, 0, lesson.stderr || lesson.stdout);
  assert.match(lesson.stdout, /LESSON-0001/);
  await fs.access(path.join(target, ".ai-org/learning/lessons/LESSON-0001.md"));

  const practice = run([
    "learning", "add-practice", target,
    "--title", "Revision-bound runtime evidence",
    "--summary", "Record an exact revision for every runtime claim.",
    "--confidence", "medium",
    "--tag", "runtime",
    "--applies-to", "quality",
    "--derived-from", "LESSON-0001",
    "--owner-position", "tech_lead"
  ]);
  assert.equal(practice.status, 0, practice.stderr || practice.stdout);
  assert.match(practice.stdout, /PRACTICE-0001/);

  const revalidated = run([
    "learning", "revalidate", target,
    "--learning-id", "PRACTICE-0001",
    "--result", "confirmed",
    "--evidence", ".ai-org/artifacts/second-runtime.json",
    "--review-after", "2020-01-01T00:00:00.000Z"
  ]);
  assert.equal(revalidated.status, 0, revalidated.stderr || revalidated.stdout);
  const listed = run(["learning", "list", target, "--json"]);
  assert.equal(listed.status, 0, listed.stderr || listed.stdout);
  const entries = JSON.parse(listed.stdout).entries;
  const storedPractice = entries.find((entry) => entry.id === "PRACTICE-0001");
  assert.equal(storedPractice.status, "active");
  assert.equal(storedPractice.revalidation.signal, "overdue");
  assert.equal(storedPractice.revalidation.last_result, "confirmed");
  assert.match(await fs.readFile(path.join(target, storedPractice.path), "utf8"), /confirmed/);

  const observer = JSON.parse(run(["observe", target, "--json", "--no-write"]).stdout);
  assert.ok(observer.attention.some((entry) => entry.type === "learning_revalidation_overdue"));
});

test("Skill promotion prepares evidence, requires human decisions, and creates only an authoring Work Item", async (context) => {
  const { target } = await fixture(context);
  createDesignReviewWorkItem(target);
  const practiceId = addEligiblePractice(target, 1);

  const candidates = run(["learning", "skill-candidates", target, "--json"]);
  assert.equal(candidates.status, 0, candidates.stderr || candidates.stdout);
  const candidateReport = JSON.parse(candidates.stdout);
  assert.equal(candidateReport.policy.human_approval_required, true);
  assert.equal(candidateReport.policy.automatic_skill_activation, false);
  assert.equal(candidateReport.summary.eligible, 1);
  assert.deepEqual(candidateReport.candidates[0].source_work_items, ["WI-0001", "WI-0002"]);

  const proposalArgs = [
    "learning", "propose-skill", target,
    "--learning-id", practiceId,
    "--work-item", "WI-0001",
    "--skill-name", "bounded-change-check",
    "--summary", "Check evidence and authority before a bounded repository change.",
    "--trigger", "Use when this recurring local change is requested.",
    "--non-trigger", "Do not use for release, deployment, or external writes.",
    "--authority", "The Skill guides authoring and grants no lifecycle or external-write authority.",
    "--risk-class", "low",
    "--dependency", "Repository-native Temple CLI only.",
    "--alternative", "Keep the active Practice without a Skill.",
    "--overlap-review", "No existing repository Skill has this exact routing boundary.",
    "--json"
  ];
  const proposed = run(proposalArgs);
  assert.equal(proposed.status, 0, proposed.stderr || proposed.stdout);
  const proposal = JSON.parse(proposed.stdout);
  assert.equal(proposal.id, "SKILL-PROPOSAL-0001");
  assert.equal(proposal.status, "proposed");
  await assert.rejects(() => fs.access(path.join(target, ".agents/skills/bounded-change-check/SKILL.md")));
  const duplicateProposal = run(proposalArgs);
  assert.notEqual(duplicateProposal.status, 0);
  assert.match(duplicateProposal.stderr, /not eligible|already reserves/);
  assert.equal((await fs.readdir(path.join(target, ".ai-org/learning/proposals"))).filter((entry) => entry.endsWith(".json")).length, 1);

  const observed = JSON.parse(run(["observe", target, "--json", "--no-write"]).stdout);
  assert.ok(observed.attention.some((entry) => entry.type === "skill_proposal_pending" && entry.proposal_id === proposal.id));
  const writtenObserver = run(["observe", target, "--json"]);
  assert.equal(writtenObserver.status, 0, writtenObserver.stderr || writtenObserver.stdout);
  const renderedObserver = await fs.readFile(path.join(target, ".ai-org/views/overview.html"), "utf8");
  assert.match(renderedObserver, /SKILL-PROPOSAL-0001 awaits a Human Principal decision/);
  assert.match(renderedObserver, /no lifecycle or external-write authority/);

  const reviewAfter = new Date(Date.now() + 86_400_000).toISOString();
  const deferred = run([
    "learning", "decide-skill", target,
    "--proposal-id", proposal.id,
    "--decision", "defer",
    "--principal-id", "human",
    "--reason", "Collect one more review signal.",
    "--review-after", reviewAfter,
    "--json"
  ]);
  assert.equal(deferred.status, 0, deferred.stderr || deferred.stdout);
  assert.equal(JSON.parse(deferred.stdout).authoring_work_item, null);
  assert.equal((await fs.readdir(path.join(target, ".ai-org/work-items"))).filter((entry) => entry.endsWith(".json")).length, 1);

  const approved = run([
    "learning", "decide-skill", target,
    "--proposal-id", proposal.id,
    "--decision", "approve",
    "--principal-id", "human",
    "--reason", "The evidence and authority boundary are sufficient.",
    "--json"
  ]);
  assert.equal(approved.status, 0, approved.stderr || approved.stdout);
  const approvedResult = JSON.parse(approved.stdout);
  assert.equal(approvedResult.proposal.status, "approved");
  assert.equal(approvedResult.authoring_work_item.id, "WI-0002");
  assert.equal(approvedResult.authoring_work_item.parent_work_item_id, "WI-0001");
  assert.equal(approvedResult.authoring_work_item.tracker_visibility, "internal");
  assert.deepEqual(approvedResult.authoring_work_item.evidence, [proposal.path]);
  await assert.rejects(() => fs.access(path.join(target, ".agents/skills/bounded-change-check/SKILL.md")));

  const replayed = run([
    "learning", "decide-skill", target,
    "--proposal-id", proposal.id,
    "--decision", "approve",
    "--principal-id", "human",
    "--reason", "The evidence and authority boundary are sufficient.",
    "--json"
  ]);
  assert.equal(replayed.status, 0, replayed.stderr || replayed.stdout);
  assert.equal(JSON.parse(replayed.stdout).idempotent, true);
  assert.equal((await fs.readdir(path.join(target, ".ai-org/work-items"))).filter((entry) => entry.endsWith(".json")).length, 2);

  const rejectedPractice = addEligiblePractice(target, 2);
  const secondProposalArgs = [
    "learning", "propose-skill", target,
    "--learning-id", rejectedPractice,
    "--work-item", "WI-0001",
    "--skill-name", "rejected-procedure",
    "--summary", "A second bounded procedure.",
    "--trigger", "Use for the second recurring case.",
    "--non-trigger", "Do not use outside its evidence boundary.",
    "--authority", "Guidance only; no lifecycle authority.",
    "--risk-class", "standard",
    "--overlap-review", "No exact overlap found.",
    "--json"
  ];
  const released = run(["work-item", "release", target, "--work-item", "WI-0001", "--reason", "Exercise the proposal authority boundary"]);
  assert.equal(released.status, 0, released.stderr || released.stdout);
  const unclaimedProposal = run(secondProposalArgs);
  assert.notEqual(unclaimedProposal.status, 0);
  assert.match(unclaimedProposal.stderr, /active Tech Lead claim/);
  const reclaimed = run([
    "work-item", "claim", target,
    "--work-item", "WI-0001",
    "--agent-id", "agent-fixture-ellis",
    "--base-revision", "fixture-base",
    "--branch", "fixture/skill-review-reclaimed",
    "--worktree", target
  ]);
  assert.equal(reclaimed.status, 0, reclaimed.stderr || reclaimed.stdout);
  const collisionArgs = [...secondProposalArgs];
  collisionArgs[collisionArgs.indexOf("--skill-name") + 1] = "skill-authoring";
  const collision = run(collisionArgs);
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr, /Skill path already exists/);
  const secondProposal = run(secondProposalArgs);
  assert.equal(secondProposal.status, 0, secondProposal.stderr || secondProposal.stdout);
  const rejected = run([
    "learning", "decide-skill", target,
    "--proposal-id", JSON.parse(secondProposal.stdout).id,
    "--decision", "reject",
    "--principal-id", "human",
    "--reason", "The Practice remains sufficient without a Skill.",
    "--json"
  ]);
  assert.equal(rejected.status, 0, rejected.stderr || rejected.stdout);
  assert.equal(JSON.parse(rejected.stdout).authoring_work_item, null);
  assert.equal((await fs.readdir(path.join(target, ".ai-org/work-items"))).filter((entry) => entry.endsWith(".json")).length, 2);

  const schema = run(["schema", "validate", target, "--json"]);
  assert.equal(schema.status, 0, schema.stderr || schema.stdout);
  assert.ok(JSON.parse(schema.stdout).checked.some((entry) => entry.document === proposal.path && entry.valid));

  const proposalPath = path.join(target, proposal.path);
  const corruptedProposal = JSON.parse(await fs.readFile(proposalPath, "utf8"));
  corruptedProposal.source_learning_id = "PRACTICE-9999";
  await fs.writeFile(proposalPath, `${JSON.stringify(corruptedProposal, null, 2)}\n`);
  const invalidSchema = run(["schema", "validate", target, "--json"]);
  assert.equal(invalidSchema.status, 1);
  assert.match(JSON.stringify(JSON.parse(invalidSchema.stdout).errors), /PRACTICE-9999|not correlated/);
  const invalidObserver = run(["observe", target, "--json", "--no-write"]);
  assert.equal(invalidObserver.status, 0, invalidObserver.stderr || invalidObserver.stdout);
  assert.ok(JSON.parse(invalidObserver.stdout).attention.some((entry) => entry.type === "invalid_skill_promotion"));
});

test("deterministic retrieval evaluation records hit rate and reciprocal rank", async (context) => {
  const { target } = await fixture(context);
  const added = run([
    "learning", "add-lesson", target,
    "--title", "Checkout totals use the public seam",
    "--summary", "Verify checkout totals through the supported public output.",
    "--confidence", "high",
    "--tag", "checkout",
    "--applies-to", "developer"
  ]);
  assert.equal(added.status, 0, added.stderr || added.stdout);
  const validated = run(["learning", "revalidate", target, "--learning-id", "LESSON-0001", "--result", "confirmed"]);
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  const fixturePath = ".ai-org/artifacts/retrieval-evaluation.json";
  await fs.mkdir(path.dirname(path.join(target, fixturePath)), { recursive: true });
  await fs.writeFile(path.join(target, fixturePath), `${JSON.stringify({
    schema_version: "temple.retrieval-evaluation/v1",
    cases: [
      { id: "checkout-learning", kind: "learning", query: "checkout public totals", position: "developer", expected_ids: ["LESSON-0001"], limit: 3 }
    ]
  }, null, 2)}\n`);
  const evaluated = run(["learning", "evaluate", target, "--fixture", fixturePath, "--json", "--no-write"]);
  assert.equal(evaluated.status, 0, evaluated.stderr || evaluated.stdout);
  const report = JSON.parse(evaluated.stdout);
  assert.equal(report.schema_version, "temple.retrieval-evaluation-result/v1");
  assert.equal(report.provider.id, "repository-deterministic");
  assert.equal(report.summary.hit_rate_at_limit, 1);
  assert.equal(report.summary.mean_reciprocal_rank, 1);
  assert.equal(report.external_action_performed, false);
  await assert.rejects(() => fs.access(path.join(target, ".ai-org/views/retrieval-evaluation.json")));
});

test("local hybrid provider preserves provenance and falls back deterministically", async () => {
  const deterministic = createRepositoryRetrievalProvider();
  const documents = [{ id: "route-one", title: "Checkout route", summary: "Public checkout totals", tags: ["checkout"], paths: ["docs/checkout.md"], retrieval_kind: "context-route", status: "active" }];
  const failedSemantic = createLocalHybridRetrievalProvider({
    deterministicProvider: deterministic,
    semanticProvider: {
      id: "local-test-semantic",
      async search() { throw new Error("local model unavailable"); }
    }
  });
  const fallback = await failedSemantic.search({ query: "checkout", documents, pinned_ids: [], limit: 3 });
  assert.equal(fallback[0].id, "route-one");
  assert.equal(fallback[0].provider_provenance.semantic.status, "failed_fallback");
  assert.equal(failedSemantic.semantic, true);
  assert.equal(failedSemantic.privacy, "local-only");
  assert.equal(failedSemantic.installs_runtime, false);
});

test("local hybrid provider accepts semantic ranking only for canonical repository documents", async () => {
  const documents = [{ id: "route-one", title: "Checkout route", summary: "Canonical public checkout totals", tags: ["checkout"], paths: ["docs/checkout.md"], retrieval_kind: "context-route", status: "active" }];
  const hybrid = createLocalHybridRetrievalProvider({
    semanticProvider: {
      id: "local-test-semantic",
      async search() {
        return [
          { id: "unknown-document", source: { paths: ["../../outside"] } },
          { id: "route-one", kind: "poisoned", source: { paths: ["../../outside"], summary: "Untrusted replacement" } }
        ];
      }
    }
  });
  const results = await hybrid.search({ query: "unmatched semantic phrase", documents, pinned_ids: [], limit: 3 });
  assert.deepEqual(results.map((entry) => entry.id), ["route-one"]);
  assert.equal(results[0].kind, "context-route");
  assert.equal(results[0].source.summary, "Canonical public checkout totals");
  assert.deepEqual(results[0].source.paths, ["docs/checkout.md"]);
});
