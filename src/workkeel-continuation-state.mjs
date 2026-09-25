import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readTaskFile } from "./task-contract.mjs";
import { safeDirectory } from "./workkeel-project.mjs";
const exec = promisify(execFile);

export async function sourceRevision(target) {
  const { stdout } = await exec("git", ["-C", target, "rev-parse", "--verify", "HEAD"], { maxBuffer: 4096 });
  const revision = stdout.trim();
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision)) throw Error("An exact source revision is required");
  return revision;
}

export async function assertCandidateSource(target, revision, ref, content) {
  const { stdout } = await exec("git", ["-C", target, "show", `${revision}:${ref}`], { maxBuffer: 1024 * 1024 });
  if (stdout !== content) throw Error(`Review source differs from pinned candidate: ${ref}`);
}

/** Bounded partial-source snapshot; unknown/binary/unbounded trees cannot qualify recovery. */
export async function captureContinuationState(target, roots) {
  if (!Array.isArray(roots) || !roots.length || roots.some(ref => ref === "." || !/^[A-Za-z0-9_./-]+$/.test(ref) ||
    ref.split("/").some(p => !p || p === "." || p === "..") || ref.startsWith("/") || [".git", ".ai-org"].some(p => ref === p || ref.startsWith(p + "/")))) throw Error("Continuation requires bounded product write roots");
  const files = [], directories = []; let bytes = 0;
  async function walk(ref) {
    if (files.length + directories.length >= 512) throw Error("Continuation snapshot exceeds 512 entries");
    const dir = await safeDirectory(target, ref); directories.push(ref);
    for (const name of (await fs.readdir(dir)).sort()) {
      if (files.length + directories.length >= 512) throw Error("Continuation snapshot exceeds 512 entries");
      const child = `${ref}/${name}`, stat = await fs.lstat(path.join(target, child));
      if (stat.isSymbolicLink()) throw Error("Unsafe continuation source");
      if (stat.isDirectory()) await walk(child);
      else {
        const file = await readTaskFile(target, child, { preserveBom: true });
        bytes += Buffer.byteLength(file.content);
        if (bytes > 16 * 1024 * 1024) throw Error("Continuation snapshot exceeds 16 MiB");
        files.push({ path: child, sha256: file.bytes_digest });
      }
    }
  }
  for (const root of [...new Set(roots)].sort()) await walk(root);
  return { revision: await sourceRevision(target), roots, directories, files };
}
