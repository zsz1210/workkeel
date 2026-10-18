import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256 } from "./files.mjs";

const STALE_MS = 300_000;

export function projectMutationLockPath(target) {
  return path.join(os.tmpdir(), `workkeel-mutation-${sha256(path.resolve(target)).slice(0, 20)}.lock`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** One mutation per project at a time; not reentrant. Stale locks expire after five minutes. */
export async function withProjectMutationLock(target, operation) {
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
    throw new Error(`Another Workkeel mutation is still active: ${lockPath}`);
  }

  try {
    return await operation();
  } finally {
    await handle.close();
    await fs.unlink(lockPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
