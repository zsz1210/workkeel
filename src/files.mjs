import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(targetPath) {
  const content = await fs.readFile(targetPath, "utf8");
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in ${targetPath}: ${error.message}`);
  }
}

export function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function atomicWrite(targetPath, content) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.temple-tmp-${process.pid}-${crypto.randomBytes(5).toString("hex")}`
  );
  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, targetPath);
}

export async function atomicCreate(targetPath, content) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.temple-tmp-${process.pid}-${crypto.randomBytes(5).toString("hex")}`
  );
  await fs.writeFile(temporaryPath, content);
  try {
    await fs.link(temporaryPath, targetPath);
  } finally {
    await fs.unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function syncDirectory(directoryPath) {
  let handle;
  try {
    handle = await fs.open(directoryPath, "r");
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EPERM", "EISDIR", "EBADF"].includes(error.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function writeAndSync(targetPath, content) {
  const handle = await fs.open(targetPath, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function durableAtomicWrite(targetPath, content) {
  const directoryPath = path.dirname(targetPath);
  await fs.mkdir(directoryPath, { recursive: true });
  const temporaryPath = path.join(
    directoryPath,
    `.temple-durable-${process.pid}-${crypto.randomBytes(8).toString("hex")}`
  );
  try {
    await writeAndSync(temporaryPath, content);
    await fs.rename(temporaryPath, targetPath);
    await syncDirectory(directoryPath);
  } finally {
    await fs.unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function durableAtomicCreate(targetPath, content) {
  const directoryPath = path.dirname(targetPath);
  await fs.mkdir(directoryPath, { recursive: true });
  const temporaryPath = path.join(
    directoryPath,
    `.temple-durable-${process.pid}-${crypto.randomBytes(8).toString("hex")}`
  );
  try {
    await writeAndSync(temporaryPath, content);
    await fs.link(temporaryPath, targetPath);
    await syncDirectory(directoryPath);
  } finally {
    await fs.unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function durableChmod(targetPath, mode) {
  const handle = await fs.open(targetPath, "r");
  try {
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function durableUnlink(targetPath) {
  await fs.unlink(targetPath);
  await syncDirectory(path.dirname(targetPath));
}

export async function durableRename(sourcePath, targetPath) {
  await fs.rename(sourcePath, targetPath);
  await syncDirectory(path.dirname(targetPath));
  if (path.dirname(sourcePath) !== path.dirname(targetPath)) await syncDirectory(path.dirname(sourcePath));
}

export async function rollbackFileChanges(changes) {
  const failures = [];
  for (const change of [...changes].reverse()) {
    try {
      const exists = await pathExists(change.path);
      if (change.afterHash === null) {
        if (!exists) await atomicCreate(change.path, change.before);
        else failures.push(`${change.path}: a new file blocks restoration`);
        continue;
      }
      if (!exists) {
        if (change.before !== null) await atomicCreate(change.path, change.before);
        continue;
      }
      if ((await sha256File(change.path)) !== change.afterHash) {
        failures.push(`${change.path}: content changed again after this operation wrote it`);
        continue;
      }
      if (change.before === null) await fs.unlink(change.path);
      else await atomicWrite(change.path, change.before);
    } catch (error) {
      failures.push(`${change.path}: ${error.message}`);
    }
  }
  if (failures.length > 0) throw new Error(`Rollback could not safely restore every file:\n- ${failures.join("\n- ")}`);
}

export async function walkFiles(root) {
  const output = [];

  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        output.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  }

  await visit(root);
  return output;
}

export function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function sha256File(targetPath) {
  return sha256(await fs.readFile(targetPath));
}

export async function assertSafeTarget(inputPath) {
  const target = path.resolve(inputPath);
  const filesystemRoot = path.parse(target).root;
  if (target === filesystemRoot || target === os.homedir()) {
    throw new Error(`Refusing to initialize a broad target: ${target}`);
  }

  if (await pathExists(target)) {
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      throw new Error(`Target is not a directory: ${target}`);
    }
  }

  return target;
}

export function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}
