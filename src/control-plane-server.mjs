import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { TEMPLATE_VERSION } from "./constants.mjs";
import { inspectDeliverySummary } from "./daily-delivery.mjs";
import { readControlPlaneConfig } from "./control-plane-config.mjs";
import { buildConditionProjection } from "./control-plane-conditions.mjs";
import { renderControlPlaneDashboard } from "./control-plane-dashboard.mjs";
import {
  codexAppServerProviderContract,
  startCodexAppServerProvider
} from "./codex-app-server-provider.mjs";
import {
  buildHumanInbox,
  createHumanInboxGateway,
  generateInboxSessionSecret,
  InboxCommandError
} from "./control-plane-inbox.mjs";
import {
  githubControlPlaneProviderContract,
  startGitHubControlPlaneProvider
} from "./github-control-plane-provider.mjs";
import {
  createProviderRegistry,
  ingestProviderFixture,
  ingestRepositoryEvents,
  persistProviderRegistry,
  readProviderFixture,
  repositoryProviderContract,
  startRepositoryProvider
} from "./control-plane-providers.mjs";
import { buildObserverProjection } from "./observer.mjs";
import { buildLiveObserverProjection } from "./live-observer.mjs";
import { buildUsageBaselineFromRecords, readUsageTelemetryHistory } from "./usage-attribution.mjs";
import {
  acquireControlPlaneLease,
  openTelemetryJournal,
  readDaemonMetadata,
  resolveControlPlaneStateDirectory,
  writeDaemonMetadata
} from "./telemetry.mjs";
import { pathExists, readJson } from "./files.mjs";
import {
  normalizePrivateLanViewerHost,
  normalizePrivateViewerHost,
  TAILSCALE_IDENTITY_HEADER
} from "./private-network-viewer.mjs";
import { inspectLocalObserverService, localObservationContext } from "./local-observer-service.mjs";

export const CONTROL_PLANE_SNAPSHOT_SCHEMA = "temple.control-plane-snapshot/v1";

function jsonResponse(response, status, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function htmlResponse(response, body) {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-security-policy": "default-src 'self'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  });
  response.end(body);
}

function sendSseRecord(response, record) {
  response.write(`id: ${record.templecursor}\n`);
  response.write(`data: ${JSON.stringify(record)}\n\n`);
}

function numericCursor(value) {
  if (value === null || value === undefined || value === "") return 0;
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Last-Event-ID must be a non-negative integer");
  return cursor;
}

export function controlPlaneProviderContracts(config) {
  const contracts = [repositoryProviderContract()];
  const codexProviders = config.providers.filter((provider) => provider.kind === "codex-app-server");
  if (codexProviders.length === 0) {
    contracts.push(codexAppServerProviderContract({ status: "disabled", degradedReason: "explicit opt-in required" }));
  } else {
    for (const provider of codexProviders) {
      contracts.push(codexAppServerProviderContract({
        id: provider.id,
        status: "disabled",
        degradedReason: provider.enabled ? "daemon not started" : "disabled by project configuration"
      }));
    }
  }
  for (const provider of config.providers.filter((entry) => entry.kind === "github")) {
    contracts.push(githubControlPlaneProviderContract({
      id: provider.id,
      status: "disabled",
      degradedReason: provider.enabled ? "daemon not started" : "disabled by project configuration"
    }));
  }
  return contracts;
}

function isLoopbackHost(hostHeader, port) {
  if (typeof hostHeader !== "string") return false;
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(hostHeader.toLowerCase());
}

export function classifyControlPlaneRequest(headers, port, privateViewerHost = null) {
  if (isLoopbackHost(headers?.host, port)) return { kind: "loopback", identity: null };
  if (!privateViewerHost) return { kind: "untrusted", identity: null };
  const expectedHost = normalizePrivateViewerHost(privateViewerHost);
  const requestHost = String(headers?.host ?? "").trim().toLowerCase();
  const identity = String(headers?.[TAILSCALE_IDENTITY_HEADER] ?? "").trim();
  if (requestHost === expectedHost && identity) {
    return { kind: "private-viewer", identity, transport: "tailscale-serve" };
  }
  return { kind: "untrusted", identity: null };
}

export function privateViewerSnapshot(snapshot, identity, transport = "tailscale-serve") {
  const { daemon: _daemon, inbox: _inbox, recent_events: _recentEvents, ...rest } = snapshot;
  const safe = structuredClone(rest);
  if (safe.usage?.source) delete safe.usage.source.state_directory;
  for (const projection of [safe.observer, safe.live_observer]) {
    for (const item of projection?.work?.items ?? []) {
      if (!item.delivery_attention) continue;
      const attention = item.delivery_attention;
      attention.owner = { position_id: attention.owner.position_id, agent_id: attention.owner.agent_id, source: attention.owner.source };
      attention.missing_conditions = attention.missing_conditions.map(entry => ({ kind: entry.kind,
        description: "A recorded condition requires the responsible owner's attention.", next_action: "Ask the responsible owner to inspect the local delivery details." }));
      attention.next_action = "Inspect the recorded delivery state with the responsible owner.";
    }
  }
  const organization = safe.observer?.organization;
  if (organization) {
    delete organization.principals;
    delete organization.sponsorships;
    delete organization.authority_grants;
    if (organization.bootstrap_owner) {
      organization.bootstrap_owner = { status: organization.bootstrap_owner.status, principal_id: "redacted" };
    }
    if (organization.recovery) {
      organization.recovery = {
        status: organization.recovery.status,
        threshold: organization.recovery.threshold,
        trustee_count: organization.recovery.trustee_principal_ids?.length ?? 0,
        principal_ids_redacted: true
      };
    }
    organization.private_view_redactions = ["principals", "sponsorships", "authority-grants", "recovery-trustees"];
  }
  return {
    ...safe,
    authority: {
      ...safe.authority,
      viewer: "private-read-only",
      mutations_available: false,
      raw_events_available: false
    },
    private_viewer: {
      schema_version: "temple.private-viewer/v1",
      transport,
      identity_present: Boolean(identity),
      read_only: true
    }
  };
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function readJsonRequest(request, maximumBytes = 65536) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw new InboxCommandError("Inbox request exceeds the 64 KiB limit", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InboxCommandError("Inbox request body must be valid JSON");
  }
}

function assertGatewayRequest(request, origin, sessionSecret, body) {
  if (request.headers.origin !== origin) throw new InboxCommandError("Inbox command origin is not the active loopback server", 403);
  if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new InboxCommandError("Inbox commands require application/json", 415);
  }
  if (!constantTimeEqual(request.headers["x-temple-session"], sessionSecret)) {
    throw new InboxCommandError("Inbox session secret is missing or invalid", 403);
  }
  if (!constantTimeEqual(request.headers["x-idempotency-key"], body.idempotency_key)) {
    throw new InboxCommandError("Inbox idempotency header and body do not match", 400);
  }
}

export async function buildControlPlaneSnapshot(target, journal, registry, options = {}) {
  const [observer, daemon, taskRegistry] = await Promise.all([
    buildObserverProjection(target),
    options.stateDirectory ? readDaemonMetadata(options.stateDirectory) : null,
    readJson(path.join(target, ".ai-org/project/tasks.json"))
  ]);
  const config = options.config ?? await readControlPlaneConfig(target);
  const [liveObserver, conditions, inbox] = await Promise.all([
    buildLiveObserverProjection(target, observer, journal, registry, { now: options.now }),
    buildConditionProjection(target, observer, journal, registry, config, {
      stateDirectory: options.stateDirectory,
      persist: options.persistConditions,
      now: options.now
    }),
    options.stateDirectory
      ? buildHumanInbox(target, options.stateDirectory, options.codexProvider, {
          agentCommands: config.agent_commands,
          journal
        })
      : null
  ]);
  const journalSnapshot = journal.snapshot();
  const retainedRecords = journal.readAfter(0).records;
  const usageHistory = await readUsageTelemetryHistory(options.stateDirectory ?? null, retainedRecords, {
    projectId: observer.project.id
  });
  let observationContext = options.observationContext ?? null;
  if (!observationContext && options.stateDirectory) {
    const status = await inspectLocalObserverService(target, { stateDirectory: options.stateDirectory });
    observationContext = {
      mode: status.observation_mode,
      started_at: status.observation_started_at,
      continuous_expected: status.continuous_observation_expected,
      platform: process.platform,
      service_status: status.service_status
    };
  }
  const usage = buildUsageBaselineFromRecords(observer.project, usageHistory.records, {
    stateDirectory: options.stateDirectory ?? null,
    workItems: observer.work.items,
    tasks: taskRegistry.tasks ?? [],
    providers: registry.list(),
    history: usageHistory.history,
    activeJournal: usageHistory.activeJournal,
    observationContext
  });
  const eventWindow = journal.readAfter(Math.max(0, journalSnapshot.last_cursor - (options.eventLimit ?? 100)));
  return {
    schema_version: CONTROL_PLANE_SNAPSHOT_SCHEMA,
    generated_at: new Date().toISOString(),
    project: observer.project,
    authority: {
      canonical: ".ai-org/",
      telemetry: "local-generated",
      views: "disposable",
      telemetry_satisfies_gates: false
    },
    daemon,
    journal: journalSnapshot,
    providers: registry.document(),
    observer,
    live_observer: liveObserver,
    conditions,
    usage,
    inbox,
    recent_events: eventWindow.records,
    canonical_state_changed: false,
    external_action_performed: false
  };
}

async function listen(server, host, port) {
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

async function closeHttpServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

export async function startControlPlaneServer(target, options = {}) {
  const projectRoot = path.resolve(target);
  const config = await readControlPlaneConfig(projectRoot);
  const configuredCodex = config.providers.find((provider) => provider.kind === "codex-app-server" && provider.enabled);
  const codexRequested = Boolean(options.enableCodex || configuredCodex);
  const effectiveObservationMode = options.observationMode ?? (codexRequested ? "on-demand" : "off");
  if (effectiveObservationMode !== "off" && !codexRequested) {
    throw new Error(`${effectiveObservationMode} observation requires an enabled Codex Provider`);
  }
  const codexEnabled = effectiveObservationMode !== "off" && codexRequested;
  const host = options.host ?? config.server.host;
  const port = options.port ?? config.server.port;
  const privateViewerHost = options.privateViewerHost
    ? normalizePrivateViewerHost(options.privateViewerHost)
    : null;
  const lanViewerHost = options.lanViewerHost
    ? normalizePrivateLanViewerHost(options.lanViewerHost)
    : null;
  const lanViewerPort = options.lanViewerPort ?? 41741;
  if (host !== "127.0.0.1") throw new Error("Phase 3 control plane may bind only to 127.0.0.1");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Control-plane port must be 0 to 65535");
  if (!Number.isInteger(lanViewerPort) || lanViewerPort < 0 || lanViewerPort > 65535) {
    throw new Error("LAN viewer port must be 0 to 65535");
  }
  const stateDirectory = resolveControlPlaneStateDirectory(
    projectRoot,
    options.stateDirectory ?? config.state_directory
  );
  const lease = await acquireControlPlaneLease(stateDirectory);
  let journal = null;
  let repositoryProvider = null;
  let codexProvider = null;
  let codexStartup = null;
  const githubProviders = [];
  let server = null;
  let lanViewerServer = null;
  let lanViewerUrl = null;
  let actualLanViewerPort = null;
  let serverOrigin = null;
  let observationContext = null;
  const clients = new Set();
  const startedAt = new Date().toISOString();

  try {
    journal = await openTelemetryJournal(stateDirectory, {
      maxEvents: config.retention.max_events,
      privacy: config.privacy
    });
    observationContext = await localObservationContext(projectRoot, stateDirectory, {
      mode: effectiveObservationMode,
      enableCodex: codexEnabled,
      startedAt
    });
    const registry = createProviderRegistry(controlPlaneProviderContracts(config));
    repositoryProvider = startRepositoryProvider(projectRoot, journal, registry, {
      intervalMs: options.repositoryIntervalMs
    });
    await repositoryProvider.start();
    if (codexEnabled) {
      codexProvider = await startCodexAppServerProvider(projectRoot, journal, registry, {
        ...(configuredCodex?.options ?? {}),
        providerId: configuredCodex?.id,
        command: options.codexCommand ?? configuredCodex?.options?.command,
        commandArgs: options.codexCommandArgs ?? configuredCodex?.options?.command_args,
        resumeThreads: options.resumeCodexThreads ?? configuredCodex?.options?.resume_threads ?? true,
        historyTurnLimit: options.codexHistoryTurnLimit ?? configuredCodex?.options?.history_turn_limit,
        historyItemLimit: options.codexHistoryItemLimit ?? configuredCodex?.options?.history_item_limit
      });
    }
    for (const githubConfig of config.providers.filter((provider) => provider.kind === "github" && provider.enabled)) {
      const provider = await startGitHubControlPlaneProvider(
        projectRoot,
        stateDirectory,
        journal,
        registry,
        githubConfig,
        options.githubProviderOptions?.[githubConfig.id] ?? {}
      );
      await provider.start();
      githubProviders.push(provider);
    }
    if (options.fixturePath) {
      const fixture = await readProviderFixture(options.fixturePath);
      await ingestProviderFixture(fixture, journal, registry);
    }
    await persistProviderRegistry(stateDirectory, registry);

    const project = await readJson(path.join(projectRoot, ".ai-org/project/project.json"));
    const sessionSecret = generateInboxSessionSecret();
    const inboxGateway = createHumanInboxGateway({
      target: projectRoot,
      stateDirectory,
      codexProvider,
      privacy: config.privacy,
      agentCommands: config.agent_commands,
      journal
    });

    const handleRequest = async (request, response, access) => {
      try {
        const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
        if (access.kind === "untrusted") {
          jsonResponse(response, 403, { error: "Control-plane Host must be the active loopback listener" });
          return;
        }
        if (access.kind === "private-viewer" && request.method !== "GET") {
          jsonResponse(response, 405, { error: "Private Dashboard viewer is read-only" });
          return;
        }
        const deliveryMatch = /^\/api\/v1\/work-items\/(WI-(?:[0-9]{4,}|[0-9]{8}-[A-F0-9]{10}))\/delivery$/.exec(requestUrl.pathname);
        if (deliveryMatch && request.method === "GET") {
          if (access.kind !== "loopback") {
            jsonResponse(response, 403, { error: "Delivery detail is available locally only" });
          } else {
            const summary = await inspectDeliverySummary(projectRoot, deliveryMatch[1]);
            jsonResponse(response, summary.availability === "work-item-missing" ? 404 : 200, summary);
          }
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/healthz") {
          jsonResponse(response, 200, {
            status: "ok",
            schema_version: "temple.control-plane-health/v1",
            project_id: project.id,
            journal: journal.snapshot()
          });
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/favicon.ico") {
          response.writeHead(204, { "cache-control": "public, max-age=86400" });
          response.end();
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/v1/snapshot") {
          await persistProviderRegistry(stateDirectory, registry);
          const snapshot = await buildControlPlaneSnapshot(projectRoot, journal, registry, {
            stateDirectory,
            config,
            persistConditions: true,
            codexProvider,
            observationContext
          });
          jsonResponse(response, 200, access.kind === "private-viewer"
            ? privateViewerSnapshot(snapshot, access.identity, access.transport)
            : snapshot);
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/v1/events") {
          const cursor = numericCursor(request.headers["last-event-id"] ?? requestUrl.searchParams.get("after"));
          const replay = journal.readAfter(cursor);
          response.writeHead(200, {
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "content-type": "text/event-stream; charset=utf-8",
            "x-accel-buffering": "no",
            "x-content-type-options": "nosniff"
          });
          response.write("retry: 1000\n\n");
          if (access.kind === "private-viewer") {
            const refresh = (record) => {
              response.write(`id: ${record.templecursor}\n`);
              response.write("event: temple.refresh\n");
              response.write(`data: ${JSON.stringify({ cursor: record.templecursor })}\n\n`);
            };
            const latest = replay.records.at(-1);
            if (latest) refresh(latest);
            const unsubscribe = journal.subscribe(refresh);
            const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15000);
            const close = () => {
              clearInterval(heartbeat);
              unsubscribe();
              clients.delete(close);
            };
            clients.add(close);
            request.on("close", close);
            return;
          }
          if (replay.reset_required) {
            response.write("event: temple.snapshot\n");
            response.write(`data: ${JSON.stringify(await buildControlPlaneSnapshot(projectRoot, journal, registry, {
              stateDirectory,
              config,
              persistConditions: true,
              codexProvider,
              observationContext
            }))}\n\n`);
          }
          for (const record of replay.records) sendSseRecord(response, record);
          const unsubscribe = journal.subscribe((record) => sendSseRecord(response, record));
          const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15000);
          const close = () => {
            clearInterval(heartbeat);
            unsubscribe();
            clients.delete(close);
          };
          clients.add(close);
          request.on("close", close);
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/") {
          htmlResponse(response, renderControlPlaneDashboard(project.name, access.kind === "private-viewer"
            ? { viewMode: "private-read-only" }
            : { sessionSecret, inboxEnabled: true }));
          return;
        }
        if (request.method === "GET" && requestUrl.pathname === "/api/v1/inbox") {
          if (access.kind === "private-viewer") {
            jsonResponse(response, 403, { error: "Private Dashboard viewer does not expose the Human Inbox" });
            return;
          }
          jsonResponse(response, 200, await buildHumanInbox(projectRoot, stateDirectory, codexProvider, {
            agentCommands: config.agent_commands,
            journal
          }));
          return;
        }
        const inboxRoutes = new Map([
          ["/api/v1/inbox/runtime-permission", "runtime-permission"],
          ["/api/v1/inbox/business-fact", "business-fact"],
          ["/api/v1/inbox/business-incorporation", "business-incorporation"],
          ["/api/v1/inbox/governance-approval", "governance-approval"],
          ["/api/v1/inbox/agent-command", "agent-command"]
        ]);
        if (request.method === "POST" && inboxRoutes.has(requestUrl.pathname)) {
          const body = await readJsonRequest(request);
          assertGatewayRequest(request, serverOrigin, sessionSecret, body);
          const result = await inboxGateway.submit(inboxRoutes.get(requestUrl.pathname), body);
          jsonResponse(response, 200, result);
          return;
        }
        if (request.method !== "GET") {
          jsonResponse(response, 405, { error: "Phase 3C accepts mutations only through bounded Human Inbox routes" });
          return;
        }
        jsonResponse(response, 404, { error: "Not found" });
      } catch (error) {
        if (!response.headersSent) jsonResponse(response, error.statusCode ?? 400, { error: error.message });
        else response.destroy(error);
      }
    };

    server = http.createServer((request, response) => {
      const address = server.address();
      const requestPort = typeof address === "object" && address ? address.port : port;
      return handleRequest(request, response, classifyControlPlaneRequest(request.headers, requestPort, privateViewerHost));
    });

    await listen(server, host, port);
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    const url = `http://${host}:${actualPort}`;
    serverOrigin = url;
    if (lanViewerHost) {
      lanViewerServer = http.createServer((request, response) => handleRequest(request, response, {
        kind: "private-viewer",
        identity: null,
        transport: "private-lan"
      }));
      await listen(lanViewerServer, lanViewerHost, lanViewerPort);
      const lanAddress = lanViewerServer.address();
      actualLanViewerPort = typeof lanAddress === "object" && lanAddress ? lanAddress.port : lanViewerPort;
      lanViewerUrl = `http://${lanViewerHost}:${actualLanViewerPort}`;
    }
    await writeDaemonMetadata(stateDirectory, {
      host,
      port: actualPort,
      url,
      projectRoot,
      startedAt,
      version: TEMPLATE_VERSION
    });
    if (codexProvider) {
      codexStartup = codexProvider.start().catch((error) => {
        registry.update(codexProvider.providerId, {
          status: "degraded",
          degraded_reason: error.message
        });
        return null;
      });
    }

    let closed = false;
    return {
      url,
      host,
      port: actualPort,
      stateDirectory,
      journal,
      registry,
      codexProvider,
      codexStartup,
      githubProviders,
      sessionSecret,
      privateViewerHost,
      lanViewerHost,
      lanViewerPort: actualLanViewerPort,
      lanViewerUrl,
      async close() {
        if (closed) return;
        closed = true;
        for (const close of [...clients]) close();
        if (codexProvider) await codexProvider.stop();
        if (codexStartup) await codexStartup.catch(() => {});
        for (const provider of githubProviders) await provider.stop();
        await repositoryProvider.stop();
        await persistProviderRegistry(stateDirectory, registry);
        if (lanViewerServer) await closeHttpServer(lanViewerServer);
        await closeHttpServer(server);
        await journal.close();
        await fs.unlink(path.join(stateDirectory, "daemon.json")).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        await lease.release();
      }
    };
  } catch (error) {
    if (codexProvider) await codexProvider.stop().catch(() => {});
    for (const provider of githubProviders) await provider.stop().catch(() => {});
    if (repositoryProvider) await repositoryProvider.stop().catch(() => {});
    if (lanViewerServer) await closeHttpServer(lanViewerServer).catch(() => {});
    if (server) await closeHttpServer(server).catch(() => {});
    if (journal) await journal.close().catch(() => {});
    await lease.release().catch(() => {});
    throw error;
  }
}

export async function inspectControlPlane(target, options = {}) {
  const projectRoot = path.resolve(target);
  const config = await readControlPlaneConfig(projectRoot);
  const stateDirectory = resolveControlPlaneStateDirectory(projectRoot, options.stateDirectory ?? config.state_directory);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: config.retention.max_events,
    privacy: config.privacy,
    readOnly: true
  });
  const registry = createProviderRegistry(controlPlaneProviderContracts(config));
  const providerPath = path.join(stateDirectory, "providers.json");
  if (await pathExists(providerPath)) {
    const persisted = await readJson(providerPath);
    for (const provider of persisted.providers ?? []) registry.set(provider);
  }
  if (!(await readDaemonMetadata(stateDirectory))) {
    for (const provider of registry.list().filter((entry) => ["codex-app-server", "github"].includes(entry.kind) && entry.status === "ready")) {
      registry.update(provider.id, {
        status: "offline",
        degraded_reason: "control-plane daemon is not running; persisted live status is stale"
      });
    }
  }
  const snapshot = await buildControlPlaneSnapshot(projectRoot, journal, registry, {
    stateDirectory,
    config,
    persistConditions: false,
    codexProvider: null
  });
  await journal.close();
  return { stateDirectory, snapshot };
}

export async function ingestControlPlaneFixture(target, fixturePath, options = {}) {
  const projectRoot = path.resolve(target);
  const config = await readControlPlaneConfig(projectRoot);
  const stateDirectory = resolveControlPlaneStateDirectory(projectRoot, options.stateDirectory ?? config.state_directory);
  const lease = await acquireControlPlaneLease(stateDirectory);
  try {
    const journal = await openTelemetryJournal(stateDirectory, {
      maxEvents: config.retention.max_events,
      privacy: config.privacy
    });
    const registry = createProviderRegistry(controlPlaneProviderContracts(config));
    const providerPath = path.join(stateDirectory, "providers.json");
    if (await pathExists(providerPath)) {
      const persisted = await readJson(providerPath);
      for (const provider of persisted.providers ?? []) registry.set(provider);
    }
    await ingestRepositoryEvents(projectRoot, journal, registry);
    const result = await ingestProviderFixture(await readProviderFixture(fixturePath), journal, registry);
    await persistProviderRegistry(stateDirectory, registry);
    const snapshot = await buildControlPlaneSnapshot(projectRoot, journal, registry, {
      stateDirectory,
      config,
      persistConditions: true,
      codexProvider: null
    });
    await journal.close();
    return { stateDirectory, result, snapshot };
  } finally {
    await lease.release();
  }
}

export async function rebuildControlPlane(target, options = {}) {
  const projectRoot = path.resolve(target);
  const config = await readControlPlaneConfig(projectRoot);
  const stateDirectory = resolveControlPlaneStateDirectory(projectRoot, options.stateDirectory ?? config.state_directory);
  const lease = await acquireControlPlaneLease(stateDirectory);
  try {
    const journalPath = path.join(stateDirectory, "journal", "events.jsonl");
    let archivePath = null;
    if (await pathExists(journalPath)) {
      const archiveDirectory = path.join(stateDirectory, "archive");
      await fs.mkdir(archiveDirectory, { recursive: true });
      archivePath = path.join(archiveDirectory, `events-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.jsonl`);
      await fs.rename(journalPath, archivePath);
    }
    const journal = await openTelemetryJournal(stateDirectory, {
      maxEvents: config.retention.max_events,
      privacy: config.privacy
    });
    const registry = createProviderRegistry(controlPlaneProviderContracts(config));
    const repository = await ingestRepositoryEvents(projectRoot, journal, registry);
    await persistProviderRegistry(stateDirectory, registry);
    const snapshot = await buildControlPlaneSnapshot(projectRoot, journal, registry, {
      stateDirectory,
      config,
      persistConditions: true,
      codexProvider: null
    });
    await journal.close();
    return { stateDirectory, archivePath, repository, snapshot };
  } finally {
    await lease.release();
  }
}
