import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executionDigest } from '../src/workkeel-execution-policy.mjs';
import { startLoopRun, readLoopRun, countLoopOperation, withLoopRun, requestLoopStop, confirmLoopStop, clearLoopStop, assertLoopAdmission, LOOP_MAX_WALL_MS } from '../src/workkeel-loop-run.mjs';
import { prepareDispatchTicket } from '../src/workkeel-dispatch.mjs';
import { admitGoalImprovement } from '../src/workkeel-autonomy-admission.mjs';
import { mutateNativeTask } from '../src/workkeel-tasks.mjs';

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
  assert.equal((await readLoopRun(root)).operations, 5);
  for (let n = 5; n < 60; n++) await countLoopOperation('failed-attempt', root);
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
  await assert.rejects(countLoopOperation('more', root), /stop/);
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
    for(let i=1;i<59;i++)await countLoopOperation('work');
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
  await countLoopOperation('comparison',root);assert.equal((await readLoopRun(root)).operations,2);
  const final=await finishLoopRun(root);assert.equal(final.status,'completed');assert.equal(final.stop.requested,false);
  await assert.rejects(countLoopOperation('extra-dispatch',root),/stop/);
});

test('normal completion cannot hide wall-clock expiry during comparison',async t=>{
  const {finishLoopRun}=await import('../src/workkeel-loop-run.mjs');
  const root=await fixture(t);await startLoopRun(root,approval(),{authorizeUser,costPath});
  await countLoopOperation('comparison',root);await changeClock(root,-1);
  await assert.rejects(finishLoopRun(root),/wall-clock/);
  const state=await readLoopRun(root);assert.equal(state.stop.requested,true);assert.equal(state.status,'stopped');
});
