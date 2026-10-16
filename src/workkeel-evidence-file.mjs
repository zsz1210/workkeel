import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertScreenshotPNG} from './workkeel-browser-check.mjs';

/** Bounded literal-file verification shared by advisory and enforced evidence checks. */
export async function checkEvidenceFile(target, readPaths, taskId, ref) {
  const root = await fs.realpath(target);
  if (!ref || typeof ref.path !== 'string' || !ref.path || path.isAbsolute(ref.path) || /[\\:\x00-\x1f\x7f]/.test(ref.path) ||
      ref.path.split('/').some(part => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(ref.sha256 ?? '') ||
      !['observation', 'check', 'screenshot'].includes(ref.kind)) throw Error('Invalid evidence pin');
  if (![...readPaths, '.ai-org/artifacts/' + taskId].some(base => base === '.' || ref.path === base || ref.path.startsWith(base + '/'))) throw Error('Evidence is outside task read authority');
  const file = path.join(root, ref.path);
  if (await fs.realpath(file) !== file) throw Error('Evidence must be a literal file');
  const entry = await fs.lstat(file);
  if (!entry.isFile()) throw Error('Evidence must be regular');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const before = await handle.stat(), opened = await fs.lstat(file);
    if (!before.isFile() || before.size === 0 || before.size > 10 * 1024 * 1024 || before.dev !== entry.dev || before.ino !== entry.ino || before.dev !== opened.dev || before.ino !== opened.ino || await fs.realpath(file) !== file) throw Error('Evidence is empty, changed or invalid while opening');
    const buffer = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < buffer.length) { const result = await handle.read(buffer, offset, buffer.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
    bytes = buffer.subarray(0, offset);
    const after = await handle.stat(), current = await fs.lstat(file);
    if (offset !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.dev !== current.dev || before.ino !== current.ino || await fs.realpath(file) !== file) throw Error('Evidence changed while reading');
  } finally { await handle.close(); }
  if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw Error('Evidence digest mismatch');
  if (ref.kind === 'screenshot') assertScreenshotPNG(bytes);
  return ref.kind === 'screenshot';
}
