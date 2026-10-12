import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite, formatJson, pathExists, readJson, sha256 } from "./files.mjs";

export const PROVIDER_CONTRACT_SCHEMA = "temple.provider-contract/v1";
export const PROVIDER_REGISTRY_SCHEMA = "temple.provider-registry/v1";
export const PROVIDER_CAPABILITY_STATES = ["supported", "unsupported", "unknown"];
export const PROVIDER_CAPABILITIES = [
  "enumeration",
  "history_snapshot",
  "live_events",
  "plan_summary",
  "diff_summary",
  "token_usage",
  "runtime_approval",
  "thread_launch",
  "thread_resume"
];

function capabilityMap(overrides = {}) {
  return Object.fromEntries(
    PROVIDER_CAPABILITIES.map((capability) => [capability, overrides[capability] ?? "unsupported"])
  );
}

export function validateProviderContract(provider) {
  const errors = [];
  if (provider?.schema_version !== PROVIDER_CONTRACT_SCHEMA) errors.push("invalid provider schema_version");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(provider?.id ?? "")) errors.push("invalid provider ID");
  if (!provider?.kind || typeof provider.kind !== "string") errors.push("provider kind is required");
  if (!["ready", "degraded", "offline", "disabled"].includes(provider?.status)) errors.push("invalid provider status");
  if (!provider?.version || typeof provider.version !== "string") errors.push("provider version is required");
  for (const capability of PROVIDER_CAPABILITIES) {
    if (!PROVIDER_CAPABILITY_STATES.includes(provider?.capabilities?.[capability])) {
      errors.push(`invalid provider capability ${capability}`);
    }
  }
  const unknown = Object.keys(provider?.capabilities ?? {}).filter((key) => !PROVIDER_CAPABILITIES.includes(key));
  if (unknown.length > 0) errors.push(`unknown provider capabilities: ${unknown.join(", ")}`);
  return { valid: errors.length === 0, errors };
}

export function repositoryProviderContract() {
  return {
    schema_version: PROVIDER_CONTRACT_SCHEMA,
    id: "repository",
    kind: "repository",
    version: "1",
    status: "ready",
    capabilities: capabilityMap({
      enumeration: "supported",
      history_snapshot: "supported",
      live_events: "supported"
    }),
    last_observed_at: null,
    degraded_reason: null
  };
}

export function fixtureProviderContract(id = "fixture") {
  return {
    schema_version: PROVIDER_CONTRACT_SCHEMA,
    id,
    kind: "fixture",
    version: "1",
    status: "ready",
    capabilities: capabilityMap({
      enumeration: "supported",
      history_snapshot: "supported",
      live_events: "supported",
      plan_summary: "supported",
      diff_summary: "supported",
      token_usage: "supported",
      runtime_approval: "supported"
    }),
    last_observed_at: null,
    degraded_reason: null
  };
}

export function createProviderRegistry(initial = []) {
  const providers = new Map();
  for (const provider of initial) {
    const validation = validateProviderContract(provider);
    if (!validation.valid) throw new Error(`Invalid provider ${provider?.id ?? "unknown"}: ${validation.errors.join("; ")}`);
    providers.set(provider.id, structuredClone(provider));
  }
  return {
    get(id) {
      const provider = providers.get(id);
      return provider ? structuredClone(provider) : null;
    },
    set(provider) {
      const validation = validateProviderContract(provider);
      if (!validation.valid) throw new Error(`Invalid provider ${provider?.id ?? "unknown"}: ${validation.errors.join("; ")}`);
      providers.set(provider.id, structuredClone(provider));
      return this.get(provider.id);
    },
    update(id, patch) {
      const current = providers.get(id);
      if (!current) throw new Error(`Provider not found: ${id}`);
      return this.set({ ...current, ...patch, capabilities: patch.capabilities ?? current.capabilities });
    },
    list() {
      return [...providers.values()].map((provider) => structuredClone(provider)).sort((left, right) => left.id.localeCompare(right.id));
    },
    document() {
      return {
        schema_version: PROVIDER_REGISTRY_SCHEMA,
        generated_at: new Date().toISOString(),
        providers: this.list()
      };
    }
  };
}

export async function persistProviderRegistry(stateDirectory, registry) {
  const providerPath = path.join(stateDirectory, "providers.json");
  await atomicWrite(providerPath, formatJson(registry.document()));
  return providerPath;
}

function providerEventType(eventType) {
  const normalized = String(eventType ?? "unknown")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `org.temple.repository.${normalized || "unknown"}.v1`;
}

function repositoryEventData(event, lineNumber) {
  return {
    ...event,
    canonical: true,
    legacy_line: lineNumber
  };
}

async function canonicalEventLines(target) {
  const eventPath = path.join(target, ".ai-org/events/events.jsonl");
  if (!(await pathExists(eventPath))) return [];
  const content = await fs.readFile(eventPath, "utf8");
  return content.split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [{ line, lineNumber: index + 1, event: JSON.parse(line) }];
    } catch (error) {
      throw new Error(`Invalid canonical event JSON at line ${index + 1}: ${error.message}`);
    }
  });
}

export async function ingestRepositoryEvents(target, journal, registry) {
  const project = await readJson(path.join(target, ".ai-org/project/project.json"));
  const source = `urn:temple:repository:${encodeURIComponent(project.id)}`;
  const lines = await canonicalEventLines(target);
  let appended = 0;
  let duplicates = 0;
  for (const { line, lineNumber, event } of lines) {
    const result = await journal.append({
      id: `line-${lineNumber}-${sha256(line).slice(0, 20)}`,
      source,
      type: providerEventType(event.event_type),
      subject: event.work_item_id ? `project/${project.id}/work-item/${event.work_item_id}` : `project/${project.id}`,
      time: event.timestamp ?? new Date().toISOString(),
      data: repositoryEventData(event, lineNumber)
    });
    if (result.duplicate) duplicates += 1;
    else appended += 1;
  }
  const observedAt = new Date().toISOString();
  registry.update("repository", {
    status: "ready",
    last_observed_at: observedAt,
    degraded_reason: null
  });
  return { appended, duplicates, observed_at: observedAt, source_events: lines.length };
}

export function startRepositoryProvider(target, journal, registry, options = {}) {
  const intervalMs = options.intervalMs ?? 750;
  let stopped = false;
  let running = false;
  let timer = null;

  async function poll() {
    if (stopped || running) return;
    running = true;
    try {
      await ingestRepositoryEvents(target, journal, registry);
    } catch (error) {
      registry.update("repository", {
        status: "degraded",
        last_observed_at: new Date().toISOString(),
        degraded_reason: error.message
      });
    } finally {
      running = false;
    }
  }

  return {
    async start() {
      await poll();
      timer = setInterval(poll, intervalMs);
      return this;
    },
    async poll() {
      return poll();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      while (running) await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
}

export async function readProviderFixture(fixturePath) {
  const fixture = await readJson(fixturePath);
  if (fixture?.schema_version !== "temple.provider-fixture/v1") {
    throw new Error("Provider fixture schema_version must be temple.provider-fixture/v1");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(fixture.provider_id ?? "")) throw new Error("Provider fixture ID is invalid");
  if (!Array.isArray(fixture.events)) throw new Error("Provider fixture events must be an array");
  return fixture;
}

export async function ingestProviderFixture(fixture, journal, registry) {
  const providerId = fixture.provider_id;
  if (!registry.get(providerId)) registry.set(fixtureProviderContract(providerId));
  let appended = 0;
  let duplicates = 0;
  for (const event of fixture.events) {
    const result = await journal.append(event, { observedAt: fixture.observed_at });
    if (result.duplicate) duplicates += 1;
    else appended += 1;
  }
  registry.update(providerId, {
    status: "ready",
    last_observed_at: fixture.observed_at ?? new Date().toISOString(),
    degraded_reason: null
  });
  return { provider_id: providerId, appended, duplicates };
}
