import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executionDigest } from '../src/workkeel-execution-policy.mjs';
import { startLoopRun, readLoopRun, countLoopOperation, withLoopRun, requestLoopStop, confirmLoopStop, clearLoopStop, assertLoopAdmission, LOOP_MAX_WALL_MS } from '../src/workkeel-loop-run.mjs';
import { execFileSync } from 'node:child_process';
import { initializeTaskProject } from '../src/workkeel-project.mjs';
import { prepareDispatchTicket } from '../src/workkeel-dispatch.mjs';
import { admitGoalImprovement } from '../src/workkeel-autonomy-admission.mjs';
import { createNativeTask, mutateNativeTask, assertTaskExecutionContext } from '../src/workkeel-tasks.mjs';

const costPath = { path: 'synthetic-local-host', billing: 'local' }, authorizeUser = async () => true;
const approval = () => ({ id: 'trial-one', goal_id: 'one', proposal_sha256: 'a'.repeat(64), baseline_sha256: 'b'.repeat(64), cost_path: costPath });
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workkeel-loop-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function changeClock(root, remaining) {
  const file = path.join(root, '.ai-org/loop/run.json'), e = JSON.parse(await fs.readFile(file, 'utf8'));
  e.value.deadline = new Date(Date.now() + remaining).toISOString();
  e.value.started_at = new Date(Date.parse(e.value.deadline) - LOOP_MAX_WALL_MS).toISOString();
  e.sha256 = executionDigest(e.value); await fs.writeFile(file, JSON.stringify(e));
}
test('zero API spend fails closed before starting: missing proof, unknown, API and unapproved paths', async t => {
  const root = await fixture(t);
  for (const actual of [undefined, { path: 'x', billing: 'api' }, { path: 'x', billing: 'unknown' }, { path: 'another-host', billing: 'local' }]) {
    await assert.rejects(startLoopRun(root, approval(), { authorizeUser, costPath: actual }));
    assert.equal(await readLoopRun(root), null);
  }
  await assert.rejects(startLoopRun(root, approval(), { costPath }), /user approval/);
  const state = await startLoopRun(root, approval(), { authorizeUser, costPath });
  assert.equal(Date.parse(state.deadline) - Date.parse(state.started_at), 7200000);
});
test('all attempts share 60 operations, including failed native, admission and dispatch attempts and nested jobs', async t => {
  const root = await fixture(t); await startLoopRun(root, approval(), { authorizeUser, costPath });
  await assert.rejects(prepareDispatchTicket(root, {}));
  await assert.rejects(admitGoalImprovement(root, {}), /one L2/);
  await assert.rejects(mutateNativeTask(root, 'missing', 'claim', {}));
  assert.equal((await readLoopRun(root)).operations, 3);
  await withLoopRun(root, 'one', { costPath }, async () => {
    // A sub-job's different target never creates a fresh allowance.
    await countLoopOperation('nested-check', path.join(root, 'child'));
  }, async () => []);
  assert.equal((await readLoopRun(root)).operations, 4);
  for (let n = 4; n < 60; n++) await countLoopOperation('failed-attempt', root);
  await assert.rejects(countLoopOperation('sixty-first', root), /budget/);
  const s = await readLoopRun(root); assert.equal(s.operations, 60); assert.equal(s.stop.requested, true);
  await assert.rejects(assertLoopAdmission(root, 'another'), /stop/);
});
test('persistent stop closes admission before cancellation; restart and user clearing preserve budgets and one L2', async t => {
  const root = await fixture(t); const original = await startLoopRun(root, approval(), { authorizeUser, costPath });
  await countLoopOperation('work', root); await requestLoopStop(root);
  let cancelled = false;
  await assert.rejects(withLoopRun(root, 'one', { costPath }, async () => assert.fail('dispatch after stop'), async () => {
    cancelled = true; assert.equal((await readLoopRun(root)).stop.requested, true);
    await assert.rejects(prepareDispatchTicket(root, {}), /stop/); return [];
  }), /stop/);
  assert.equal(cancelled, true);
  // A fresh module/context reads the retained flag, not an in-memory reset.
  const restarted = await import('../src/workkeel-loop-run.mjs?restart');
  assert.equal((await restarted.readLoopRun(root)).stop.confirmed, true);
  await assert.rejects(clearLoopStop(root), /only the user/);
  await assert.rejects(clearLoopStop(root, { authorizeUser: async () => false }), /only the user/);
  const cleared = await clearLoopStop(root, { authorizeUser });
  assert.equal(cleared.operations, 1); assert.equal(cleared.deadline, original.deadline); assert.equal(cleared.status, 'stopped');
  await assert.rejects(startLoopRun(root, approval(), { authorizeUser, costPath }), /one L2/);
  await countLoopOperation('more', root);
  assert.equal((await readLoopRun(root)).operations, 1);
});
test('unknown cancellation remains explicit and cannot be cleared', async t => {
  const root = await fixture(t); await startLoopRun(root, approval(), { authorizeUser, costPath });
  await requestLoopStop(root); await confirmLoopStop(root, ['operation-unknown']);
  const run = await readLoopRun(root); assert.equal(run.stop.confirmed, false); assert.deepEqual(run.stop.unknown, ['operation-unknown']);
  await assert.rejects(clearLoopStop(root, { authorizeUser }), /unknown/);
});
test('whole wall-clock includes pause/restart; expiry interrupts an in-flight wait after admission closes', async t => {
  const root = await fixture(t); await startLoopRun(root, approval(), { authorizeUser, costPath });
  await changeClock(root, -1);
  await assert.rejects(assertLoopAdmission(root, 'one'), /exhausted/);
  assert.equal((await readLoopRun(root)).stop.requested, true);
  const active = await fixture(t); await startLoopRun(active, approval(), { authorizeUser, costPath }); await changeClock(active, 60);
  let settle;
  const result = await withLoopRun(active, 'one', { costPath }, () => new Promise(resolve => { settle = resolve; }), async () => {
    assert.equal((await readLoopRun(active)).stop.requested, true); settle('cancelled'); return [];
  });
  assert.equal(result, 'cancelled');
});

test('an uncooperative wait cannot extend the absolute deadline and unknown cancellation stays visible', async t => {
  const root = await fixture(t); await startLoopRun(root, approval(), { authorizeUser, costPath }); await changeClock(root, 40);
  await assert.rejects(withLoopRun(root, 'one', { costPath }, () => new Promise(() => {}), async () => ['uncooperative-host']), /stopped/);
  const state = await readLoopRun(root); assert.equal(state.stop.requested, true); assert.equal(state.stop.confirmed, false);
  assert.deepEqual(state.stop.unknown, ['uncooperative-host']);
});

test('persisted cancellation reservations keep the 60th slot available after exhaustion and restart',async t=>{
  const {reserveLoopCancellation,countLoopCancellationOperation}=await import('../src/workkeel-loop-run.mjs');
  const root=await fixture(t);await startLoopRun(root,approval(),{authorizeUser,costPath});
  await assert.rejects(withLoopRun(root,'one',{costPath},async()=>{
    await reserveLoopCancellation('host-one');
    for(let i=0;i<59;i++)await countLoopOperation('work');
    await countLoopOperation('would-steal-cancellation-slot');
  },async()=>{
    const restarted=await import('../src/workkeel-loop-run.mjs?cancellation-restart');
    assert.equal((await restarted.readLoopRun(root)).stop.requested,true);
    assert.equal(await countLoopCancellationOperation('host-cancel',root,'host-one'),true);
    return [];
  }),/budget/);
  const run=await readLoopRun(root);assert.equal(run.operations,60);assert.deepEqual(run.cancellation_reservations,[]);assert.equal(run.stop.confirmed,true);
});

test('goal acceptance leaves the same allowance for comparison; normal comparison completion ends it',async t=>{
  const {finishLoopRun}=await import('../src/workkeel-loop-run.mjs');
  const root=await fixture(t);await startLoopRun(root,approval(),{authorizeUser,costPath});
  await withLoopRun(root,'one',{costPath},async()=>({accepted:true}),async()=>[]);
  await countLoopOperation('comparison',root);assert.equal((await readLoopRun(root)).operations,1);
  const final=await finishLoopRun(root);assert.equal(final.status,'completed');assert.equal(final.stop.requested,false);
  await countLoopOperation('extra-dispatch',root);
  assert.equal((await readLoopRun(root)).operations,1);
  await assert.rejects(startLoopRun(root,approval(),{authorizeUser,costPath}),/one L2/);
});

test('normal completion cannot hide wall-clock expiry during comparison',async t=>{
  const {finishLoopRun}=await import('../src/workkeel-loop-run.mjs');
  const root=await fixture(t);await startLoopRun(root,approval(),{authorizeUser,costPath});
  await countLoopOperation('comparison',root);await changeClock(root,-1);
  await assert.rejects(finishLoopRun(root),/wall-clock/);
  const state=await readLoopRun(root);assert.equal(state.stop.requested,true);assert.equal(state.status,'stopped');
});

for (const terminal of ['finish', 'clear']) test(`ordinary task claims resume after ${terminal} without reopening L2`, async t => {
  const root = await fixture(t), builder = { agent_id: 'builder', principal_id: 'owner' };
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  await fs.mkdir(path.join(root, 'docs')); await fs.writeFile(path.join(root, 'docs/approval.md'), 'Synthetic approval.\n');
  await initializeTaskProject(root, { schema_version: 'workkeel.task-policy/v1', principals: ['owner'], agents: [builder, {agent_id:'reviewer',principal_id:'owner'}], approvers: ['owner'], review_separation: 'distinct-agent' });
  git('add', 'docs/approval.md'); git('commit', '-qm', 'Synthetic base');
  const task = { schema_version: 'workkeel.task-contract/v2', id: 'WK-ordinary', goal: 'Synthetic ordinary task', state: 'intake',
    scope: { include: ['Synthetic work'], exclude: [] }, actor: builder, dependencies: [], acceptance: { criteria: ['Reviewed'], evidence: [] }, handoff: null,
    verification: { risk_tier: 'standard', separation: 'distinct-agent', implementer: null, reviewer: null, candidate_revision: null },
    environment: { cwd: '.', read_paths: ['.'], write_paths: ['docs'], tools: ['node'], resources: [], network: { mode: 'none', hosts: [] }, external_actions: [], data: { classification: 'internal', model_access: 'none', policy_refs: ['docs/approval.md'] } },
    authorization: { approved_by: 'owner', approval_ref: 'docs/approval.md', operations: ['read', 'write', 'execute'], expires_at: null }, skills: [],
    execution: { runtime: { kind: 'host-owned', adapter_id: null, required_features: [] }, model_connection: { kind: 'native' } } };
  await startLoopRun(root, approval(), { authorizeUser, costPath });
  if (terminal === 'finish') { const { finishLoopRun } = await import('../src/workkeel-loop-run.mjs'); await finishLoopRun(root); }
  else { await requestLoopStop(root); await confirmLoopStop(root); await clearLoopStop(root, { authorizeUser }); }
  // Even an expired terminal deadline no longer governs ordinary work.
  await changeClock(root, -1);
  const before = await fs.readFile(path.join(root, '.ai-org/loop/run.json'), 'utf8');
  await createNativeTask(root, task, { expected_version: 0, operation_id: 'create-ordinary', actor: builder });
  const claimed = await mutateNativeTask(root, task.id, 'claim', { expected_version: 1, operation_id: 'claim-ordinary', actor: builder, base_revision: git('rev-parse', 'HEAD') });
  assert.ok(claimed.claim.id);
  await assertTaskExecutionContext(root, task.id, { actor: builder, claim_id: claimed.claim.id });
  assert.equal(await assertLoopAdmission(root, 'another-goal'), null);
  // These invalid requests reach ordinary validation, rather than a loop gate.
  await assert.rejects(prepareDispatchTicket(root, {}), error => !error.message.startsWith('Loop run:'));
  await assert.rejects(admitGoalImprovement(root, {}), error => !error.message.startsWith('Loop run:'));
  await requestLoopStop(root); // Ordinary goal cancellation must not reactivate the old ledger.
  assert.equal(await fs.readFile(path.join(root, '.ai-org/loop/run.json'), 'utf8'), before);
  await assert.rejects(startLoopRun(root, approval(), { authorizeUser, costPath }), /one L2/);
});
