#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function fail(message) {
  process.stderr.write(`Organization CLI bootstrap error: ${message}\n`);
  process.exitCode = 1;
}

function readBootstrap() {
  const lockPath = path.join(projectRoot, "temple.lock");
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${lockPath}: ${error.message}`);
  }
  const bootstrap = lock?.template?.bootstrap;
  if (bootstrap?.schema_version !== "temple.cli-bootstrap/v1") {
    throw new Error("temple.lock has no supported CLI bootstrap contract; upgrade the project installation");
  }
  if (!bootstrap.version || bootstrap.version !== lock.template.version) {
    throw new Error("CLI bootstrap version does not match temple.lock");
  }
  if (!bootstrap.package_spec || !bootstrap.package_spec.endsWith(`@${bootstrap.version}`)) {
    throw new Error("CLI bootstrap package source is not version-pinned");
  }
  return { bootstrap, installation: lock?.installation ?? null };
}

function canonicalPath(candidate, label) {
  try {
    return fs.realpathSync(candidate);
  } catch (error) {
    throw new Error(`cannot resolve ${label} at ${candidate}: ${error.message}`);
  }
}

function assertInsideProject(projectPath, candidatePath, label) {
  const relative = path.relative(projectPath, candidatePath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside the toolkit worktree`);
  }
}

function selfHostCli(installation) {
  if (installation?.mode !== "toolkit-self-host") return null;
  if (installation.source_overlay !== "project-overlay") {
    throw new Error("toolkit self-host installation has an unsupported source overlay");
  }

  const canonicalRoot = canonicalPath(projectRoot, "toolkit worktree");
  const canonicalOverlay = canonicalPath(path.join(projectRoot, installation.source_overlay), "self-host source overlay");
  assertInsideProject(canonicalRoot, canonicalOverlay, "Self-host source overlay");
  if (!fs.statSync(canonicalOverlay).isDirectory()) {
    throw new Error("self-host source overlay is not a directory");
  }

  const canonicalCli = canonicalPath(path.join(projectRoot, "bin", "temple.mjs"), "repository-local CLI");
  assertInsideProject(canonicalRoot, canonicalCli, "Repository-local CLI");
  if (!fs.statSync(canonicalCli).isFile()) {
    throw new Error("repository-local CLI is not a file");
  }
  return canonicalCli;
}

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    let settled = false;
    const forward = (signal) => {
      if (settled || child.exitCode !== null || child.signalCode !== null) return;
      try {
        child.kill(signal);
      } catch {
        // The exit handler remains authoritative when the child closes concurrently.
      }
    };
    const onSigint = () => forward("SIGINT");
    const onSigterm = () => forward("SIGTERM");
    const dispose = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      dispose();
      callback();
    };
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (status, signal) => {
      finish(() => resolve(status ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)));
    });
  });
}

function output(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${command} failed`);
  return result.stdout.trim();
}

try {
  const { bootstrap, installation } = readBootstrap();
  if (process.argv[2] === "--bootstrap-info") {
    process.stdout.write(`${JSON.stringify(bootstrap, null, 2)}\n`);
  } else {
    const argumentsToTemple = process.argv.slice(2);
    const explicitCli = String(process.env.TEMPLE_CLI_PATH ?? "").trim();
    if (explicitCli) {
      const actualVersion = output(process.execPath, [explicitCli, "--version"]);
      if (actualVersion !== bootstrap.version) {
        throw new Error(`TEMPLE_CLI_PATH version ${actualVersion || "unknown"} does not match pinned version ${bootstrap.version}`);
      }
      process.exitCode = await run(process.execPath, [explicitCli, ...argumentsToTemple]);
    } else {
      const repositoryCli = selfHostCli(installation);
      if (repositoryCli) {
        const actualVersion = output(process.execPath, [repositoryCli, "--version"]);
        if (actualVersion !== bootstrap.version) {
          throw new Error(
            `repository-local CLI version ${actualVersion || "unknown"} does not match pinned version ${bootstrap.version}`
          );
        }
        process.exitCode = await run(process.execPath, [repositoryCli, ...argumentsToTemple]);
      } else {
        const packageSpec = bootstrap.repository_spec ?? bootstrap.package_spec;
        const npm = process.platform === "win32" ? "npm.cmd" : "npm";
        process.exitCode = await run(npm, ["exec", "--yes", `--package=${packageSpec}`, "--", "temple", ...argumentsToTemple]);
      }
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
