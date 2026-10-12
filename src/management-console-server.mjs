import { watch } from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import {
  classifyControlPlaneRequest,
  inspectControlPlane,
  privateViewerSnapshot
} from "./control-plane-server.mjs";
import { renderControlPlaneDashboard } from "./control-plane-dashboard.mjs";
import { inspectDeliverySummary } from "./daily-delivery.mjs";
import { pathExists, readJson } from "./files.mjs";
import { normalizePrivateLanViewerHost } from "./private-network-viewer.mjs";
import { readControlPlaneConfig } from "./control-plane-config.mjs";
import { resolveControlPlaneStateDirectory } from "./telemetry.mjs";

export const MANAGEMENT_CONSOLE_SCHEMA = "temple.management-console/v1";

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

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  });
}

function managementConsoleObserver(observer) {
  if (!observer) return observer;
  return {
    schema_version: observer.schema_version,
    generated_at: observer.generated_at,
    project: observer.project,
    organization: observer.organization,
    execution_routing: observer.execution_routing,
    canonical_state_changed: observer.canonical_state_changed,
    external_action_performed: observer.external_action_performed
  };
}

function managementConsoleTask(task) {
  const { items: _items, ...summary } = task;
  return summary;
}

function managementConsoleLiveObserver(liveObserver) {
  if (!liveObserver) return liveObserver;
  const tasks = liveObserver.tasks
    ? (({ items: _items, ...summary }) => summary)(liveObserver.tasks)
    : liveObserver.tasks;
  const work = liveObserver.work
    ? {
        ...liveObserver.work,
        items: (liveObserver.work.items ?? []).map((item) => ({
          ...item,
          tasks: (item.tasks ?? []).map(managementConsoleTask)
        }))
      }
    : liveObserver.work;
  return { ...liveObserver, tasks, work };
}

export function managementConsoleSnapshot(snapshot) {
  const {
    daemon: _daemon,
    inbox: _inbox,
    recent_events: _recentEvents,
    observer,
    live_observer: liveObserver,
    ...rest
  } = snapshot;
  const safe = structuredClone({
    ...rest,
    observer: managementConsoleObserver(observer),
    live_observer: managementConsoleLiveObserver(liveObserver)
  });
  if (safe.usage?.source) delete safe.usage.source.state_directory;
  return {
    ...safe,
    authority: {
      ...safe.authority,
      viewer: "local-read-only",
      mutations_available: false,
      raw_events_available: false
    },
    management_console: {
      schema_version: MANAGEMENT_CONSOLE_SCHEMA,
      optional: true,
      read_only: true,
      usage_collection_active: snapshot.usage?.source?.capture_health?.provider_status === "ready"
    }
  };
}

export async function startManagementConsoleServer(target, options = {}) {
  const projectRoot = path.resolve(target);
  const config = await readControlPlaneConfig(projectRoot);
  const project = await readJson(path.join(projectRoot, ".ai-org/project/project.json"));
  const stateDirectory = resolveControlPlaneStateDirectory(
    projectRoot,
    options.stateDirectory ?? config.state_directory
  );
  const host = options.host ?? config.server.host;
  const port = options.port ?? config.server.port;
  const privateViewerHost = options.privateViewerHost ?? null;
  const lanViewerHost = options.lanViewerHost
    ? normalizePrivateLanViewerHost(options.lanViewerHost)
    : null;
  const lanViewerPort = options.lanViewerPort ?? 41741;
  if (host !== "127.0.0.1") throw new Error("Management Console may bind only to 127.0.0.1");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Console port must be 0 to 65535");
  if (!Number.isInteger(lanViewerPort) || lanViewerPort < 0 || lanViewerPort > 65535) {
    throw new Error("LAN viewer port must be 0 to 65535");
  }

  const snapshotMaxAgeMs = options.snapshotMaxAgeMs ?? 30000;
  const clients = new Set();
  const watchers = new Map();
  let cache = null;
  let cachedAt = 0;
  let loading = null;
  let refreshRevision = 0;
  let invalidated = true;
  let invalidateTimer = null;
  let server = null;
  let lanServer = null;

  const sendRefresh = () => {
    refreshRevision += 1;
    invalidated = true;
    for (const client of clients) {
      client.write(`id: ${refreshRevision}\n`);
      client.write("event: temple.refresh\n");
      client.write(`data: ${JSON.stringify({ revision: refreshRevision })}\n\n`);
    }
  };
  const invalidate = () => {
    if (invalidateTimer) return;
    invalidateTimer = setTimeout(() => {
      invalidateTimer = null;
      sendRefresh();
    }, 100);
  };

  const watchPath = async (candidate) => {
    if (watchers.has(candidate) || !(await pathExists(candidate))) return;
    try {
      const watcher = watch(candidate, { persistent: false }, invalidate);
      watcher.on("error", () => {
        watcher.close();
        watchers.delete(candidate);
      });
      watchers.set(candidate, watcher);
    } catch {
      // A missing or unsupported watch target is retried after the next snapshot.
    }
  };
  const attachWatchers = async () => {
    const targets = [
      path.join(projectRoot, ".ai-org/events"),
      path.join(projectRoot, ".ai-org/project"),
      path.join(projectRoot, ".ai-org/work-items"),
      path.join(projectRoot, ".ai-org/learning"),
      path.join(stateDirectory, "journal"),
      path.join(stateDirectory, "archive"),
      stateDirectory
    ];
    await Promise.all(targets.map(watchPath));
  };
  await attachWatchers();

  const snapshot = async () => {
    const now = Date.now();
    if (cache && !invalidated && now - cachedAt < snapshotMaxAgeMs) return cache;
    if (loading) return loading;
    const observedRevision = refreshRevision;
    loading = (async () => {
      const result = await inspectControlPlane(projectRoot, { stateDirectory });
      cache = result.snapshot;
      cachedAt = Date.now();
      invalidated = refreshRevision !== observedRevision;
      await attachWatchers();
      return cache;
    })();
    try {
      return await loading;
    } finally {
      loading = null;
    }
  };

  const handle = async (request, response, access) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      if (access.kind === "untrusted") {
        jsonResponse(response, 403, { error: "Console Host must be the active listener" });
        return;
      }
      if (request.method !== "GET") {
        jsonResponse(response, 405, { error: "Management Console is read-only" });
        return;
      }
      const deliveryMatch = /^\/api\/v1\/work-items\/(WI-(?:[0-9]{4,}|[0-9]{8}-[A-F0-9]{10}))\/delivery$/.exec(requestUrl.pathname);
      if (deliveryMatch) {
        if (access.kind !== "loopback") {
          jsonResponse(response, 403, { error: "Delivery detail is available locally only" });
        } else {
          const summary = await inspectDeliverySummary(projectRoot, deliveryMatch[1]);
          jsonResponse(response, summary.availability === "work-item-missing" ? 404 : 200, summary);
        }
        return;
      }
      if (requestUrl.pathname === "/healthz") {
        jsonResponse(response, 200, {
          status: "ok",
          schema_version: MANAGEMENT_CONSOLE_SCHEMA,
          project_id: project.id,
          optional: true,
          read_only: true,
          writer_lease_acquired: false,
          provider_started: false
        });
        return;
      }
      if (requestUrl.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "public, max-age=86400" });
        response.end();
        return;
      }
      if (requestUrl.pathname === "/api/v1/snapshot") {
        const current = await snapshot();
        jsonResponse(response, 200, access.kind === "private-viewer"
          ? privateViewerSnapshot(current, access.identity, access.transport)
          : managementConsoleSnapshot(current));
        return;
      }
      if (requestUrl.pathname === "/api/v1/events") {
        response.writeHead(200, {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
          "x-accel-buffering": "no",
          "x-content-type-options": "nosniff"
        });
        response.write("retry: 1000\n\n");
        clients.add(response);
        const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15000);
        request.on("close", () => {
          clearInterval(heartbeat);
          clients.delete(response);
        });
        return;
      }
      if (requestUrl.pathname === "/") {
        htmlResponse(response, renderControlPlaneDashboard(project.name, { viewMode: "management-read-only" }));
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
    return handle(request, response, classifyControlPlaneRequest(request.headers, requestPort, privateViewerHost));
  });
  await listen(server, host, port);
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;
  let lanViewerUrl = null;
  let actualLanPort = null;
  if (lanViewerHost) {
    lanServer = http.createServer((request, response) => handle(request, response, {
      kind: "private-viewer",
      identity: null,
      transport: "private-lan"
    }));
    await listen(lanServer, lanViewerHost, lanViewerPort);
    const address = lanServer.address();
    actualLanPort = typeof address === "object" && address ? address.port : lanViewerPort;
    lanViewerUrl = `http://${lanViewerHost}:${actualLanPort}`;
  }

  let closed = false;
  return {
    schema_version: MANAGEMENT_CONSOLE_SCHEMA,
    url,
    host,
    port: actualPort,
    stateDirectory,
    lanViewerHost,
    lanViewerPort: actualLanPort,
    lanViewerUrl,
    writer_lease_acquired: false,
    provider_started: false,
    repository_polling_started: false,
    async close() {
      if (closed) return;
      closed = true;
      if (invalidateTimer) clearTimeout(invalidateTimer);
      for (const response of clients) response.end();
      clients.clear();
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
      await closeServer(lanServer);
      await closeServer(server);
    }
  };
}
