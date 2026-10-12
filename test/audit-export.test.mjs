import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAuditExport, writeAuditExport } from "../src/audit-export.mjs";
import { formatJson } from "../src/files.mjs";
import { RECOVERY_LEDGER_SCHEMA, resolveRecoveryStateDirectory } from "../src/recovery.mjs";

function fixtureHomePath(...segments) {
  return ["", "Users", "fixture-account", ...segments].join("/");
}

async function fixture(projectId = "audit-fixture") {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-audit-test-"));
  const target = path.join(temporaryRoot, "project");
  await fs.mkdir(path.join(target, ".ai-org/events"), { recursive: true });
  await fs.mkdir(path.join(target, ".ai-org/project"), { recursive: true });
  await fs.writeFile(
    path.join(target, ".ai-org/project/project.json"),
    formatJson({ schema_version: "temple.project/v1", id: projectId, name: "Audit Fixture" })
  );
  await fs.writeFile(
    path.join(target, "temple.lock"),
    formatJson({ schema_version: "temple.lock/v1", project_id: projectId, template: { version: "0.1.0-alpha.27" } })
  );
  return { temporaryRoot, target };
}

async function writeEvents(target, events) {
  await fs.writeFile(
    path.join(target, ".ai-org/events/events.jsonl"),
    events.map((event) => JSON.stringify(event)).join("\n") + "\n"
  );
}

async function writeRecoveryLedger(target, transactionId, ledger) {
  const stateDirectory = resolveRecoveryStateDirectory(target);
  const transactionDirectory = path.join(stateDirectory, "transactions", transactionId);
  await fs.mkdir(transactionDirectory, { recursive: true });
  await fs.writeFile(path.join(transactionDirectory, "ledger.json"), formatJson(ledger));
  return stateDirectory;
}

test("audit export is deterministic, bounded, filtered, and recursively redacted", async (context) => {
  const state = await fixture();
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const privateProviderPath = fixtureHomePath("private", "provider-body.json");
  const anotherPrivateFile = fixtureHomePath("another-private-file");
  const privatePathPrefix = fixtureHomePath("private");
  await writeEvents(state.target, [
    {
      timestamp: "2026-08-01T00:00:00.000Z",
      event_type: "work_item_created",
      actor: "human",
      work_item_id: "WI-0001",
      refs: [".ai-org/work-items/WI-0001.json"]
    },
    {
      timestamp: "2026-08-02T00:00:00.000Z",
      event_type: "provider_observed",
      actor: "credential-secret-marker-123456789",
      work_item_id: "WI-0001",
      result: "password-marker-123456789",
      refs: [
        ".ai-org/artifacts/evidence.json",
        privateProviderPath,
        "../outside",
        "https://user:password@example.test/evidence?token=provider-secret#private",
        `File://${anotherPrivateFile}`,
        "artifact?token=relative-secret",
        { innocent_key: "raw provider body" }
      ],
      metadata: {
        innocent_key: "raw provider business body",
        nested: { password: "metadata-password", prompt: "PROMPT-CONTENT-LEAK", response: "RESPONSE-CONTENT-LEAK" }
      },
      provider_body: { innocent_key: "another provider body" },
      approval_record: { innocent_key: "not a scalar approval reference" },
      outcome: "private-provider-response-123456789"
    },
    {
      timestamp: "2026-08-03T00:00:00.000Z",
      event_type: "evidence_recorded",
      actor: "agent-rikku",
      work_item_id: "WI-0002",
      evidence_id: "EVID-20260803T000000Z-ABCDEF12",
      outcome: "pass",
      refs: [".ai-org/project/evidence.json"]
    },
    {
      timestamp: "2026-08-04T00:00:00.000Z",
      event_type: "work_item_transitioned",
      actor: "agent-hollis",
      work_item_id: "WI-0001",
      from_state: "in_progress",
      to_state: "implemented",
      approval_record: "https://user:password@example.test/approval?token=approval-secret#private",
      refs: [".ai-org/work-items/WI-0001.json"]
    }
  ]);

  const options = { maxEvents: 2, workItemIds: ["WI-0001"], maxEventBytes: 8_192 };
  const first = await buildAuditExport(state.target, options);
  const second = await buildAuditExport(state.target, options);
  assert.deepEqual(second, first);
  assert.equal(first.selection.source_event_count, 4);
  assert.equal(first.selection.matched_event_count, 3);
  assert.equal(first.selection.selected_event_count, 2);
  assert.deepEqual(first.events.map((event) => event.timestamp), [
    "2026-08-02T00:00:00.000Z",
    "2026-08-04T00:00:00.000Z"
  ]);

  const encoded = JSON.stringify(first);
  for (const forbidden of [
    "raw provider business body",
    "another provider body",
    "PROMPT-CONTENT-LEAK",
    "RESPONSE-CONTENT-LEAK",
    "metadata-password",
    privatePathPrefix,
    "provider-secret",
    "relative-secret",
    "approval-secret",
    "not a scalar approval reference",
    "credential-secret-marker-123456789",
    "private-provider-response-123456789",
    "password-marker-123456789"
  ]) {
    assert.equal(encoded.includes(forbidden), false, forbidden);
  }
  assert.equal(first.events[0].actor, "[REDACTED_TEXT]");
  assert.equal(first.events[0].outcome, "[REDACTED_TEXT]");
  assert.equal(first.events[0].result, "[REDACTED_TEXT]");
  assert.deepEqual(first.events[0].refs, [
    ".ai-org/artifacts/evidence.json",
    "[REDACTED_REF]",
    "[REDACTED_REF]",
    "https://example.test/evidence",
    "[REDACTED_REF]",
    "[REDACTED_REF]",
    "[REDACTED_REF]"
  ]);
  assert.equal(Object.hasOwn(first.events[0], "metadata"), false);
  assert.equal(first.events[1].actor, "agent-hollis");
  assert.equal(first.events[1].from_state, "in_progress");
  assert.equal(first.events[1].to_state, "implemented");
  assert.equal(first.events[1].approval_record, "https://example.test/approval");

  const outputOne = path.join(state.temporaryRoot, "audit-one.json");
  const outputTwo = path.join(state.temporaryRoot, "audit-two.json");
  const written = await writeAuditExport(state.target, outputOne, options);
  await writeAuditExport(state.target, outputTwo, options);
  assert.equal(written.export_digest, first.export_digest);
  assert.equal(await fs.readFile(outputOne, "utf8"), await fs.readFile(outputTwo, "utf8"));
  await assert.rejects(() => writeAuditExport(state.target, outputOne, options), /EEXIST/);
});

test("audit export emits only bounded recovery metadata, never recovery payloads", async (context) => {
  const state = await fixture("audit-recovery");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  await writeEvents(state.target, []);
  const privateProjectPath = fixtureHomePath("private-project");
  const privateRecoveryPath = fixtureHomePath("private");
  const baseLedger = {
    schema_version: RECOVERY_LEDGER_SCHEMA,
    status: "completed",
    completed_at: "2026-08-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    plan_digest: "a".repeat(64),
    backup_manifest_digest: "b".repeat(64),
    target: privateProjectPath,
    backup: "/Volumes/private/backup",
    actions: [
      {
        path: ".ai-org/project/project.json",
        state: "applied",
        before_path: "before/private-project.json",
        provider_body: "private provider response"
      },
      {
        path: ".ai-org/project/agents.json",
        state: "provider business body hidden in state"
      }
    ],
    recovery_failures: [{ path: privateRecoveryPath, error: "password=private" }]
  };
  const recoveryRoot = await writeRecoveryLedger(state.target, "tx-older", {
    ...baseLedger,
    transaction_id: "tx-older"
  });
  await writeRecoveryLedger(state.target, "tx-newer", {
    ...baseLedger,
    transaction_id: "tx-newer",
    completed_at: "2026-08-02T00:00:00.000Z"
  });
  await fs.writeFile(
    path.join(recoveryRoot, "active.json"),
    formatJson({ schema_version: RECOVERY_LEDGER_SCHEMA, transaction_id: "tx-newer" })
  );

  const document = await buildAuditExport(state.target, { maxRecoveryTransactions: 1 });
  assert.equal(document.recovery.status, "recovery-required");
  assert.equal(document.recovery.active_transaction_id, "tx-newer");
  assert.equal(document.recovery.source_transaction_count, 2);
  assert.equal(document.recovery.transactions.length, 1);
  assert.equal(document.recovery.transactions[0].transaction_id, "tx-newer");
  assert.equal(document.recovery.transactions[0].action_count, 2);
  assert.deepEqual(document.recovery.transactions[0].action_states, { applied: 1, unknown: 1 });
  assert.equal(document.recovery.transactions[0].recovery_failure_count, 1);
  const encoded = JSON.stringify(document);
  for (const forbidden of [
    privateProjectPath,
    "/Volumes/private/backup",
    ".ai-org/project/project.json",
    "before/private-project.json",
    "private provider response",
    "provider business body hidden in state",
    "password=private"
  ]) {
    assert.equal(encoded.includes(forbidden), false, forbidden);
  }
});

test("audit export fails closed for linked sources and oversized canonical event lines", async (context) => {
  const state = await fixture("audit-source-safety");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const eventPath = path.join(state.target, ".ai-org/events/events.jsonl");
  const externalPath = path.join(state.temporaryRoot, "external-events.jsonl");
  await fs.writeFile(externalPath, "");
  await fs.symlink(externalPath, eventPath);
  await assert.rejects(() => buildAuditExport(state.target), /real file/);

  await fs.unlink(eventPath);
  const externalEventsDirectory = path.join(state.temporaryRoot, "external-events");
  await fs.mkdir(externalEventsDirectory);
  await fs.writeFile(
    path.join(externalEventsDirectory, "events.jsonl"),
    `${JSON.stringify({
      timestamp: "2026-08-01T00:00:00.000Z",
      event_type: "external_event",
      actor: "human",
      result: "external-source-marker"
    })}\n`
  );
  await fs.rmdir(path.join(state.target, ".ai-org/events"));
  await fs.symlink(externalEventsDirectory, path.join(state.target, ".ai-org/events"));
  await assert.rejects(() => buildAuditExport(state.target), /source parent must be a real directory/);

  await fs.unlink(path.join(state.target, ".ai-org/events"));
  await fs.mkdir(path.join(state.target, ".ai-org/events"));
  await writeEvents(state.target, [{
    timestamp: "2026-08-01T00:00:00.000Z",
    event_type: "oversized_event",
    metadata: { harmless_name: "x".repeat(2 * 1024 * 1024) }
  }]);
  await assert.rejects(() => buildAuditExport(state.target), /exceeds 2097152 bytes/);
});
