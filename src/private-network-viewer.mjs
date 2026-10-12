import path from "node:path";
import { execFile } from "node:child_process";
import { isIP } from "node:net";
import { promisify } from "node:util";
import { pathExists } from "./files.mjs";

const execFileAsync = promisify(execFile);

export const TAILSCALE_VALIDATED_VERSION = "1.98.8";
export const TAILSCALE_IDENTITY_HEADER = "tailscale-user-login";
export const DEFAULT_LAN_VIEWER_PORT = 41741;

const MACOS_TAILSCALE_CANDIDATES = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/Applications/Tailscale.localized/Tailscale.app/Contents/MacOS/Tailscale"
];

function firstLine(value) {
  return String(value ?? "").split(/\r?\n/, 1)[0].trim();
}

export function normalizePrivateViewerHost(value) {
  const host = String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.ts\.net$/.test(host)) {
    throw new Error("Private viewer host must be one exact Tailscale *.ts.net DNS name without a scheme, port, path, or wildcard");
  }
  return host;
}

export function normalizePrivateLanViewerHost(value) {
  const host = String(value ?? "").trim();
  if (isIP(host) !== 4) {
    throw new Error("LAN viewer host must be one exact RFC1918 IPv4 address without a scheme, port, path, hostname, or wildcard");
  }
  const [first, second] = host.split(".").map(Number);
  const isPrivate = first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
  if (!isPrivate) {
    throw new Error("LAN viewer host must be inside 10.0.0.0/8, 172.16.0.0/12, or 192.168.0.0/16");
  }
  return host;
}

export function parseTailscaleStatus(value) {
  let status;
  try {
    status = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("Tailscale status did not return valid JSON");
  }
  if (status?.BackendState !== "Running" || status?.Self?.Online !== true) {
    throw new Error("Tailscale must be running and online before starting the private Dashboard viewer");
  }
  const host = normalizePrivateViewerHost(status.Self.DNSName);
  return { host, url: `https://${host}`, status };
}

export function assertUnusedTailscaleServeConfig(value) {
  let status;
  try {
    status = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("Tailscale Serve status did not return valid JSON");
  }
  if (!status || Array.isArray(status) || typeof status !== "object") {
    throw new Error("Tailscale Serve status must be a JSON object");
  }
  if (Object.keys(status).length !== 0) {
    throw new Error("Tailscale Serve already has configuration on this device; Temple will not replace or merge it automatically");
  }
  return status;
}

function containsEnabledValue(value) {
  if (value === true || String(value).toLowerCase() === "true") return true;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(containsEnabledValue);
}

function anyTruthyFunnel(value) {
  if (!value || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value)) {
    if (key.toLowerCase().includes("funnel") && containsEnabledValue(nested)) return true;
    if (anyTruthyFunnel(nested)) return true;
  }
  return false;
}

export function assertPrivateTailscaleServeConfig(value, { host, target }) {
  let status;
  try {
    status = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("Tailscale Serve verification did not return valid JSON");
  }
  const serialized = JSON.stringify(status);
  if (!serialized.includes(normalizePrivateViewerHost(host)) || !serialized.includes(target)) {
    throw new Error("Tailscale Serve did not report the expected private hostname and loopback target");
  }
  if (anyTruthyFunnel(status)) throw new Error("Temple refuses a Tailscale configuration with Funnel enabled");
  return status;
}

export function tailscaleServeArguments(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Private viewer requires an active loopback port");
  return ["serve", "--bg", "--yes", `http://127.0.0.1:${port}`];
}

async function defaultRun(command, args) {
  return execFileAsync(command, args, {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024
  });
}

async function resolveTailscaleCommand(options = {}) {
  if (options.command) return path.resolve(options.command);
  for (const candidate of MACOS_TAILSCALE_CANDIDATES) {
    if (await pathExists(candidate)) return candidate;
  }
  return "tailscale";
}

export async function prepareTailscalePrivateViewer(options = {}) {
  const run = options.run ?? defaultRun;
  const command = await resolveTailscaleCommand(options);
  const versionResult = await run(command, ["version"]);
  const version = firstLine(versionResult.stdout);
  if (version !== TAILSCALE_VALIDATED_VERSION) {
    throw new Error(`Tailscale ${TAILSCALE_VALIDATED_VERSION} is required by this pinned integration; detected ${version || "unknown"}`);
  }
  const statusResult = await run(command, ["status", "--json"]);
  const identity = parseTailscaleStatus(statusResult.stdout);
  const serveResult = await run(command, ["serve", "status", "--json"]);
  assertUnusedTailscaleServeConfig(serveResult.stdout);

  return {
    ...identity,
    command,
    version,
    async enable(port) {
      const target = `http://127.0.0.1:${port}`;
      let configured = false;
      try {
        const current = await run(command, ["serve", "status", "--json"]);
        assertUnusedTailscaleServeConfig(current.stdout);
        await run(command, tailscaleServeArguments(port));
        configured = true;
        const verified = await run(command, ["serve", "status", "--json"]);
        assertPrivateTailscaleServeConfig(verified.stdout, { host: identity.host, target });
      } catch (error) {
        if (configured) await run(command, ["serve", "reset"]).catch(() => {});
        throw error;
      }
      let closed = false;
      return {
        host: identity.host,
        url: identity.url,
        target,
        async close() {
          if (closed) return;
          closed = true;
          await run(command, ["serve", "reset"]);
        }
      };
    }
  };
}
