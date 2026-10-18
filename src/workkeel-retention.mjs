import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {gzip, gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {durableAtomicCreate, formatJson, sha256} from './files.mjs';
import {withProjectMutationLock} from './workkeel-lock.mjs';
import {safeDirectory} from './workkeel-project.mjs';
import {assertTaskExecutionContext} from './workkeel-tasks.mjs';

const zip = promisify(gzip), unzip = promisify(gunzip);
const digest = value => sha256(formatJson(value));
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const HARD = {max_files: 4096, max_bytes: 64 * 1024 * 1024, max_file_bytes: 16 * 1024 * 1024};
const METRICS = ['input_tokens', 'output_tokens', 'cost_usd'];
const under = (file, root) => root === '.' || file === root || file.startsWith(`${root}/`);
function keys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value)) ||
      required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => ![...required, ...optional].includes(k))) throw Error('Missing or unknown retention fields');
}
function id(value) {
  if (typeof value !== 'string' || !ID.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw Error('Invalid retention identity');
}
function integer(value, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error('Invalid retention bound or version');
}
function localPath(value) {
  if (typeof value !== 'string' || value.length > 1024 || !/^[A-Za-z0-9._/-]+$/.test(value) ||
      value.split('/').some(p => !p || p === '.' || p === '..' || p === '.git')) throw Error('Retention requires explicit project-local paths');
  return value;
}
function paths(values, empty = false) {
  if (!Array.isArray(values) || values.length > 128 || !empty && !values.length) throw Error('Invalid retention paths');
  for (const value of values) localPath(value);
  if (new Set(values).size !== values.length) throw Error('Duplicate retention path');
}
function limits(value) {
  keys(value, Object.keys(HARD));
  for (const key of Object.keys(HARD)) integer(value[key], 1, HARD[key]);
  if (value.max_file_bytes > value.max_bytes) throw Error('Retention file byte bound exceeds total byte bound');
}
function sha(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('Exact retention digest is required'); }
export function validateRetentionPolicy(policy) {
  keys(policy, ['schema_version', 'roots', 'protected_paths', 'archive_root', 'limits']);
  if (policy.schema_version !== 'workkeel.retention-policy/v1') throw Error('Unsupported retention policy');
  paths(policy.roots); paths(policy.protected_paths, true); localPath(policy.archive_root); limits(policy.limits);
  if (!under(policy.archive_root, '.ai-org/retention')) throw Error('Retention archives require private .ai-org/retention storage');
  for (let a = 0; a < policy.roots.length; a++) {
    if (under(policy.roots[a], policy.archive_root) || under(policy.archive_root, policy.roots[a])) throw Error('Retention sources and archive storage must be disjoint');
    for (let b = a + 1; b < policy.roots.length; b++) if (under(policy.roots[a], policy.roots[b]) || under(policy.roots[b], policy.roots[a])) throw Error('Retention roots cannot overlap');
  }
  return policy;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const identity = stat => ({dev: String(stat.dev), ino: String(stat.ino), mtime_ns: String(stat.mtimeNs), ctime_ns: String(stat.ctimeNs)});
async function readBytes(target, ref, max) {
  localPath(ref);
  const dir = await safeDirectory(target, path.posix.dirname(ref) === '.' ? '.' : path.posix.dirname(ref));
  const file = await fs.open(path.join(dir, path.posix.basename(ref)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({bigint: true});
    if (!before.isFile() || before.size > BigInt(max)) throw Error('Retention source is not a bounded regular file');
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break; offset += bytesRead;
    }
    const after = await file.stat({bigint: true}), current = await fs.lstat(path.join(dir, path.posix.basename(ref)), {bigint: true});
    if (offset !== bytes.length || after.size !== before.size || digest(identity(after)) !== digest(identity(before)) || current.isSymbolicLink() || digest(identity(current)) !== digest(identity(before))) throw Error('Retention source changed during read');
    const mtime = Number(before.mtimeMs);
    return {bytes, stat: {bytes: bytes.length, allocated_bytes: Number(before.blocks) * 512, modified_at: Number.isFinite(mtime) ? new Date(mtime).toISOString() : null, identity: identity(before)}};
  } finally { await file.close(); }
}
function canonicalReasons(ref) {
  const reasons = [];
  for (const [root, reason] of [['.ai-org/work-items', 'canonical-task-history'], ['.ai-org/learning', 'learning-provenance'],
    ['.agents/skills', 'skill-version-source'], ['.ai-org/host-usage', 'host-source-identity-history'], ['.ai-org/execution', 'execution-evidence-history'],
    ['.ai-org/model-policies', 'immutable-model-policy-history']]) if (under(ref, root)) reasons.push(reason);
  if (under(ref, '.ai-org') && !reasons.length) reasons.push('canonical-private-evidence');
  return reasons;
}
// Discover references without following them outside the explicit inventory.
function referencedPaths(document, refs, depth = 0, budget = {left: 20000}) {
  if (--budget.left < 0 || depth > 64) throw Error('Retention reference discovery exceeds bound');
  if (!document || typeof document !== 'object') return;
  if (typeof document.path === 'string' && typeof document.sha256 === 'string') {
    try { localPath(document.path); refs.add(document.path); } catch { /* External host source identity is retained in the record itself. */ }
  }
  for (const [key, value] of Object.entries(document)) {
    if (['evidence', 'skill_refs', 'files', 'policy_refs', 'skills'].includes(key) && Array.isArray(value))
      for (const ref of value) if (typeof ref === 'string') { try { localPath(ref); refs.add(ref); } catch { /* Never expand source scope. */ } }
    if (['approval_ref', 'input_ref', 'entrypoint'].includes(key) && typeof value === 'string') { try { localPath(value); refs.add(value); } catch { /* Never expand source scope. */ } }
    if (value && typeof value === 'object') referencedPaths(value, refs, depth + 1, budget);
  }
}
async function collect(targetInput, policy, withBytes = false) {
  validateRetentionPolicy(policy); policy = structuredClone(policy);
  const target = await fs.realpath(targetInput), rows = [], contents = [], roots = [], refs = new Set(policy.protected_paths);
  let bytes = 0, allocated = 0, visited = 0;
  async function visit(ref, depth = 0) {
    if (++visited > policy.limits.max_files * 4 + 128 || depth > 32) throw Error('Retention directory bound exceeded');
    await safeDirectory(target, path.posix.dirname(ref) === '.' ? '.' : path.posix.dirname(ref));
    const stat = await fs.lstat(path.join(target, ref));
    if (stat.isSymbolicLink()) throw Error('Retention symlink source refused');
    if (stat.isDirectory()) {
      const directory = await safeDirectory(target, ref), names = [];
      const handle = await fs.opendir(directory);
      for await (const entry of handle) {
        if (names.length >= policy.limits.max_files * 4 + 128) throw Error('Retention directory entry bound exceeded');
        localPath(`${ref}/${entry.name}`); names.push(entry.name);
      }
      for (const name of names.sort()) await visit(`${ref}/${name}`, depth + 1);
      return;
    }
    if (!stat.isFile() || rows.length >= policy.limits.max_files) throw Error('Retention file inventory bound exceeded or nonregular source');
    const result = await readBytes(target, ref, Math.min(policy.limits.max_file_bytes, policy.limits.max_bytes - bytes));
    bytes += result.bytes.length; allocated += result.stat.allocated_bytes;
    if (bytes > policy.limits.max_bytes) throw Error('Retention total byte bound exceeded');
    if (ref.endsWith('.json') && canonicalReasons(ref).length) {
      let document;
      try { document = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(result.bytes)); }
      catch { throw Error('Canonical retention JSON cannot be inspected; preserve source and repair separately'); }
      referencedPaths(document, refs);
    }
    rows.push({path: ref, ...result.stat, sha256: sha256(result.bytes), protected: false, reasons: []});
    if (withBytes) contents.push({path: ref, bytes: result.bytes.length, sha256: sha256(result.bytes), content_base64: result.bytes.toString('base64')});
  }
  for (const root of [...policy.roots].sort()) {
    const prior = rows.length; await visit(root);
    roots.push({path: root, files: rows.length - prior, bytes: rows.slice(prior).reduce((n, row) => n + row.bytes, 0)});
  }
  for (const row of rows) {
    row.reasons = canonicalReasons(row.path);
    if (policy.protected_paths.some(root => under(row.path, root))) row.reasons.push('explicitly-protected');
    if (refs.has(row.path)) row.reasons.push('referenced-evidence-or-skill-source');
    row.protected = row.reasons.length > 0;
    if (!row.protected) row.reasons.push('retained-source-copy-only');
  }
  const dates = rows.map(row => row.modified_at).filter(Boolean).sort();
  const inventory = {schema_version: 'workkeel.retention-inventory/v1', roots, files: rows, file_count: rows.length,
    bytes, allocated_bytes: allocated, allocation_basis: 'File stat blocks per directory entry; shared physical blocks are not deduplicated.', oldest_modified_at: dates[0] ?? null, newest_modified_at: dates.at(-1) ?? null,
    protected_files: rows.filter(row => row.protected).length, protected_bytes: rows.filter(row => row.protected).reduce((n, row) => n + row.bytes, 0),
    reference_discovery: 'configured-paths-only', external_paths_read: false, tokens: null, execution_time_ms: null,
    authority: 'observation-only', mutation_status: 'no-write', execution_authorized: false};
  return {inventory, contents};
}
export async function inventoryRetention(target, policy) { return freeze((await collect(target, policy)).inventory); }
function buildPreview(policy, inventory) {
  // JSON/base64, receipt and gzip overhead upper bound; actual bytes are measured after writing.
  const upper = Math.ceil(inventory.bytes * 4 / 3) + inventory.files.reduce((n, f) => n + f.path.length * 2 + 2048, 0) + 16384;
  const body = {schema_version: 'workkeel.retention-preview/v1', policy, inventory, plan: {action: 'archive-copy', delete_sources: false,
    source_retained_bytes: inventory.bytes, protected_retained_bytes: inventory.protected_bytes, projected_archive_upper_bound_bytes: upper,
    projected_retained_bytes: inventory.bytes, projected_combined_upper_bound_bytes: inventory.bytes + upper, projected_released_bytes: 0,
    reasons: ['All original files remain intact.', 'Archive is an additional verified copy; this operation does not free source capacity.']},
    execution_authorized: false};
  return freeze({...body, sha256: digest(body)});
}
export async function previewRetention(target, policy) {
  validateRetentionPolicy(policy); policy = structuredClone(policy);
  return buildPreview(policy, await inventoryRetention(target, policy));
}

/** Final operation usage replaces provider cumulative snapshots, including explicit unknown values. */
export function summarizeRetentionUsage(samples) {
  if (!Array.isArray(samples) || samples.length > 4096) throw Error('Retention usage sample bound exceeded');
  const groups = new Map(), turns = new Map(); let duplicates = 0;
  for (const sample of samples) {
    keys(sample, ['source', 'sequence', 'kind', 'usage', 'elapsed_ms'], ['cost_source']); keys(sample.source, ['provider', 'thread_id', 'turn_id', 'operation_id']);
    for (const value of Object.values(sample.source)) id(value);
    integer(sample.sequence, 0);
    if (!['cumulative', 'final'].includes(sample.kind)) throw Error('Invalid retention usage sample kind');
    if (sample.cost_source !== undefined && !['provider-reported', 'policy-estimate', 'unknown'].includes(sample.cost_source)) throw Error('Invalid retention cost source');
    keys(sample.usage, METRICS);
    for (const [key, value] of Object.entries(sample.usage)) if (value !== null &&
      (!Number.isFinite(value) || value < 0 || key !== 'cost_usd' && !Number.isSafeInteger(value))) throw Error('Invalid retention usage metric');
    if (sample.elapsed_ms !== null) integer(sample.elapsed_ms, 0);
    const {operation_id, ...turnSource} = sample.source, turn = digest(turnSource);
    if (turns.has(turn) && turns.get(turn) !== operation_id) throw Error('Ambiguous overlapping provider turn sources cannot be counted as separate operations');
    turns.set(turn, operation_id);
    const key = digest(sample.source), prior = groups.get(key) ?? [];
    const same = prior.find(p => p.sequence === sample.sequence && p.kind === sample.kind);
    if (same) {
      if (digest(same) !== digest(sample)) throw Error('Conflicting duplicate usage source identity');
      duplicates++; continue;
    }
    if (sample.kind === 'final' && prior.some(p => p.kind === 'final')) throw Error('Conflicting final usage replacement');
    prior.push(structuredClone(sample)); groups.set(key, prior);
  }
  const chosen = [...groups.values()].map(group => group.find(s => s.kind === 'final') ?? group.sort((a, b) => b.sequence - a.sequence)[0])
    .sort((a, b) => digest(a.source).localeCompare(digest(b.source)));
  function total(values, complete, token = false) {
    const known = values.filter(v => v !== null), sum = known.reduce((n, v) => n + v, 0);
    const valid = Number.isFinite(sum) && (!token || Number.isSafeInteger(sum));
    const subtotal = known.length && valid ? sum : null;
    return {total: complete && known.length === values.length && subtotal !== null ? subtotal : null,
      known_subtotal: subtotal, observed_operations: known.length, total_operations: values.length,
      complete: complete && values.length > 0 && known.length === values.length && valid};
  }
  const complete = chosen.length > 0 && chosen.every(s => s.kind === 'final');
  return freeze({schema_version: 'workkeel.retention-usage-summary/v1', operations: chosen.length, duplicate_samples: duplicates,
    superseded_samples: samples.length - duplicates - chosen.length,
    usage: Object.fromEntries(METRICS.map(key => [key, total(chosen.map(s => key === 'cost_usd' && s.cost_source !== 'provider-reported' ? null : s.usage[key]), complete, key !== 'cost_usd')])),
    costs: Object.fromEntries(['provider-reported', 'policy-estimate', 'unknown'].map(kind => [kind,
      total(chosen.filter(s => (s.cost_source ?? 'unknown') === kind).map(s => s.usage.cost_usd), complete)])),
    elapsed_ms: total(chosen.map(s => s.elapsed_ms), complete, true), sources: chosen.map(s => ({...s.source, selected_sequence: s.sequence, selected_kind: s.kind})),
    source_coverage: 'explicit-operation-identities-only',
    timing_basis: 'Sum of reporter-declared operation elapsed measurements; parallel intervals may overlap. Not wall time or model compute time.',
    cost_basis: 'Provider-reported costs and policy estimates remain separate; no token-to-subscription invoice conversion.', provider_contact: false});
}

function previewBody(preview) {
  keys(preview, ['schema_version', 'policy', 'inventory', 'plan', 'execution_authorized', 'sha256']);
  if (preview.schema_version !== 'workkeel.retention-preview/v1' || preview.execution_authorized !== false) throw Error('Invalid retention preview');
  sha(preview.sha256); const {sha256: ignored, ...body} = preview;
  if (digest(body) !== preview.sha256) throw Error('Retention preview digest differs');
  validateRetentionPolicy(preview.policy);
  return body;
}
async function ensureIgnore(target, archiveRoot) {
  const directory = await safeDirectory(target, archiveRoot, {create: true}), ref = `${archiveRoot}/.gitignore`;
  try { await durableAtomicCreate(path.join(directory, '.gitignore'), '*\n'); }
  catch (error) { if (error.code !== 'EEXIST') throw error; if ((await readBytes(target, ref, 32)).bytes.toString() !== '*\n') throw Error('Retention private ignore policy changed'); }
  return directory;
}
async function verifyArchive(targetInput, request, {requireReceipt = true} = {}) {
  keys(request, ['archive_root', 'archive_id', 'limits'], ['expected_archive_sha256']); localPath(request.archive_root); id(request.archive_id); limits(request.limits);
  if (request.expected_archive_sha256 !== undefined) sha(request.expected_archive_sha256);
  if (!under(request.archive_root, '.ai-org/retention')) throw Error('Invalid private retention archive path');
  request = structuredClone(request); const target = await fs.realpath(targetInput);
  const compressedLimit = Math.ceil(request.limits.max_bytes * 4 / 3) + request.limits.max_files * 1536 + 8192;
  const archiveRef = `${request.archive_root}/${request.archive_id}.json.gz`;
  const compressed = (await readBytes(target, archiveRef, compressedLimit)).bytes;
  if (request.expected_archive_sha256 !== undefined && sha256(compressed) !== request.expected_archive_sha256) throw Error('Retention archive differs from expected digest');
  const plain = await unzip(compressed, {maxOutputLength: compressedLimit});
  const archive = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(plain));
  keys(archive, ['schema_version', 'preview_sha256', 'files']); sha(archive.preview_sha256);
  if (archive.schema_version !== 'workkeel.retention-archive/v1' || !Array.isArray(archive.files) || archive.files.length > request.limits.max_files) throw Error('Invalid bounded retention archive');
  const names = new Set(); let bytes = 0;
  for (const entry of archive.files) {
    keys(entry, ['path', 'bytes', 'sha256', 'content_base64']); localPath(entry.path); integer(entry.bytes, 0, request.limits.max_file_bytes); sha(entry.sha256);
    if (names.has(entry.path) || typeof entry.content_base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.content_base64)) throw Error('Invalid archive source identity or encoding');
    names.add(entry.path); const restored = Buffer.from(entry.content_base64, 'base64'); bytes += restored.length;
    if (restored.length !== entry.bytes || sha256(restored) !== entry.sha256 || bytes > request.limits.max_bytes) throw Error('Retention archive roundtrip digest failure');
  }
  const result = {schema_version: 'workkeel.retention-verification/v1', archive_ref: archiveRef, archive_sha256: sha256(compressed),
    preview_sha256: archive.preview_sha256, files: archive.files.map(({content_base64, ...entry}) => entry), source_bytes: bytes,
    archive_bytes: compressed.length, roundtrip_verified: true, originals_read: false, deletion_performed: false};
  try {
    const receipt = JSON.parse((await readBytes(target, `${request.archive_root}/${request.archive_id}-receipt.json`, request.limits.max_files * 2048 + 16384)).bytes.toString('utf8'));
    keys(receipt, ['value', 'sha256']);
    if (digest(receipt.value) !== receipt.sha256 || receipt.value?.schema_version !== 'workkeel.retention-receipt/v1' || receipt.value.archive_id !== request.archive_id ||
        digest(receipt.value.verification) !== digest(result)) throw Error('Retention archive differs from its preserved receipt');
  } catch (error) { if (error.code !== 'ENOENT' || requireReceipt) throw error; }
  return freeze(result);
}
export async function verifyRetentionArchive(target, request) { return verifyArchive(target, request); }
export async function applyRetentionArchive(targetInput, request) {
  keys(request, ['task_id', 'actor', 'claim_id', 'contract_sha256', 'expected_task_version', 'preview', 'expected_preview_sha256', 'archive_id']);
  id(request.task_id); id(request.claim_id); id(request.archive_id); integer(request.expected_task_version, 1); sha(request.contract_sha256); sha(request.expected_preview_sha256);
  previewBody(request.preview);
  if (request.expected_preview_sha256 !== request.preview.sha256) throw Error('Expected retention preview digest differs');
  request = structuredClone(request); const target = await fs.realpath(targetInput);
  return withProjectMutationLock(target, async () => {
    const task = await assertTaskExecutionContext(target, request.task_id, request), policy = request.preview.policy;
    if (task.version !== request.expected_task_version) throw Error('Stale retention task version');
    if (!task.contract.authorization.operations.includes('write') || !task.contract.authorization.operations.includes('read')) throw Error('Retention requires task read and write authority');
    if (task.contract.authorization.expires_at !== null && Date.parse(task.contract.authorization.expires_at) <= Date.now()) throw Error('Retention task approval expired');
    const environment = task.contract.environment;
    if (!policy.roots.every(ref => environment.read_paths.some(root => under(ref, root))) || !environment.write_paths.some(root => under(policy.archive_root, root))) throw Error('Retention paths exceed the task read/write scope');
    const {inventory, contents} = await collect(target, policy, true);
    if (digest(inventory) !== digest(request.preview.inventory)) throw Error('Retention source changed after preview; inspect a fresh preview');
    if (buildPreview(policy, inventory).sha256 !== request.preview.sha256) throw Error('Retention preview plan differs from the supported archive-copy plan');
    const archive = {schema_version: 'workkeel.retention-archive/v1', preview_sha256: request.preview.sha256, files: contents};
    const compressed = await zip(Buffer.from(formatJson(archive)));
    if (digest((await collect(target, policy)).inventory) !== digest(inventory)) throw Error('Retention source changed while preparing archive');
    const directory = await ensureIgnore(target, policy.archive_root), ref = `${policy.archive_root}/${request.archive_id}.json.gz`;
    try { await durableAtomicCreate(path.join(directory, `${request.archive_id}.json.gz`), compressed); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (sha256((await readBytes(target, ref, compressed.length)).bytes) !== sha256(compressed)) throw Error('Archive identity already used with different content'); }
    const verified = await verifyArchive(target, {archive_root: policy.archive_root, archive_id: request.archive_id, limits: policy.limits}, {requireReceipt: false});
    if (verified.preview_sha256 !== request.preview.sha256 || digest(verified.files) !== digest(contents.map(({content_base64, ...entry}) => entry))) throw Error('Retention receipt does not match the exact preview files');
    const receipt = {schema_version: 'workkeel.retention-receipt/v1', archive_id: request.archive_id, preview_sha256: request.preview.sha256,
      task_pin: {task_id: task.id, task_version: task.version, contract_sha256: task.contract_sha256, claim_id: task.claim.id, actor: request.actor},
      verification: verified, retained_source_bytes: inventory.bytes, protected_retained_bytes: inventory.protected_bytes,
      receipt_bytes: 0, ignore_bytes: 2, combined_retained_bytes: inventory.bytes + verified.archive_bytes + 2,
      released_bytes: 0, originals_modified: false, deletion_performed: false};
    // Include this receipt's exact serialized length in retained-capacity accounting.
    let envelope;
    for (let pass = 0; pass < 10; pass++) {
      envelope = formatJson({value: receipt, sha256: digest(receipt)});
      const size = Buffer.byteLength(envelope);
      if (receipt.receipt_bytes === size) break;
      receipt.receipt_bytes = size; receipt.combined_retained_bytes = inventory.bytes + verified.archive_bytes + 2 + size;
      if (pass === 9) throw Error('Retention receipt byte accounting did not settle');
    }
    const receiptRef = `${policy.archive_root}/${request.archive_id}-receipt.json`;
    try { await durableAtomicCreate(path.join(directory, `${request.archive_id}-receipt.json`), envelope); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if ((await readBytes(target, receiptRef, policy.limits.max_files * 2048 + 16384)).bytes.toString() !== envelope) throw Error('Archive receipt identity already used with different authority'); }
    return freeze({...receipt, receipt_ref: receiptRef, execution_authorized: false});
  });
}
