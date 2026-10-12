import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyPublicationArtifactNormalization,
  buildPublicationArtifactNormalizationPlan
} from "../src/publication-artifact-normalization.mjs";

function git(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function fixture(context) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "temple-artifact-normalization-"));
  context.after(() => fs.rm(target, { recursive: true, force: true }));
  await fs.mkdir(path.join(target, ".ai-org", "artifacts", "WI-0001"), { recursive: true });
  await fs.mkdir(path.join(target, ".ai-org", "events"), { recursive: true });
  await fs.mkdir(path.join(target, ".ai-org", "work-items"), { recursive: true });
  await fs.writeFile(path.join(target, ".ai-org", "events", "events.jsonl"), "");
  await fs.writeFile(path.join(target, ".ai-org", "work-items", "WI-0001.json"), `${JSON.stringify({
    id: "WI-0001",
    claim: { status: "active", agent_id: "agent-dev", principal_id: "human" }
  }, null, 2)}\n`);
  await fs.writeFile(
    path.join(target, ".ai-org", "artifacts", "WI-0001", "report.md"),
    `Path: ${["", "Users", "private-maintainer", "project"].join("/")}\nEndpoint: ${[192, 168, 7, 4].join(".")}\n`
  );
  await fs.writeFile(
    path.join(target, ".ai-org", "artifacts", "WI-0001", "observation.json"),
    `${JSON.stringify({ host: ["device", "tail-private", "ts", "net"].join(".") })}\n`
  );
  await fs.writeFile(path.join(target, "outside.md"), `Keep ${[10, 0, 0, 8].join(".")}\n`);
  git(target, ["init", "-q"]);
  git(target, ["config", "user.email", "artifact-normalization@example.invalid"]);
  git(target, ["config", "user.name", "Artifact Normalization"]);
  git(target, ["add", "."]);
  git(target, ["commit", "-qm", "fixture"]);
  return target;
}

async function addActiveEvidence(target, artifactPath) {
  await fs.mkdir(path.join(target, ".ai-org", "project"), { recursive: true });
  const content = await fs.readFile(path.join(target, ...artifactPath.split("/")));
  const sha256 = (await import("node:crypto")).createHash("sha256").update(content).digest("hex");
  await fs.writeFile(path.join(target, ".ai-org", "project", "evidence.json"), `${JSON.stringify({
    schema_version: "temple.evidence/v1",
    entries: [{
      id: "EVID-20260905T000000Z-00000001",
      work_item_id: "WI-0001",
      recorded_at: "2026-09-05T00:00:00.000Z",
      recorded_by: "agent-dev",
      expires_at: null,
      invalidated_at: null,
      invalidated_by: null,
      invalidation_reason: null,
      external_action_performed: false,
      kind: "runtime",
      title: "Fixture evidence",
      outcome: "pass",
      scope_revision: null,
      observed_at: "2026-09-05T00:00:00.000Z",
      summary: "Fixture evidence bound to the current artifact",
      adapter: { id: "fixture", version: "1", source_ref: artifactPath },
      artifacts: [{ path: artifactPath, sha256 }],
      details: {}
    }]
  }, null, 2)}\n`);
}

test("artifact normalization plan is deterministic and retains no matched values", async (context) => {
  const target = await fixture(context);
  const first = await buildPublicationArtifactNormalizationPlan(target);
  const second = await buildPublicationArtifactNormalizationPlan(target);
  assert.deepEqual(second, first);
  assert.equal(first.status, "changes-pending");
  assert.equal(first.summary.changed_files, 2);
  assert.equal(first.summary.change_count, 3);
  assert.deepEqual(first.summary.changes, {
    "maintainer-home-path-posix": 1,
    "private-ipv4": 1,
    "private-tailnet-hostname": 1
  });
  const serialized = JSON.stringify(first);
  for (const component of ["private-maintainer", [192, 168, 7, 4].join("."), "device.tail-private"]) {
    assert.equal(serialized.includes(component), false, component);
  }
});

test("artifact apply rejects stale input, rolls back failures, and is idempotent", async (context) => {
  const target = await fixture(context);
  const reportPath = path.join(target, ".ai-org", "artifacts", "WI-0001", "report.md");
  const initial = await fs.readFile(reportPath, "utf8");
  const first = await buildPublicationArtifactNormalizationPlan(target);
  await fs.appendFile(reportPath, "Unrelated change\n");
  await assert.rejects(() => applyPublicationArtifactNormalization(target, {
    workItemId: "WI-0001",
    expectedPlan: first.plan_digest,
    confirmNormalization: true
  }), /stale/);

  const fresh = await buildPublicationArtifactNormalizationPlan(target);
  await assert.rejects(() => applyPublicationArtifactNormalization(target, {
    workItemId: "WI-0001",
    expectedPlan: fresh.plan_digest,
    confirmNormalization: true,
    simulateFailureAfterWrites: 1
  }), /Simulated/);
  assert.equal(await fs.readFile(reportPath, "utf8"), `${initial}Unrelated change\n`);

  await assert.rejects(() => applyPublicationArtifactNormalization(target, {
    workItemId: "WI-0001",
    expectedPlan: fresh.plan_digest
  }), /confirmation/);
  const revisionBefore = git(target, ["rev-parse", "HEAD"]);
  const result = await applyPublicationArtifactNormalization(target, {
    workItemId: "WI-0001",
    expectedPlan: fresh.plan_digest,
    confirmNormalization: true,
    actor: "agent-dev"
  });
  assert.equal(result.applied, true);
  assert.equal(result.changed_files, 2);
  assert.equal(result.change_count, 3);
  assert.equal(result.git_history_changed, false);
  assert.equal(git(target, ["rev-parse", "HEAD"]), revisionBefore);
  assert.match(await fs.readFile(reportPath, "utf8"), /<LOCAL_HOME>\/project/);
  assert.match(await fs.readFile(reportPath, "utf8"), /<PRIVATE_IPV4>/);
  assert.equal((await fs.readFile(path.join(target, "outside.md"), "utf8")).includes([10, 0, 0, 8].join(".")), true);
  assert.match(await fs.readFile(path.join(target, ".ai-org", "events", "events.jsonl"), "utf8"), /publication_retained_artifacts_normalized/);

  const finalPlan = await buildPublicationArtifactNormalizationPlan(target);
  assert.equal(finalPlan.status, "no-changes");
  const noOp = await applyPublicationArtifactNormalization(target, {
    workItemId: "WI-0001",
    expectedPlan: finalPlan.plan_digest,
    confirmNormalization: true
  });
  assert.equal(noOp.applied, false);
  assert.equal(noOp.event_recorded, false);
});

test("artifact normalization exposes active evidence impact and refuses to break the registry", async (context) => {
  const target = await fixture(context);
  const artifactPath = ".ai-org/artifacts/WI-0001/report.md";
  await addActiveEvidence(target, artifactPath);
  git(target, ["add", "."]);
  git(target, ["commit", "-qm", "add evidence"]);

  const plan = await buildPublicationArtifactNormalizationPlan(target);
  assert.equal(plan.summary.active_evidence_records_affected, 1);
  assert.equal(plan.summary.active_evidence_artifacts_affected, 1);
  assert.deepEqual(plan.active_evidence_impacts, [{
    evidence_id: "EVID-20260905T000000Z-00000001",
    work_item_id: "WI-0001",
    path: artifactPath
  }]);
  await assert.rejects(() => applyPublicationArtifactNormalization(target, {
    workItemId: "WI-0001",
    expectedPlan: plan.plan_digest,
    confirmNormalization: true
  }), /invalidate or replace them first/);
  assert.match(await fs.readFile(path.join(target, artifactPath), "utf8"), /private-maintainer/);
});
