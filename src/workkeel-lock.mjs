import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sha256 } from "./files.mjs";

const STALE_MS = 300_000;
const MAX_RECONCILIATION_JOURNAL_BYTES = 4 * 1024 * 1024 * 200 * 2;

// Keep the released lock name so older installed CLIs and this version exclude
// each other. Rename only together with the Temple removal.
export function projectMutationLockPath(target) {
  return path.join(os.tmpdir(), `temple-mutation-${sha256(path.resolve(target)).slice(0, 20)}.lock`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Per-checkout recovery journals that Temple writers leave behind on interruption.
async function legacyRecoveryJournal(target, kind) {
  const git = spawnSync("git", ["-C", target, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" });
  if (git.status !== 0) return null;
  const root = await fs.realpath(target);
  let directory = await fs.realpath(git.stdout.trim());
  for (const part of ["temple", kind, sha256(root).slice(0, 20)]) {
    directory = path.join(directory, part);
    const stat = await fs.lstat(directory).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new Error(kind === "lean-delivery" ? "Unsafe Lean delivery state directory" : "Unsafe reconciliation recovery directory");
    }
  }
  const file = path.join(directory, "pending.json");
  const stat = await fs.lstat(file).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || kind === "reconciliation" && stat.size > MAX_RECONCILIATION_JOURNAL_BYTES) {
    throw new Error(kind === "lean-delivery" ? "Unsafe Lean delivery journal" : "Unsafe reconciliation journal");
  }
  return JSON.parse(await fs.readFile(file, "utf8"));
}

/** Refuses to mutate while an interrupted legacy delivery or reconciliation awaits recovery. */
export async function assertNoPendingLegacyRecovery(target) {
  const lean = await legacyRecoveryJournal(target, "lean-delivery");
  if (lean) {
    const error = new Error(`Lean delivery recovery is pending (${lean.operation_key ?? "invalid journal"}); retry the identical work-item ${lean.request?.position ? "finish" : "deliver"} request before other mutations`);
    error.code = "PENDING_RECOVERY";
    error.mutationStatus = "pending_recovery";
    throw error;
  }
  const reconciliation = await legacyRecoveryJournal(target, "reconciliation");
  if (reconciliation) {
    const error = new Error(`Reconciliation ${reconciliation.transaction_id ?? "unknown"} needs recovery; inspect it and roll back before another mutation`);
    error.code = "RECONCILIATION_PENDING_RECOVERY";
    throw error;
  }
}

/**
 * One mutation per project at a time; not reentrant. Stale locks expire after
 * five minutes. Callers that run their own recovery checks pass
 * `legacyRecoveryCheck: false`.
 */
export async function withProjectMutationLock(target, operation, { legacyRecoveryCheck = true } = {}) {
  const lockPath = projectMutationLockPath(target);
  let handle = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > STALE_MS) {
        await fs.unlink(lockPath).catch(() => {});
        continue;
      }
      await wait(50);
    }
  }
  if (!handle) {
    throw new Error(`Another Temple mutation is still active: ${lockPath}`);
  }

  try {
    if (legacyRecoveryCheck) await assertNoPendingLegacyRecovery(target);
    return await operation();
  } finally {
    await handle.close();
    await fs.unlink(lockPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
