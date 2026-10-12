import path from "node:path";
import {
  appendNormalizedEvidence,
  evidenceId,
  resolveGitRevision
} from "./evidence.mjs";
import { atomicWrite, formatJson, readJson, sha256 } from "./files.mjs";
import {
  PROVIDER_CAPABILITIES,
  PROVIDER_CONTRACT_SCHEMA
} from "./control-plane-providers.mjs";
import { withProjectMutationLock } from "./project.mjs";
import { readWorkItem } from "./work-items.mjs";

export const GITHUB_PROVIDER_STATE_SCHEMA = "temple.github-provider-state/v1";
export const GITHUB_FIXTURE_SCHEMA = "temple.github-observation-fixture/v1";

const SHA = /^[0-9a-f]{40}$/;
const SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const FAILURE_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"]);

function capabilities(overrides = {}) {
  return Object.fromEntries(
    PROVIDER_CAPABILITIES.map((capability) => [capability, overrides[capability] ?? "unsupported"])
  );
}

function boundedText(value, limit = 300) {
  const text = String(value ?? "").replaceAll(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function validatedOptions(provider, baseDirectory = process.cwd()) {
  const options = provider?.options ?? provider ?? {};
  const repository = String(options.repository ?? "");
  const pullNumber = Number(options.pull_number);
  const expectedHeadSha = String(options.head_sha ?? "").toLowerCase();
  const workItemId = String(options.work_item_id ?? "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("GitHub provider options.repository must use owner/repository");
  if (!Number.isInteger(pullNumber) || pullNumber < 1) throw new Error("GitHub provider options.pull_number must be a positive integer");
  if (!SHA.test(expectedHeadSha)) throw new Error("GitHub provider options.head_sha must be an exact 40-character commit SHA");
  if (!workItemId) throw new Error("GitHub provider options.work_item_id is required");
  const apiUrl = new URL(options.api_url ?? "https://api.github.com");
  if (apiUrl.protocol !== "https:") throw new Error("GitHub provider API URL must use HTTPS");
  if (apiUrl.username || apiUrl.password) throw new Error("GitHub provider API URL must not contain credentials");
  const pollIntervalMs = options.poll_interval_ms ?? 30000;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 5000 || pollIntervalMs > 3600000) {
    throw new Error("GitHub provider poll_interval_ms must be from 5000 to 3600000");
  }
  const tokenEnv = String(options.token_env ?? "GH_TOKEN");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv)) throw new Error("GitHub provider token_env must be an environment-variable name");
  let fixturePath = null;
  if (options.fixture_path) {
    fixturePath = path.resolve(baseDirectory, String(options.fixture_path));
    const relativeFixture = path.relative(path.resolve(baseDirectory), fixturePath);
    if (!relativeFixture || relativeFixture.startsWith("..") || path.isAbsolute(relativeFixture)) {
      throw new Error("GitHub provider fixture_path must stay inside the project repository");
    }
  }
  return {
    repository,
    pullNumber,
    expectedHeadSha,
    workItemId,
    apiUrl: apiUrl.toString().replace(/\/$/, ""),
    pollIntervalMs,
    tokenEnv,
    fixturePath
  };
}

export function githubControlPlaneProviderContract(provider = {}) {
  const status = provider.status ?? "offline";
  return {
    schema_version: PROVIDER_CONTRACT_SCHEMA,
    id: provider.id ?? "github",
    kind: "github",
    version: "github-pr-checks-v1",
    status,
    capabilities: capabilities({
      enumeration: "supported",
      history_snapshot: "supported",
      live_events: "supported",
      diff_summary: "supported"
    }),
    last_observed_at: provider.lastObservedAt ?? null,
    degraded_reason: provider.degradedReason ?? (status === "ready" ? null : "not connected"),
    protocol: {
      mode: "read-only-etag-polling",
      external_writes: false,
      exact_sha_required: true
    }
  };
}

function headersFrom(input) {
  const get = (name) => {
    if (typeof input?.get === "function") return input.get(name);
    const entry = Object.entries(input ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
    return entry?.[1] ?? null;
  };
  const remainingValue = get("x-ratelimit-remaining");
  const resetValue = get("x-ratelimit-reset");
  const remaining = remainingValue === null ? null : Number(remainingValue);
  const reset = resetValue === null ? null : Number(resetValue);
  return {
    etag: get("etag"),
    rate_limit: {
      remaining: Number.isFinite(remaining) ? remaining : null,
      reset_at: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null,
      resource: get("x-ratelimit-resource")
    }
  };
}

async function githubGet(fetchImpl, url, options) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "Temple-Control-Plane",
    "x-github-api-version": "2022-11-28"
  };
  if (options.etag) headers["if-none-match"] = options.etag;
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? 10000)
  });
  const metadata = headersFrom(response.headers);
  if (response.status === 304) return { notModified: true, value: null, metadata };
  if (!response.ok) {
    const error = new Error(`GitHub read-only request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.rateLimit = metadata.rate_limit;
    throw error;
  }
  return { notModified: false, value: await response.json(), metadata };
}

function safePull(pull) {
  return {
    number: Number(pull?.number),
    url: boundedText(pull?.html_url, 500),
    title: boundedText(pull?.title, 300),
    state: boundedText(pull?.state, 40) ?? "unknown",
    draft: pull?.draft === true,
    mergeable: typeof pull?.mergeable === "boolean" ? pull.mergeable : null,
    head_sha: String(pull?.head?.sha ?? "").toLowerCase(),
    base_sha: SHA.test(String(pull?.base?.sha ?? "").toLowerCase()) ? String(pull.base.sha).toLowerCase() : null,
    updated_at: pull?.updated_at ?? null
  };
}

function safeChecks(checks) {
  const runs = (checks?.check_runs ?? []).slice(0, 200).map((run) => ({
    id: Number.isFinite(run?.id) ? run.id : null,
    name: boundedText(run?.name, 200) ?? "unnamed check",
    status: boundedText(run?.status, 40) ?? "unknown",
    conclusion: boundedText(run?.conclusion, 60),
    url: boundedText(run?.html_url, 500),
    completed_at: run?.completed_at ?? null
  }));
  return {
    total: runs.length,
    successful: runs.filter((run) => SUCCESS_CONCLUSIONS.has(run.conclusion)).length,
    failed: runs.filter((run) => FAILURE_CONCLUSIONS.has(run.conclusion)).length,
    pending: runs.filter((run) => run.status !== "completed" || !run.conclusion).length,
    runs
  };
}

function observationOutcome(checks, shaMatch) {
  if (!shaMatch) return "stale";
  if (!checks || checks.total === 0 || checks.pending > 0) return "pending";
  if (checks.failed > 0) return "fail";
  return checks.successful === checks.total ? "pass" : "pending";
}

function normalizedObservation(projectId, provider, options, pull, checks, metadata, observedAt) {
  const shaMatch = pull.head_sha === options.expectedHeadSha;
  const outcome = observationOutcome(checks, shaMatch);
  const data = {
    project_id: projectId,
    work_item_id: options.workItemId,
    provider_id: provider.id,
    repository: options.repository,
    pull_number: options.pullNumber,
    pull_url: pull.url,
    pull_title: pull.title,
    pull_state: pull.state,
    draft: pull.draft,
    mergeable: pull.mergeable,
    expected_head_sha: options.expectedHeadSha,
    observed_head_sha: pull.head_sha,
    head_sha_matches: shaMatch,
    base_sha: pull.base_sha,
    checks,
    outcome,
    rate_limit: metadata.rate_limit,
    etag_reused: metadata.etagReused,
    external_action_performed: false
  };
  const id = `github-pr-${options.pullNumber}-${sha256(JSON.stringify([
    pull.updated_at,
    pull.head_sha,
    pull.state,
    pull.draft,
    checks,
    outcome
  ])).slice(0, 32)}`;
  return {
    event: {
      specversion: "1.0",
      id,
      source: `urn:temple:provider:github:${provider.id}`,
      type: "org.temple.github.pull-request.observed.v1",
      subject: `project/${projectId}/work-item/${options.workItemId}`,
      time: pull.updated_at ?? observedAt,
      data
    },
    observation: {
      schema_version: "temple.github-observation/v1",
      provider_id: provider.id,
      observed_at: observedAt,
      ...data
    }
  };
}

function statePath(stateDirectory, providerId) {
  return path.join(stateDirectory, "providers", `github-${providerId}.json`);
}

async function readState(stateDirectory, providerId) {
  try {
    return await readJson(statePath(stateDirectory, providerId));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      schema_version: GITHUB_PROVIDER_STATE_SCHEMA,
      provider_id: providerId,
      pull_etag: null,
      checks_etag: null,
      pull: null,
      checks: null,
      observation: null
    };
  }
}

export async function readGitHubFixture(fixturePath) {
  const fixture = await readJson(fixturePath);
  if (fixture?.schema_version !== GITHUB_FIXTURE_SCHEMA || !fixture.pull || !fixture.checks) {
    throw new Error(`GitHub fixture must use ${GITHUB_FIXTURE_SCHEMA} with pull and checks`);
  }
  return fixture;
}

export async function inspectGitHubProvider(provider, options = {}) {
  const config = validatedOptions(provider, options.baseDirectory);
  const previous = options.previous ?? {
    pull_etag: null,
    checks_etag: null,
    pull: null,
    checks: null
  };
  const observedAt = options.observedAt ?? new Date().toISOString();
  if (config.fixturePath || options.fixture) {
    const fixture = options.fixture ?? await readGitHubFixture(config.fixturePath);
    const pull = safePull(fixture.pull);
    const shaMatch = pull.head_sha === config.expectedHeadSha;
    const checks = shaMatch ? safeChecks(fixture.checks) : null;
    const metadata = {
      rate_limit: fixture.rate_limit ?? { remaining: null, reset_at: null, resource: null },
      etagReused: false
    };
    const normalized = normalizedObservation(options.projectId, provider, config, pull, checks, metadata, fixture.observed_at ?? observedAt);
    return {
      ...normalized,
      state: {
        schema_version: GITHUB_PROVIDER_STATE_SCHEMA,
        provider_id: provider.id,
        pull_etag: fixture.pull_etag ?? null,
        checks_etag: fixture.checks_etag ?? null,
        pull,
        checks,
        observation: normalized.observation
      },
      notModified: false
    };
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = config.tokenEnv ? process.env[config.tokenEnv] : null;
  const pullResult = await githubGet(fetchImpl, `${config.apiUrl}/repos/${config.repository}/pulls/${config.pullNumber}`, {
    etag: previous.pull_etag,
    token,
    timeoutMs: options.timeoutMs
  });
  const pull = pullResult.notModified ? previous.pull : safePull(pullResult.value);
  if (!pull) throw new Error("GitHub returned not-modified without a cached pull request");
  let checksResult = { notModified: false, value: null, metadata: { etag: null, rate_limit: pullResult.metadata.rate_limit } };
  let checks = null;
  if (pull.head_sha === config.expectedHeadSha) {
    checksResult = await githubGet(fetchImpl, `${config.apiUrl}/repos/${config.repository}/commits/${config.expectedHeadSha}/check-runs`, {
      etag: previous.checks_etag,
      token,
      timeoutMs: options.timeoutMs
    });
    checks = checksResult.notModified ? previous.checks : safeChecks(checksResult.value);
    if (!checks) throw new Error("GitHub returned not-modified without cached check runs");
  }
  const rateLimit = [pullResult.metadata.rate_limit, checksResult.metadata.rate_limit]
    .filter(Boolean)
    .sort((left, right) => (left.remaining ?? Infinity) - (right.remaining ?? Infinity))[0] ?? null;
  const metadata = {
    rate_limit: rateLimit,
    etagReused: pullResult.notModified && (pull.head_sha !== config.expectedHeadSha || checksResult.notModified)
  };
  const normalized = normalizedObservation(options.projectId, provider, config, pull, checks, metadata, observedAt);
  return {
    ...normalized,
    state: {
      schema_version: GITHUB_PROVIDER_STATE_SCHEMA,
      provider_id: provider.id,
      pull_etag: pullResult.metadata.etag ?? previous.pull_etag,
      checks_etag: pull.head_sha === config.expectedHeadSha
        ? checksResult.metadata.etag ?? previous.checks_etag
        : null,
      pull,
      checks,
      observation: normalized.observation
    },
    notModified: metadata.etagReused
  };
}

export async function startGitHubControlPlaneProvider(target, stateDirectory, journal, registry, provider, options = {}) {
  const project = await readJson(path.join(target, ".ai-org/project/project.json"));
  const config = validatedOptions(provider, target);
  await readWorkItem(target, config.workItemId);
  registry.set(githubControlPlaneProviderContract({ id: provider.id }));
  let stopped = false;
  let timer = null;
  let running = false;

  async function poll() {
    if (stopped || running) return null;
    running = true;
    try {
      const previous = await readState(stateDirectory, provider.id);
      const inspected = await inspectGitHubProvider(provider, {
        projectId: project.id,
        previous,
        fetchImpl: options.fetchImpl,
        fixture: options.fixture,
        baseDirectory: target,
        timeoutMs: options.timeoutMs
      });
      await atomicWrite(statePath(stateDirectory, provider.id), formatJson(inspected.state));
      if (!inspected.notModified) await journal.append(inspected.event);
      const degraded = inspected.observation.head_sha_matches !== true || inspected.observation.rate_limit?.remaining === 0;
      registry.update(provider.id, {
        status: degraded ? "degraded" : "ready",
        last_observed_at: inspected.observation.observed_at,
        degraded_reason: inspected.observation.head_sha_matches !== true
          ? `pull request head ${inspected.observation.observed_head_sha || "unknown"} does not match configured ${config.expectedHeadSha}`
          : inspected.observation.rate_limit?.remaining === 0
            ? "GitHub rate limit exhausted"
            : null
      });
      return inspected;
    } catch (error) {
      registry.update(provider.id, {
        status: "degraded",
        last_observed_at: new Date().toISOString(),
        degraded_reason: error.message,
        rate_limit: error.rateLimit ?? null
      });
      return null;
    } finally {
      running = false;
    }
  }

  return {
    providerId: provider.id,
    async start() {
      await poll();
      if (!config.fixturePath && !options.fixture) timer = setInterval(poll, config.pollIntervalMs);
      return this;
    },
    poll,
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      while (running) await new Promise((resolve) => setTimeout(resolve, 5));
      registry.update(provider.id, { status: "disabled", degraded_reason: "stopped" });
    }
  };
}

export async function captureGitHubEvidence(target, stateDirectory, options) {
  return withProjectMutationLock(target, async () => {
    const state = await readState(stateDirectory, options.providerId);
    const observation = state.observation;
    if (!observation) throw new Error(`No GitHub observation is available for provider ${options.providerId}`);
    if (observation.work_item_id !== options.workItemId) {
      throw new Error(`GitHub observation belongs to ${observation.work_item_id}, not ${options.workItemId}`);
    }
    await readWorkItem(target, options.workItemId);
    const revision = resolveGitRevision(target, options.revision);
    if (!observation.head_sha_matches || observation.observed_head_sha !== revision || observation.expected_head_sha !== revision) {
      throw new Error("GitHub evidence capture requires the configured, observed, and requested exact head SHA to match");
    }
    const recordedBy = String(options.actor ?? "human").trim() || "human";
    const agents = await readJson(path.join(target, ".ai-org/project/agents.json"));
    if (recordedBy !== "human" && !(agents.agents ?? []).some((agent) => agent.id === recordedBy && agent.active !== false)) {
      throw new Error(`Unknown evidence actor: ${recordedBy}`);
    }
    const timestamp = new Date().toISOString();
    const checks = observation.checks;
    const entry = {
      id: evidenceId(),
      work_item_id: options.workItemId,
      kind: "github",
      title: options.title ?? `GitHub PR #${observation.pull_number} checks`,
      outcome: observation.outcome,
      scope_revision: revision,
      recorded_at: timestamp,
      recorded_by: recordedBy,
      observed_at: observation.observed_at,
      summary: options.summary ?? `PR #${observation.pull_number} at ${revision}: ${observation.outcome}`,
      adapter: {
        id: "github-pr-checks-v1",
        version: "1",
        source_ref: `${observation.repository}#${observation.pull_number}@${revision}`
      },
      artifacts: [],
      details: {
        provider_id: observation.provider_id,
        repository: observation.repository,
        pull_number: observation.pull_number,
        pull_url: observation.pull_url,
        head_sha_matches: true,
        check_total: checks?.total ?? 0,
        check_successful: checks?.successful ?? 0,
        check_failed: checks?.failed ?? 0,
        check_pending: checks?.pending ?? 0,
        rate_limit_remaining: observation.rate_limit?.remaining ?? null,
        reviewed: true
      },
      expires_at: null,
      invalidated_at: null,
      invalidated_by: null,
      invalidation_reason: null,
      external_action_performed: false
    };
    return appendNormalizedEvidence(target, entry);
  });
}
