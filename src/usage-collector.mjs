import fs from "node:fs/promises";
import path from "node:path";
import { TEMPLATE_VERSION } from "./constants.mjs";
import { readControlPlaneConfig } from "./control-plane-config.mjs";
import { startCodexAppServerProvider } from "./codex-app-server-provider.mjs";
import { controlPlaneProviderContracts } from "./control-plane-server.mjs";
import { createProviderRegistry, persistProviderRegistry } from "./control-plane-providers.mjs";
import {
  acquireControlPlaneLease,
  openTelemetryJournal,
  resolveControlPlaneStateDirectory,
  writeDaemonMetadata
} from "./telemetry.mjs";

export const USAGE_COLLECTOR_SCHEMA = "temple.usage-collector/v1";

function collectionMode(value) {
  const mode = value ?? "on-demand";
  if (!["on-demand", "managed-local"].includes(mode)) {
    throw new Error("Usage collection mode must be on-demand or managed-local");
  }
  return mode;
}

export async function startUsageCollector(target, options = {}) {
  const projectRoot = path.resolve(target);
  const config = await readControlPlaneConfig(projectRoot);
  const configuredCodex = config.providers.find((provider) => provider.kind === "codex-app-server" && provider.enabled);
  const mode = collectionMode(options.observationMode);
  const stateDirectory = resolveControlPlaneStateDirectory(
    projectRoot,
    options.stateDirectory ?? config.state_directory
  );
  const lease = await (options.acquireLease ?? acquireControlPlaneLease)(stateDirectory);
  let journal = null;
  let provider = null;
  let unsubscribe = null;
  let persistTail = Promise.resolve();
  let closed = false;

  try {
    journal = await (options.openJournal ?? openTelemetryJournal)(stateDirectory, {
      maxEvents: config.retention.max_events,
      privacy: config.privacy
    });
    const registry = createProviderRegistry(controlPlaneProviderContracts(config));
    const startProvider = options.startProvider ?? startCodexAppServerProvider;
    provider = await startProvider(projectRoot, journal, registry, {
      ...(configuredCodex?.options ?? {}),
      providerId: configuredCodex?.id,
      command: options.codexCommand ?? configuredCodex?.options?.command,
      commandArgs: options.codexCommandArgs ?? configuredCodex?.options?.command_args,
      resumeThreads: options.resumeCodexThreads ?? configuredCodex?.options?.resume_threads ?? true,
      historyTurnLimit: options.codexHistoryTurnLimit ?? configuredCodex?.options?.history_turn_limit,
      historyItemLimit: options.codexHistoryItemLimit ?? configuredCodex?.options?.history_item_limit
    });
    const persist = () => {
      persistTail = persistTail.then(() => persistProviderRegistry(stateDirectory, registry));
      return persistTail;
    };
    unsubscribe = journal.subscribe(() => {
      void persist().catch(() => {});
    });
    const startedAt = new Date().toISOString();
    await writeDaemonMetadata(stateDirectory, {
      host: null,
      port: null,
      url: null,
      projectRoot,
      startedAt,
      version: TEMPLATE_VERSION
    });
    await persist();
    await provider.start();
    await persist();

    return {
      schema_version: USAGE_COLLECTOR_SCHEMA,
      mode,
      project_root: projectRoot,
      state_directory: stateDirectory,
      provider_id: provider.providerId,
      http_listener_started: false,
      console_started: false,
      writer_lease_acquired: true,
      started_at: startedAt,
      async close() {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (provider) await provider.stop();
        await persistTail.catch(() => {});
        await persistProviderRegistry(stateDirectory, registry);
        if (journal) await journal.close();
        await fs.unlink(path.join(stateDirectory, "daemon.json")).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        await lease.release();
      }
    };
  } catch (error) {
    unsubscribe?.();
    if (provider) await provider.stop().catch(() => {});
    await persistTail.catch(() => {});
    if (journal) await journal.close().catch(() => {});
    await fs.unlink(path.join(stateDirectory, "daemon.json")).catch(() => {});
    await lease.release().catch(() => {});
    throw error;
  }
}
