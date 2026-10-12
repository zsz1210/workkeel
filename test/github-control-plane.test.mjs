import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  GITHUB_FIXTURE_SCHEMA,
  inspectGitHubProvider,
  startGitHubControlPlaneProvider
} from "../src/github-control-plane-provider.mjs";
import {
  createProviderRegistry,
  repositoryProviderContract
} from "../src/control-plane-providers.mjs";
import { defaultControlPlaneConfig } from "../src/control-plane-config.mjs";
import { openTelemetryJournal } from "../src/telemetry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", ...options });
}

function git(target, args) {
  return spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-github-provider-test-"));
  const target = path.join(temporaryRoot, "github-product");
  const configPath = path.join(temporaryRoot, "init.json");
  const stateDirectory = path.join(temporaryRoot, "state");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await writeJson(configPath, {
    schema_version: "temple.init/v1",
    project: { id: "github-product", name: "GitHub Product" },
    naming_mode: "manual",
    agents: [
      { display_name: "Fixture Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Fixture Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Fixture Ellis", positions: ["tech_lead"] },
      { display_name: "Fixture Devon", positions: ["developer"] },
      { display_name: "Fixture Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  });
  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  assert.equal(git(target, ["init", "-q"]).status, 0);
  assert.equal(git(target, ["config", "user.email", "temple-tests@example.invalid"]).status, 0);
  assert.equal(git(target, ["config", "user.name", "Temple Tests"]).status, 0);
  assert.equal(git(target, ["add", "."]).status, 0);
  assert.equal(git(target, ["commit", "-qm", "initial state"]).status, 0);
  const created = run([
    "work-item", "create", target,
    "--title", "Observe one reviewed pull request",
    "--scope", "Read PR and Checks without mutating GitHub",
    "--acceptance", "Evidence remains exact-SHA-bound",
    "--affected-path", "src/github",
    "--ui-mode", "not-applicable",
    "--json"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const workItemId = JSON.parse(created.stdout).item.id;
  assert.equal(git(target, ["add", "."]).status, 0);
  assert.equal(git(target, ["commit", "-qm", "add github work item"]).status, 0);
  return {
    temporaryRoot,
    target,
    stateDirectory,
    workItemId,
    revision: git(target, ["rev-parse", "HEAD"]).stdout.trim(),
    initialRevision: git(target, ["rev-parse", "HEAD~1"]).stdout.trim()
  };
}

function pull(revision, overrides = {}) {
  return {
    number: 42,
    html_url: "https://github.com/example/project/pull/42",
    title: "Bounded control-plane observation",
    state: "open",
    draft: false,
    mergeable: true,
    head: { sha: revision },
    base: { sha: "b".repeat(40) },
    updated_at: "2026-08-30T02:00:00.000Z",
    ...overrides
  };
}

function checks() {
  return {
    total_count: 2,
    check_runs: [
      {
        id: 101,
        name: "test",
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/example/project/actions/runs/101",
        completed_at: "2026-08-30T02:01:00.000Z"
      },
      {
        id: 102,
        name: "lint",
        status: "completed",
        conclusion: "neutral",
        html_url: "https://github.com/example/project/actions/runs/102",
        completed_at: "2026-08-30T02:01:30.000Z"
      }
    ]
  };
}

function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers }
  });
}

function providerConfig(workItemId, revision, overrides = {}) {
  return {
    id: "github-main",
    kind: "github",
    enabled: true,
    options: {
      repository: "example/project",
      pull_number: 42,
      head_sha: revision,
      work_item_id: workItemId,
      poll_interval_ms: 5000,
      token_env: "TEMPLE_GITHUB_TEST_TOKEN",
      ...overrides
    }
  };
}

test("GitHub adapter uses only exact-SHA GET requests, ETags, and visible rate-limit state", async (context) => {
  const { workItemId, revision } = await fixture(context);
  const provider = providerConfig(workItemId, revision);
  const calls = [];
  const secret = "provider-secret-must-not-persist";
  process.env.TEMPLE_GITHUB_TEST_TOKEN = secret;
  context.after(() => { delete process.env.TEMPLE_GITHUB_TEST_TOKEN; });
  const firstFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/pulls/42")) {
      return jsonResponse(pull(revision), {
        etag: '"pull-v1"',
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1788058800",
        "x-ratelimit-resource": "core"
      });
    }
    return jsonResponse(checks(), {
      etag: '"checks-v1"',
      "x-ratelimit-remaining": "4998",
      "x-ratelimit-reset": "1788058800",
      "x-ratelimit-resource": "core"
    });
  };
  const first = await inspectGitHubProvider(provider, {
    projectId: "github-product",
    fetchImpl: firstFetch,
    observedAt: "2026-08-30T02:02:00.000Z"
  });
  assert.equal(first.observation.head_sha_matches, true);
  assert.equal(first.observation.outcome, "pass");
  assert.equal(first.observation.rate_limit.remaining, 4998);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.options.method === "GET"));
  assert.equal(calls[1].url.endsWith(`/commits/${revision}/check-runs`), true);
  assert.ok(calls.every((call) => call.options.headers.authorization === `Bearer ${secret}`));
  assert.doesNotMatch(JSON.stringify(first), new RegExp(secret));

  const cachedCalls = [];
  const cached = await inspectGitHubProvider(provider, {
    projectId: "github-product",
    previous: first.state,
    fetchImpl: async (url, options) => {
      cachedCalls.push({ url, options });
      return new Response(null, {
        status: 304,
        headers: {
          etag: url.endsWith("/pulls/42") ? '"pull-v1"' : '"checks-v1"',
          "x-ratelimit-remaining": "4997",
          "x-ratelimit-reset": "1788058800",
          "x-ratelimit-resource": "core"
        }
      });
    },
    observedAt: "2026-08-30T02:03:00.000Z"
  });
  assert.equal(cached.notModified, true);
  assert.equal(cached.observation.outcome, "pass");
  assert.equal(cachedCalls[0].options.headers["if-none-match"], '"pull-v1"');
  assert.equal(cachedCalls[1].options.headers["if-none-match"], '"checks-v1"');

  const wrongHead = "c".repeat(40);
  const wrongCalls = [];
  const stale = await inspectGitHubProvider(provider, {
    projectId: "github-product",
    previous: first.state,
    fetchImpl: async (url, options) => {
      wrongCalls.push({ url, options });
      return jsonResponse(pull(wrongHead), {
        etag: '"pull-v2"',
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1788058800",
        "x-ratelimit-resource": "core"
      });
    },
    observedAt: "2026-08-30T02:04:00.000Z"
  });
  assert.equal(wrongCalls.length, 1);
  assert.equal(stale.observation.outcome, "stale");
  assert.equal(stale.observation.checks, null);
  assert.equal(stale.observation.rate_limit.remaining, 0);
  assert.equal(stale.state.checks_etag, null);
});

test("GitHub fixture is deterministic and cannot perform an external write", async (context) => {
  const { workItemId, revision } = await fixture(context);
  const provider = providerConfig(workItemId, revision);
  const fixtureDocument = {
    schema_version: GITHUB_FIXTURE_SCHEMA,
    observed_at: "2026-08-30T03:00:00.000Z",
    pull: pull(revision),
    checks: checks(),
    pull_etag: '"fixture-pull"',
    checks_etag: '"fixture-checks"',
    rate_limit: { remaining: 1234, reset_at: "2026-08-30T04:00:00.000Z", resource: "core" }
  };
  let fetchCalled = false;
  const inspected = await inspectGitHubProvider(provider, {
    projectId: "github-product",
    fixture: fixtureDocument,
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("fixture attempted network access");
    }
  });
  assert.equal(fetchCalled, false);
  assert.equal(inspected.observation.outcome, "pass");
  assert.equal(inspected.observation.external_action_performed, false);
  assert.equal(inspected.state.pull_etag, '"fixture-pull"');
});

test("reviewed GitHub observation requires an explicit capture and never changes lifecycle state", async (context) => {
  const { target, stateDirectory, workItemId, revision, initialRevision } = await fixture(context);
  const provider = providerConfig(workItemId, revision);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    return url.endsWith("/pulls/42")
      ? jsonResponse(pull(revision), { etag: '"pull-live"', "x-ratelimit-remaining": "99" })
      : jsonResponse(checks(), { etag: '"checks-live"', "x-ratelimit-remaining": "98" });
  };
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const live = await startGitHubControlPlaneProvider(
    target,
    stateDirectory,
    journal,
    registry,
    provider,
    { fetchImpl }
  );
  await live.start();
  assert.equal(registry.get("github-main").status, "ready");
  assert.ok(journal.readAfter(0).records.some((entry) => entry.type === "org.temple.github.pull-request.observed.v1"));
  await live.stop();
  await journal.close();
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((call) => call.method === "GET"));

  const providerState = await fs.readFile(path.join(stateDirectory, "providers/github-github-main.json"), "utf8");
  assert.doesNotMatch(providerState, /TEMPLE_GITHUB_TEST_TOKEN|authorization|Bearer /i);
  const itemPath = path.join(target, ".ai-org/work-items", `${workItemId}.json`);
  const beforeState = JSON.parse(await fs.readFile(itemPath, "utf8")).state;
  const beforeEvidence = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/evidence.json"), "utf8")).entries.length;
  const captured = run([
    "control-plane", "capture-github", target,
    "--provider-id", "github-main",
    "--work-item", workItemId,
    "--revision", revision,
    "--state-dir", stateDirectory,
    "--json"
  ]);
  assert.equal(captured.status, 0, captured.stderr || captured.stdout);
  const evidence = JSON.parse(captured.stdout);
  assert.equal(evidence.kind, "github");
  assert.equal(evidence.scope_revision, revision);
  assert.equal(evidence.outcome, "pass");
  assert.equal(evidence.external_action_performed, false);
  const afterRegistry = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/evidence.json"), "utf8"));
  assert.equal(afterRegistry.entries.length, beforeEvidence + 1);
  assert.equal(JSON.parse(await fs.readFile(itemPath, "utf8")).state, beforeState);
  assert.equal(JSON.parse(await fs.readFile(itemPath, "utf8")).gate_evidence?.github, undefined);

  const wrongRevision = run([
    "control-plane", "capture-github", target,
    "--provider-id", "github-main",
    "--work-item", workItemId,
    "--revision", initialRevision,
    "--state-dir", stateDirectory
  ]);
  assert.equal(wrongRevision.status, 1);
  assert.match(wrongRevision.stderr, /exact head SHA to match/);
});
