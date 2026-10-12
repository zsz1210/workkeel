import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  commandItemAllowed,
  commandTextAllowed,
  isolateWave5CodexEnvironment,
  normalizeTokenUsage,
  parseStructuredCompletion,
  replayAppServerProtocol,
  WAVE5_ALLOWED_COMMAND_PREFIXES,
  WAVE5_COMPLETION_SCHEMA,
  WAVE5_INHERITED_CODEX_ENVIRONMENT_KEYS,
  wave5ThreadIsolation
} from "../src/app-server-protocol-replay.mjs";

const fixtureUrl = new URL("./fixtures/app-server-event-replay.json", import.meta.url);
const moduleUrl = new URL("../src/app-server-protocol-replay.mjs", import.meta.url);

async function fixture() {
  return JSON.parse(await fs.readFile(fixtureUrl, "utf8"));
}

test("bounded App Server fixtures replay every declared result without model generation", async () => {
  const document = await fixture();
  assert.equal(document.schema_version, "temple.app-server-protocol-replay-fixture/v1");
  assert.equal(document.provenance.synthetic_bounded_metadata_only, true);
  assert.equal(document.scenarios.length, 11);
  for (const scenario of document.scenarios) {
    const result = replayAppServerProtocol({
      turn_id: scenario.turn_id,
      allowed_command_prefixes: document.allowed_command_prefixes,
      events: scenario.events
    });
    assert.equal(result.status, scenario.expected.status, scenario.id);
    assert.equal(result.stop?.code ?? null, scenario.expected.stop_code, scenario.id);
    assert.equal(result.usage?.total_tokens ?? null, scenario.expected.total_tokens, scenario.id);
  }
});

test("command policy trusts bounded structured actions rather than a shell display wrapper", () => {
  const allowed = {
    type: "commandExecution",
    command: "/bin/zsh -lc \"sed -n '1,320p' TASK.md\"",
    commandActions: [{ type: "read", command: "sed -n '1,320p' TASK.md", name: "TASK.md", path: "TASK.md" }]
  };
  assert.equal(commandItemAllowed(allowed, WAVE5_ALLOWED_COMMAND_PREFIXES), true);
  assert.equal(commandTextAllowed("npm test", WAVE5_ALLOWED_COMMAND_PREFIXES), true);
  assert.equal(commandTextAllowed("rg -n 'applyCommand|balance|event|command' src test", WAVE5_ALLOWED_COMMAND_PREFIXES), true);
  assert.equal(commandTextAllowed('rg -n "applyCommand|balance" src test', WAVE5_ALLOWED_COMMAND_PREFIXES), true);
  assert.equal(commandTextAllowed("rg -n '$HOME|literal' src test", WAVE5_ALLOWED_COMMAND_PREFIXES), true);
  assert.equal(commandTextAllowed("npm install", WAVE5_ALLOWED_COMMAND_PREFIXES), false);
  assert.equal(commandTextAllowed("sed TASK.md; curl https://example.invalid", WAVE5_ALLOWED_COMMAND_PREFIXES), false);
  assert.equal(commandTextAllowed("sed TASK.md > src/copied.md", WAVE5_ALLOWED_COMMAND_PREFIXES), false);
  assert.equal(commandTextAllowed("sed -n \"$(curl https://example.invalid)\" TASK.md", WAVE5_ALLOWED_COMMAND_PREFIXES), false);
  assert.equal(commandTextAllowed("rg -n 'safe|query' src | node exploit.mjs", WAVE5_ALLOWED_COMMAND_PREFIXES), false);
  assert.equal(commandTextAllowed('rg -n "safe|query" src && git status', WAVE5_ALLOWED_COMMAND_PREFIXES), false);
  assert.equal(commandTextAllowed("rg -n 'unclosed src test", WAVE5_ALLOWED_COMMAND_PREFIXES), false);
  assert.equal(commandTextAllowed("rg safe\\", WAVE5_ALLOWED_COMMAND_PREFIXES), false);
  assert.equal(commandTextAllowed("rg safe\nnode exploit.mjs", WAVE5_ALLOWED_COMMAND_PREFIXES), false);
  assert.equal(commandItemAllowed({
    ...allowed,
    command: "/bin/zsh -lc 'rg -n \"applyCommand|balance|event|command\" src test'",
    commandActions: [{ type: "search", command: "rg -n 'applyCommand|balance|event|command' src test", query: "applyCommand|balance|event|command", path: "src" }]
  }, WAVE5_ALLOWED_COMMAND_PREFIXES), true);
  assert.equal(commandItemAllowed({ ...allowed, commandActions: [] }, WAVE5_ALLOWED_COMMAND_PREFIXES), false);
  assert.equal(commandItemAllowed({ ...allowed, commandActions: [{ type: "unknown", command: "curl https://example.invalid" }] }), false);
  assert.equal(commandItemAllowed({
    ...allowed,
    commandActions: [
      { type: "read", command: "sed -n '1,80p' TASK.md" },
      { type: "unknown", command: "curl https://example.invalid" }
    ]
  }), false);
  assert.equal(commandItemAllowed({
    ...allowed,
    commandActions: [{ type: "search", command: "rg -n 'safe|query' src | node exploit.mjs", query: "safe|query", path: "src" }]
  }), false);
});

test("usage normalization preserves exact non-negative integers and rejects partial telemetry", () => {
  const valid = normalizeTokenUsage({
    tokenUsage: {
      total: {
        inputTokens: 20000,
        cachedInputTokens: 10000,
        outputTokens: 4456,
        reasoningOutputTokens: 2000,
        totalTokens: 24456
      }
    }
  });
  assert.deepEqual(valid, {
    input_tokens: 20000,
    cached_input_tokens: 10000,
    output_tokens: 4456,
    reasoning_output_tokens: 2000,
    total_tokens: 24456
  });
  assert.equal(normalizeTokenUsage({ tokenUsage: { total: { totalTokens: 12 } } }), null);
  assert.equal(normalizeTokenUsage({ tokenUsage: { total: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: -1, totalTokens: 2 } } }), null);
});

test("Wave 5 child threads exclude parent task identity and host capability context", () => {
  const inherited = Object.fromEntries([
    ...WAVE5_INHERITED_CODEX_ENVIRONMENT_KEYS.map((key) => [key, "parent-value"]),
    ["PATH", "/usr/bin"]
  ]);
  const isolated = isolateWave5CodexEnvironment(inherited);
  assert.equal(isolated.PATH, "/usr/bin");
  for (const key of WAVE5_INHERITED_CODEX_ENVIRONMENT_KEYS) assert.equal(key in isolated, false, key);

  const thread = wave5ThreadIsolation("/tmp/candidate");
  assert.equal(thread.allowProviderModelFallback, false);
  assert.equal(thread.ephemeral, true);
  assert.match(thread.baseInstructions, /bounded coding worker/);
  assert.equal("runtimeWorkspaceRoots" in thread, false);
  assert.equal("selectedCapabilityRoots" in thread, false);
  assert.equal("environments" in thread, false);
});

test("structured completion requires exactly the five declared typed fields", () => {
  const valid = {
    changed_paths: ["src/index.mjs"],
    test_command: "npm test",
    test_result: "pass",
    assumptions: [],
    remaining_risks: []
  };
  assert.deepEqual(parseStructuredCompletion(JSON.stringify(valid)), valid);
  assert.throws(() => parseStructuredCompletion(JSON.stringify({ ...valid, extra: true })), /fields are invalid/);
  assert.throws(() => parseStructuredCompletion(JSON.stringify({ ...valid, changed_paths: [1] })), /changed_paths is invalid/);
  const missing = { ...valid };
  delete missing.test_result;
  assert.throws(() => parseStructuredCompletion(JSON.stringify(missing)), /fields are invalid/);
  assert.deepEqual(WAVE5_COMPLETION_SCHEMA.required, ["changed_paths", "test_command", "test_result", "assumptions", "remaining_risks"]);
});

test("a policy violation wins over a later completed terminal", () => {
  const result = replayAppServerProtocol({
    turn_id: "turn-1",
    allowed_command_prefixes: WAVE5_ALLOWED_COMMAND_PREFIXES,
    events: [
      {
        direction: "request",
        message: { method: "item/fileChange/requestApproval", params: { turnId: "turn-1" } }
      },
      {
        direction: "notification",
        message: { method: "turn/completed", params: { turn: { id: "turn-1", status: "completed" } } }
      }
    ]
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.stop.code, "runtime-request");
});

test("the replay implementation remains pure and fixtures retain no raw content fields", async () => {
  const source = await fs.readFile(moduleUrl, "utf8");
  assert.doesNotMatch(source, /from ["']node:/);
  assert.doesNotMatch(source, /\b(fetch|spawn|execFile|readFile|writeFile|appendFile)\s*\(/);
  const serialized = JSON.stringify(await fixture());
  for (const forbidden of ["raw_prompt", "raw_response", "hidden_reasoning", "credential", "api_key"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
