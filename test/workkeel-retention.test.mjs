import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {gzipSync, gunzipSync} from 'node:zlib';
import {validateRetentionPolicy, inventoryRetention, previewRetention, applyRetentionArchive, verifyRetentionArchive, summarizeRetentionUsage} from '../src/workkeel-retention.mjs';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake, applyTaskIntake} from '../src/workkeel-intake.mjs';
import {mutateNativeTask, readNativeTask} from '../src/workkeel-tasks.mjs';
import {formatJson, sha256} from '../src/files.mjs';

const policy = roots => ({schema_version: 'workkeel.retention-policy/v1', roots: roots ?? ['logs'], protected_paths: [],
  archive_root: '.ai-org/retention', limits: {max_files: 64, max_bytes: 1024 * 1024, max_file_bytes: 65536}});
async function directory(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'workkeel-retention-')));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.mkdir(root + '/logs'); return root;
}
const sample = (kind, sequence, usage, extra = {}) => ({source: {provider: 'synthetic', thread_id: 'thread-one', turn_id: 'turn-one', operation_id: 'op-one'},
  kind, sequence, usage: {input_tokens: usage[0], output_tokens: usage[1], cost_usd: usage[2] ?? null}, elapsed_ms: null, ...extra});

test('explicit inventory reports exact byte capacity and empty times remain unknown', async t => {
  const root = await directory(t);
  const empty = await inventoryRetention(root, policy());
  assert.equal(empty.bytes, 0); assert.equal(empty.file_count, 0); assert.equal(empty.oldest_modified_at, null); assert.equal(empty.tokens, null); assert.equal(empty.execution_time_ms, null);
  await fs.writeFile(root + '/logs/one.bin', Buffer.from([0, 1, 255])); await fs.writeFile(root + '/logs/two.txt', 'abcde');
  const view = await inventoryRetention(root, policy());
  assert.equal(view.bytes, 8); assert.equal(view.file_count, 2); assert.equal(view.roots[0].bytes, 8);
  assert.ok(view.oldest_modified_at && view.newest_modified_at); assert.ok(view.allocated_bytes >= 8);
  assert.equal(view.external_paths_read, false); assert.equal(view.tokens, null);
  const preview = await previewRetention(root, policy());
  assert.equal(preview.plan.projected_retained_bytes, 8); assert.equal(preview.plan.projected_released_bytes, 0);
  assert.ok(preview.plan.projected_combined_upper_bound_bytes > 8); assert.equal(preview.plan.delete_sources, false);
});

test('no symlink reads, external paths, overlapping roots, excess counts or bytes', async t => {
  const root = await directory(t); await fs.writeFile(root + '/outside.txt', 'outside');
  await fs.symlink(root + '/outside.txt', root + '/logs/link');
  await assert.rejects(inventoryRetention(root, policy()), /symlink/);
  await fs.unlink(root + '/logs/link'); await fs.symlink(root + '/logs', root + '/alias');
  await assert.rejects(inventoryRetention(root, policy(['alias'])), /symlink/);
  for (const roots of [['.'], ['../outside'], ['/tmp/logs'], ['logs', 'logs/nested'], ['.git/config']]) assert.throws(() => validateRetentionPolicy(policy(roots)));
  await fs.writeFile(root + '/logs/one', '12345'); await fs.writeFile(root + '/logs/two', '67890');
  const p = policy(); p.limits.max_files = 1;
  await assert.rejects(inventoryRetention(root, p), /bound/);
  p.limits.max_files = 64; p.limits.max_bytes = 6; p.limits.max_file_bytes = 6;
  await assert.rejects(inventoryRetention(root, p), /bounded|bound/);
  p.limits.max_bytes = 100; p.limits.max_file_bytes = 4;
  await assert.rejects(inventoryRetention(root, p), /bounded/);
  assert.throws(() => validateRetentionPolicy({...policy(), roots: Array(1)}));
});

test('canonical task references, learning provenance, Skill versions and host identity receive protection reasons', async t => {
  const root = await directory(t);
  await fs.mkdir(root + '/.ai-org/work-items', {recursive: true});
  await fs.mkdir(root + '/.ai-org/learning/native', {recursive: true});
  await fs.mkdir(root + '/.ai-org/host-usage/source-one', {recursive: true});
  await fs.mkdir(root + '/.agents/skills/local-skill/1.0.0', {recursive: true});
  await fs.writeFile(root + '/.ai-org/work-items/WK-synthetic.json', JSON.stringify({delivery: {evidence: [{path: 'logs/review.txt', sha256: 'a'.repeat(64)}]}, review: {evidence: ['logs/review.txt']}}));
  await fs.writeFile(root + '/.ai-org/learning/native/one.json', JSON.stringify({pins: [{path: 'logs/provenance.txt', sha256: 'b'.repeat(64)}], skill_refs: ['.agents/skills/local-skill/1.0.0/SKILL.md']}));
  await fs.writeFile(root + '/.ai-org/host-usage/source-one/binding.json', JSON.stringify({source: {path: '/outside/provider/history', thread_id: 'keep-thread', turn_id: 'keep-turn'}}));
  await fs.writeFile(root + '/.agents/skills/local-skill/1.0.0/SKILL.md', 'Synthetic immutable Skill version');
  await fs.writeFile(root + '/logs/review.txt', 'exact acceptance'); await fs.writeFile(root + '/logs/provenance.txt', 'exact learning source');
  const inventory = await inventoryRetention(root, policy(['logs', '.ai-org/work-items', '.ai-org/learning', '.ai-org/host-usage', '.agents/skills']));
  assert.equal(inventory.protected_files, 6);
  for (const name of ['logs/review.txt', 'logs/provenance.txt']) assert.ok(inventory.files.find(f => f.path === name).reasons.includes('referenced-evidence-or-skill-source'));
  assert.ok(inventory.files.find(f => f.path.endsWith('binding.json')).reasons.includes('host-source-identity-history'));
  assert.ok(inventory.files.find(f => f.path.endsWith('SKILL.md')).reasons.includes('skill-version-source'));
});

test('final usage supersedes cumulative samples exactly once, including explicit unknown replacement', () => {
  const cumulative = sample('cumulative', 1, [10, 3, 1], {elapsed_ms: 12, cost_source: 'provider-reported'});
  const final = sample('final', 2, [12, 4, 2], {elapsed_ms: 15, cost_source: 'provider-reported'});
  const summary = summarizeRetentionUsage([cumulative, final, structuredClone(final)]);
  assert.equal(summary.operations, 1); assert.equal(summary.duplicate_samples, 1); assert.equal(summary.superseded_samples, 1);
  assert.equal(summary.usage.input_tokens.total, 12); assert.equal(summary.usage.output_tokens.total, 4); assert.equal(summary.elapsed_ms.total, 15);
  assert.equal(summary.usage.cost_usd.total, 2);
  const unknown = sample('final', 2, [null, null, null]);
  const replaced = summarizeRetentionUsage([cumulative, unknown]);
  assert.equal(replaced.usage.input_tokens.total, null); assert.equal(replaced.usage.input_tokens.known_subtotal, null); assert.equal(replaced.elapsed_ms.known_subtotal, null);
});

test('unknown is never zero; real zero stays zero and cumulative totals remain partial', () => {
  assert.equal(summarizeRetentionUsage([]).usage.input_tokens.known_subtotal, null);
  const zeros = summarizeRetentionUsage([sample('final', 0, [0, 0, 0], {elapsed_ms: 0, cost_source: 'provider-reported'})]);
  assert.equal(zeros.usage.input_tokens.total, 0); assert.equal(zeros.elapsed_ms.total, 0); assert.equal(zeros.usage.cost_usd.total, 0);
  const partial = summarizeRetentionUsage([sample('cumulative', 0, [0, 2, null])]);
  assert.equal(partial.usage.input_tokens.known_subtotal, 0); assert.equal(partial.usage.input_tokens.total, null); assert.equal(partial.elapsed_ms.total, null);
});

test('cost estimates are distinct from provider reports and ambiguous overlapping sources fail closed', () => {
  const estimate = sample('final', 0, [10, 2, 0.25], {cost_source: 'policy-estimate'});
  const summary = summarizeRetentionUsage([estimate]);
  assert.equal(summary.usage.cost_usd.total, null); assert.equal(summary.costs['policy-estimate'].total, 0.25); assert.equal(summary.costs['provider-reported'].total, null);
  const conflicting = structuredClone(estimate); conflicting.usage.input_tokens = 50;
  assert.throws(() => summarizeRetentionUsage([estimate, conflicting]), /Conflicting duplicate/);
  conflicting.sequence = 1; assert.throws(() => summarizeRetentionUsage([estimate, conflicting]), /Conflicting final/);
  conflicting.source.operation_id = 'different-operation';
  assert.throws(() => summarizeRetentionUsage([estimate, conflicting]), /overlapping provider turn/);
  assert.throws(() => summarizeRetentionUsage(Array(1)));
  assert.throws(() => summarizeRetentionUsage([sample('final', 1, [-1, null, null])]));
});

async function fixture(t, {readPaths = ['.'], writePaths = ['.']} = {}) {
  const root = await directory(t);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
  const actor = {agent_id: 'builder', principal_id: 'owner'};
  await initializeTaskProject(root, {schema_version: 'workkeel.task-policy/v1', principals: ['owner'], agents: [actor], approvers: ['owner'], review_separation: 'distinct-agent'});
  await fs.mkdir(root + '/docs'); await fs.writeFile(root + '/docs/approval.md', 'Synthetic retention authority'); await fs.writeFile(root + '/logs/source.bin', Buffer.from([0, 255, 1, 2, 0, 3]));
  git('add', '.'); git('commit', '-qm', 'Synthetic fixture');
  const brief = {schema_version: 'workkeel.task-brief/v1', id: 'WK-retention', goal: 'Synthetic safe retention', actor, acceptance: ['Exact source preserved'],
    environment: {cwd: '.', read_paths: readPaths, write_paths: writePaths, tools: ['node'], resources: [], network: {mode: 'none', hosts: []}, external_actions: [],
      data: {classification: 'internal', model_access: 'approved-connection', policy_refs: ['docs/approval.md']}},
    authorization: {approved_by: 'owner', approval_ref: 'docs/approval.md', operations: ['read', 'write', 'execute'], expires_at: null}};
  const preview = await previewTaskIntake(root, brief); await applyTaskIntake(root, brief, preview.fingerprint);
  await mutateNativeTask(root, brief.id, 'claim', {operation_id: 'claim', expected_version: 1, actor, base_revision: git('rev-parse', 'HEAD')});
  const task = await readNativeTask(root, brief.id);
  const request = {task_id: task.id, actor, claim_id: task.claim.id, contract_sha256: task.contract_sha256, expected_task_version: task.version, archive_id: 'archive-one'};
  return {root, request, task};
}
async function archiveRequest(f, p = policy()) {
  const preview = await previewRetention(f.root, p); return {...f.request, preview, expected_preview_sha256: preview.sha256};
}

test('digest-bound archive has a verified receipt, preserves originals and replays safely', async t => {
  const f = await fixture(t), request = await archiveRequest(f);
  const original = await fs.readFile(f.root + '/logs/source.bin'), taskBytes = await fs.readFile(f.root + '/.ai-org/work-items/WK-retention.json');
  const receipt = await applyRetentionArchive(f.root, request);
  assert.equal(receipt.verification.roundtrip_verified, true); assert.equal(receipt.retained_source_bytes, original.length); assert.equal(receipt.released_bytes, 0);
  assert.ok(receipt.combined_retained_bytes > original.length); assert.equal(receipt.deletion_performed, false);
  assert.equal(receipt.receipt_bytes, (await fs.readFile(f.root + '/' + receipt.receipt_ref)).length);
  assert.equal(receipt.combined_retained_bytes, original.length + receipt.verification.archive_bytes + receipt.receipt_bytes + receipt.ignore_bytes);
  assert.ok(receipt.combined_retained_bytes <= request.preview.plan.projected_combined_upper_bound_bytes);
  assert.deepEqual(await fs.readFile(f.root + '/logs/source.bin'), original); assert.deepEqual(await fs.readFile(f.root + '/.ai-org/work-items/WK-retention.json'), taskBytes);
  assert.equal(await fs.readFile(f.root + '/.ai-org/retention/.gitignore', 'utf8'), '*\n');
  assert.equal(execFileSync('git', ['-C', f.root, 'check-ignore', '--', receipt.receipt_ref], {encoding: 'utf8'}).trim(), receipt.receipt_ref);
  const verified = await verifyRetentionArchive(f.root, {archive_root: '.ai-org/retention', archive_id: 'archive-one', limits: policy().limits, expected_archive_sha256: receipt.verification.archive_sha256});
  assert.deepEqual(verified, receipt.verification); assert.deepEqual(await applyRetentionArchive(f.root, request), receipt);
});

test('changed/new sources, stale versions, tampered preview and narrowed authority cannot archive', async t => {
  const f = await fixture(t), request = await archiveRequest(f);
  await fs.writeFile(f.root + '/logs/source.bin', 'changed');
  await assert.rejects(applyRetentionArchive(f.root, request), /source changed after preview/);
  const fresh = await archiveRequest(f); await fs.writeFile(f.root + '/logs/new.txt', 'new');
  await assert.rejects(applyRetentionArchive(f.root, fresh), /source changed after preview/);
  const latest = await archiveRequest(f);
  await assert.rejects(applyRetentionArchive(f.root, {...latest, expected_task_version: 1}), /Stale retention task version/);
  const altered = structuredClone(latest); altered.preview.plan.delete_sources = true;
  await assert.rejects(applyRetentionArchive(f.root, altered), /preview digest differs/);
  const {sha256: oldDigest, ...body} = altered.preview;
  altered.preview.sha256 = sha256(formatJson(body)); altered.expected_preview_sha256 = altered.preview.sha256;
  await assert.rejects(applyRetentionArchive(f.root, altered), /supported archive-copy plan/);
  const narrow = await fixture(t, {writePaths: ['logs']});
  await assert.rejects(applyRetentionArchive(narrow.root, await archiveRequest(narrow)), /read\/write scope/);
});

test('protected acceptance/provenance/host records remain exact through an archive copy', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.root + '/.ai-org/host-usage/example', {recursive: true});
  await fs.writeFile(f.root + '/.ai-org/host-usage/example/binding.json', JSON.stringify({source: {thread_id: 'immutable-thread', turn_id: 'immutable-turn'}, checkpoint: {ino: '10', dev: '20'}}));
  const p = policy(['logs', '.ai-org/work-items', '.ai-org/host-usage']); p.protected_paths = ['logs/source.bin'];
  const request = await archiveRequest(f, p), before = new Map();
  for (const file of request.preview.inventory.files) before.set(file.path, await fs.readFile(path.join(f.root, file.path)));
  const result = await applyRetentionArchive(f.root, request);
  assert.equal(result.protected_retained_bytes, result.retained_source_bytes);
  for (const [file, bytes] of before) assert.deepEqual(await fs.readFile(path.join(f.root, file)), bytes);
});

test('roundtrip verification detects corrupted archive, preserved receipt mismatch and expected digest mismatch', async t => {
  const f = await fixture(t), request = await archiveRequest(f), receipt = await applyRetentionArchive(f.root, request);
  const verify = {archive_root: '.ai-org/retention', archive_id: 'archive-one', limits: policy().limits};
  await assert.rejects(verifyRetentionArchive(f.root, {...verify, expected_archive_sha256: '0'.repeat(64)}), /expected digest/);
  const file = f.root + '/' + receipt.verification.archive_ref, original = await fs.readFile(file);
  const data = JSON.parse(gunzipSync(original)); data.files[0].content_base64 = Buffer.from('wrong').toString('base64');
  await fs.writeFile(file, gzipSync(JSON.stringify(data)));
  await assert.rejects(verifyRetentionArchive(f.root, verify), /roundtrip digest/);
  await fs.writeFile(file, gzipSync(JSON.stringify(JSON.parse(gunzipSync(original)))));
  await assert.rejects(verifyRetentionArchive(f.root, verify), /preserved receipt/);
  await fs.writeFile(file, original);
  const receiptFile = f.root + '/' + receipt.receipt_ref, envelope = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  envelope.value.verification.archive_sha256 = '0'.repeat(64); await fs.writeFile(receiptFile, JSON.stringify(envelope));
  await assert.rejects(verifyRetentionArchive(f.root, verify), /preserved receipt/);
});

test('archive write refuses symlink storage and verification requires its exact receipt', async t => {
  const f = await fixture(t), request = await archiveRequest(f);
  await fs.mkdir(f.root + '/external'); await fs.symlink(f.root + '/external', f.root + '/.ai-org/retention');
  await assert.rejects(applyRetentionArchive(f.root, request), /symlinks|non-directories/);
  assert.deepEqual(await fs.readdir(f.root + '/external'), []);
  await fs.unlink(f.root + '/.ai-org/retention');
  const receipt = await applyRetentionArchive(f.root, request);
  await fs.rename(f.root + '/' + receipt.receipt_ref, f.root + '/' + receipt.receipt_ref + '.saved');
  await assert.rejects(verifyRetentionArchive(f.root, {archive_root: '.ai-org/retention', archive_id: 'archive-one', limits: policy().limits}), error => error.code === 'ENOENT');
});
