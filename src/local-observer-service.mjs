import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readControlPlaneConfig } from "./control-plane-config.mjs";
import { atomicWrite, formatJson, pathExists, readJson, sha256 } from "./files.mjs";
import { readDaemonMetadata, resolveControlPlaneStateDirectory } from "./telemetry.mjs";

const execFileAsync = promisify(execFile);

export const LOCAL_OBSERVER_SERVICE_SCHEMA = "temple.local-observer-service/v1";
export const LOCAL_OBSERVER_PLAN_SCHEMA = "temple.local-observer-plan/v1";
export const LOCAL_OBSERVER_STATUS_SCHEMA = "temple.local-observer-status/v1";

function stableValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function planDigest(value) {
  return `sha256:${sha256(JSON.stringify(stableValue(value)))}`;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plistFor(service) {
  const argumentsXml = service.arguments.map((argument) => `      <string>${xmlEscape(argument)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(service.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(service.stdout_path)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(service.stderr_path)}</string>
</dict>
</plist>
`;
}

async function executablePath(command, options = {}) {
  const candidate = String(command ?? "").trim();
  if (candidate) {
    if (!path.isAbsolute(candidate)) throw new Error("Managed local Usage Collector requires an absolute Codex executable path");
    if (!options.skipExecutableCheck) await fs.access(candidate, fs.constants.X_OK);
    return path.resolve(candidate);
  }
  for (const directory of String(options.pathEnvironment ?? process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const resolved = path.join(directory, "codex");
    try {
      await fs.access(resolved, fs.constants.X_OK);
      return resolved;
    } catch {
      // Continue until an executable is found.
    }
  }
  throw new Error("Could not find an executable Codex command; pass --codex-command with one absolute path");
}

function processAlive(pid, kill = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readOptional(targetPath) {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function defaultLaunchctl(args) {
  return execFileAsync("/bin/launchctl", args, {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024
  });
}

function missingLaunchService(error) {
  const message = `${error?.message ?? ""}\n${error?.stderr ?? ""}`.toLowerCase();
  return message.includes("could not find service") || message.includes("no such process") || message.includes("service not found");
}

export async function readLocalObserverManifest(stateDirectory) {
  const manifestPath = path.join(stateDirectory, "observer-service.json");
  if (!(await pathExists(manifestPath))) return null;
  const manifest = await readJson(manifestPath);
  if (manifest.schema_version !== LOCAL_OBSERVER_SERVICE_SCHEMA) {
    throw new Error(`Unsupported local Observer manifest: ${manifest.schema_version ?? "missing schema"}`);
  }
  return manifest;
}

export async function planLocalObserverService(target, options = {}) {
  const projectRoot = path.resolve(target);
  const platform = options.platform ?? process.platform;
  const config = await readControlPlaneConfig(projectRoot);
  const stateDirectory = resolveControlPlaneStateDirectory(projectRoot, options.stateDirectory ?? config.state_directory);
  const project = await readJson(path.join(projectRoot, ".ai-org/project/project.json"));
  if (platform !== "darwin") {
    const behavior = {
      schema_version: LOCAL_OBSERVER_PLAN_SCHEMA,
      status: "unsupported-platform",
      supported: false,
      platform,
      project_id: project.id,
      project_root: projectRoot,
      state_directory: stateDirectory,
      observation_mode: "managed-local"
    };
    return { ...behavior, plan_digest: planDigest(behavior) };
  }

  const userHome = path.resolve(options.userHome ?? os.homedir());
  const nodeExecutable = path.resolve(options.nodeExecutable ?? process.execPath);
  const codexCommand = await executablePath(options.codexCommand, options);
  const launcher = path.join(projectRoot, "templew.mjs");
  if (!(await pathExists(launcher))) throw new Error(`Managed local Usage Collector requires the repository launcher: ${launcher}`);
  const label = `dev.temple.usage-collector.${sha256(projectRoot).slice(0, 12)}`;
  const plistPath = path.join(userHome, "Library", "LaunchAgents", `${label}.plist`);
  const logsDirectory = path.join(stateDirectory, "logs");
  const argumentsVector = [
    nodeExecutable,
    launcher,
    "usage",
    "collect",
    projectRoot,
    "--observation-mode",
    "managed-local",
    "--codex-command",
    codexCommand
  ];
  const service = {
    label,
    plist_path: plistPath,
    manifest_path: path.join(stateDirectory, "observer-service.json"),
    stdout_path: path.join(logsDirectory, "usage-collector.stdout.log"),
    stderr_path: path.join(logsDirectory, "usage-collector.stderr.log"),
    program: nodeExecutable,
    arguments: argumentsVector,
    console_started: false,
    http_listener_started: false,
    codex_command: codexCommand
  };
  const behavior = {
    schema_version: LOCAL_OBSERVER_PLAN_SCHEMA,
    status: "ready",
    supported: true,
    platform,
    project_id: project.id,
    project_root: projectRoot,
    state_directory: stateDirectory,
    observation_mode: "managed-local",
    service
  };
  return { ...behavior, plan_digest: planDigest(behavior), plist: plistFor(service) };
}

export async function inspectLocalObserverService(target, options = {}) {
  const projectRoot = path.resolve(target);
  const config = await readControlPlaneConfig(projectRoot);
  const stateDirectory = resolveControlPlaneStateDirectory(projectRoot, options.stateDirectory ?? config.state_directory);
  const manifest = await readLocalObserverManifest(stateDirectory);
  const daemon = await readDaemonMetadata(stateDirectory);
  const running = processAlive(daemon?.pid, options.kill ?? process.kill);
  const selectedMode = manifest ? "managed-local" : running ? "on-demand" : "off";
  const serviceStatus = manifest
    ? running ? "running" : manifest.activated ? "degraded" : "installed"
    : "not-installed";
  return {
    schema_version: LOCAL_OBSERVER_STATUS_SCHEMA,
    project_root: projectRoot,
    state_directory: stateDirectory,
    observation_mode: selectedMode,
    service_status: serviceStatus,
    continuous_observation_expected: Boolean(manifest?.activated),
    observation_started_at: manifest?.applied_at ?? (running ? daemon?.started_at ?? null : null),
    installed_plan_digest: manifest?.plan_digest ?? null,
    activated: Boolean(manifest?.activated),
    running,
    manifest_path: manifest?.service?.manifest_path ?? path.join(stateDirectory, "observer-service.json"),
    plist_path: manifest?.service?.plist_path ?? null,
    label: manifest?.service?.label ?? null,
    loopback_url: running && daemon?.url ? daemon.url : null,
    lan_viewer_url: manifest?.service?.lan_viewer_host
      ? `http://${manifest.service.lan_viewer_host}:${manifest.service.lan_viewer_port}`
      : null,
    canonical_state_changed: false,
    external_action_performed: false
  };
}

async function restoreFile(targetPath, prior) {
  if (prior === null) await fs.unlink(targetPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  else await atomicWrite(targetPath, prior);
}

export async function applyLocalObserverService(target, options = {}) {
  if (!options.expectedPlan) throw new Error("observer-apply requires an expected plan digest");
  const plan = await planLocalObserverService(target, options);
  if (!plan.supported) throw new Error(`Managed local Usage Collector is unsupported on ${plan.platform}`);
  if (plan.plan_digest !== options.expectedPlan) throw new Error("Observer plan changed; review a fresh observer-plan result before applying");
  const existing = await readLocalObserverManifest(plan.state_directory);
  if (existing && existing.plan_digest !== plan.plan_digest && !options.confirmReplace) {
    throw new Error("A different Usage Collector plan is installed; pass --confirm-replace after reviewing the fresh plan");
  }
  if (existing?.activated && existing.plan_digest !== plan.plan_digest && !options.activate) {
    throw new Error("Replacing an active Usage Collector requires --activate so the exact replacement lifecycle is explicit");
  }
  if (existing?.plan_digest === plan.plan_digest && !options.activate) {
    return {
      schema_version: LOCAL_OBSERVER_STATUS_SCHEMA,
      observation_mode: "managed-local",
      service_status: existing.activated ? "installed" : "installed",
      plan_digest: plan.plan_digest,
      activated: Boolean(existing.activated),
      project_root: plan.project_root,
      state_directory: plan.state_directory,
      plist_path: plan.service.plist_path,
      manifest_path: plan.service.manifest_path,
      unchanged: true,
      canonical_state_changed: false,
      external_action_performed: false
    };
  }
  const priorPlist = await readOptional(plan.service.plist_path);
  const priorManifest = await readOptional(plan.service.manifest_path);
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const manifest = {
    schema_version: LOCAL_OBSERVER_SERVICE_SCHEMA,
    project_id: plan.project_id,
    project_root: plan.project_root,
    state_directory: plan.state_directory,
    plan_digest: plan.plan_digest,
    applied_at: existing?.plan_digest === plan.plan_digest ? existing.applied_at : now.toISOString(),
    activated: Boolean(options.activate || (existing?.plan_digest === plan.plan_digest && existing.activated)),
    service: plan.service,
    privacy: {
      credentials_retained: false,
      prompts_retained: false,
      responses_retained: false,
      hidden_reasoning_retained: false
    }
  };
  const runLaunchctl = options.runLaunchctl ?? defaultLaunchctl;
  const domain = `gui/${options.uid ?? process.getuid?.()}`;
  let bootedPrevious = false;
  try {
    await fs.mkdir(path.dirname(plan.service.stdout_path), { recursive: true });
    if (existing?.activated && options.activate) {
      try {
        await runLaunchctl(["bootout", `${domain}/${existing.service.label}`]);
        bootedPrevious = true;
      } catch (error) {
        if (!missingLaunchService(error)) throw error;
      }
    }
    await atomicWrite(plan.service.plist_path, plan.plist);
    await atomicWrite(plan.service.manifest_path, formatJson(manifest));
    if (options.activate) {
      await runLaunchctl(["bootstrap", domain, plan.service.plist_path]);
      await runLaunchctl(["kickstart", "-k", `${domain}/${plan.service.label}`]);
    }
  } catch (error) {
    await restoreFile(plan.service.plist_path, priorPlist).catch(() => {});
    await restoreFile(plan.service.manifest_path, priorManifest).catch(() => {});
    if (bootedPrevious && existing?.service?.plist_path) {
      await runLaunchctl(["bootstrap", domain, existing.service.plist_path]).catch(() => {});
      await runLaunchctl(["kickstart", "-k", `${domain}/${existing.service.label}`]).catch(() => {});
    }
    throw new Error(`Usage Collector installation was rolled back: ${error.message}`);
  }
  return {
    schema_version: LOCAL_OBSERVER_STATUS_SCHEMA,
    observation_mode: "managed-local",
    service_status: manifest.activated ? "starting" : "installed",
    plan_digest: plan.plan_digest,
    activated: manifest.activated,
    project_root: plan.project_root,
    state_directory: plan.state_directory,
    plist_path: plan.service.plist_path,
    manifest_path: plan.service.manifest_path,
    canonical_state_changed: false,
    external_action_performed: Boolean(options.activate)
  };
}

export async function removeLocalObserverService(target, options = {}) {
  if (!options.expectedPlan) throw new Error("observer-remove requires an expected plan digest");
  if (!options.confirmDelete) throw new Error("observer-remove requires --confirm-delete");
  const projectRoot = path.resolve(target);
  const config = await readControlPlaneConfig(projectRoot);
  const stateDirectory = resolveControlPlaneStateDirectory(projectRoot, options.stateDirectory ?? config.state_directory);
  const manifest = await readLocalObserverManifest(stateDirectory);
  if (!manifest) throw new Error("No managed local Usage Collector is installed for this clone");
  if (manifest.plan_digest !== options.expectedPlan) throw new Error("Installed Usage Collector digest does not match --expected-plan");
  const runLaunchctl = options.runLaunchctl ?? defaultLaunchctl;
  if (manifest.activated) {
    const domain = `gui/${options.uid ?? process.getuid?.()}`;
    try {
      await runLaunchctl(["bootout", `${domain}/${manifest.service.label}`]);
    } catch (error) {
      if (!missingLaunchService(error)) throw error;
    }
  }
  await fs.unlink(manifest.service.plist_path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await fs.unlink(path.join(stateDirectory, "observer-service.json"));
  return {
    schema_version: LOCAL_OBSERVER_STATUS_SCHEMA,
    observation_mode: "off",
    service_status: "not-installed",
    removed_plan_digest: manifest.plan_digest,
    retained_telemetry: true,
    canonical_state_changed: false,
    external_action_performed: Boolean(manifest.activated)
  };
}

export async function localObservationContext(target, stateDirectory, options = {}) {
  const allowed = new Set(["off", "on-demand", "managed-local"]);
  const mode = options.mode ?? (options.enableCodex ? "on-demand" : "off");
  if (!allowed.has(mode)) throw new Error(`Unknown observation mode: ${mode}`);
  const manifest = await readLocalObserverManifest(stateDirectory);
  if (mode === "managed-local" && !manifest) {
    return {
      mode,
      started_at: options.startedAt ?? null,
      continuous_expected: true,
      platform: options.platform ?? process.platform,
      service_status: "degraded"
    };
  }
  return {
    mode,
    started_at: mode === "off" ? null : mode === "managed-local" ? manifest.applied_at : options.startedAt ?? null,
    continuous_expected: mode === "managed-local" && Boolean(manifest.activated),
    platform: options.platform ?? process.platform,
    service_status: mode === "managed-local" ? "running" : "not-installed"
  };
}
