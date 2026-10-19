import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { readTaskFile } from './task-contract.mjs';
import { safeDirectory } from './workkeel-project.mjs';
import { durableAtomicCreate, durableAtomicWrite, formatJson } from './files.mjs';
import { executionDigest, exactKeys } from './workkeel-execution-policy.mjs';
import { withProjectMutationLock } from './workkeel-lock.mjs';

export const LOOP_MAX_OPERATIONS = 60;
export const LOOP_MAX_WALL_MS = 2 * 60 * 60 * 1000;
const REF = '.ai-org/loop/run.json', context = new AsyncLocalStorage();
const fail = message => { throw Error('Loop run: ' + message); };
const id = value => { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value ?? '')) fail('invalid identity'); };
// Trusted host callbacks are code capabilities, never JSON actor labels. A CLI
// request alone cannot assert that a user cleared a stop or verified billing.
export function assertLoopCostPath(approved, actual) {
  for (const value of [approved, actual]) {
    exactKeys(value, ['path', 'billing']);
    if (typeof value.path !== 'string' || !value.path.trim() || !['local', 'subscription'].includes(value.billing)) fail('unknown or API-billed host cost path');
  }
  if (executionDigest(approved) !== executionDigest(actual)) fail('actual host cost path is not user-approved as non-API-billed');
}
async function write(target, value, create = false) {
  const dir = await safeDirectory(target, '.ai-org/loop', { create: true });
  await (create ? durableAtomicCreate : durableAtomicWrite)(path.join(dir, 'run.json'), formatJson({ value, sha256: executionDigest(value) }));
  return value;
}
export async function readLoopRun(target) {
  let file;
  try { file = await readTaskFile(target, REF); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const envelope = JSON.parse(file.content), s = envelope.value;
  if (executionDigest(s) !== envelope.sha256 || s.schema_version !== 'workkeel.loop-run/v1' || !Number.isSafeInteger(s.operations) || s.operations < 0 || s.operations > 60 || !Number.isFinite(Date.parse(s.started_at)) || !Number.isFinite(Date.parse(s.deadline))) fail('persistent ledger integrity failure');
  if(Date.parse(s.deadline)-Date.parse(s.started_at)!==LOOP_MAX_WALL_MS||!Array.isArray(s.attempts)||s.attempts.length!==s.operations||!Array.isArray(s.cancellation_reservations)||s.operations+s.cancellation_reservations.length>60||new Set(s.cancellation_reservations).size!==s.cancellation_reservations.length||!['running','stopping','stopped','completed'].includes(s.status)||typeof s.stop?.requested!=='boolean'||typeof s.stop.confirmed!=='boolean'||!Array.isArray(s.stop.unknown))fail('persistent ledger fields invalid');
  return { ...s, remaining_operations: Math.max(0, 60 - s.operations - (s.cancellation_reservations?.length??0)), remaining_ms: Math.max(0, Date.parse(s.deadline) - Date.now()) };
}
const stored = s => { const value = { ...s }; delete value.remaining_operations; delete value.remaining_ms; return value; };
const lock = (target, fn) => withProjectMutationLock(path.join(path.resolve(target), '.ai-org/loop'), fn);

/** Host-only infrastructure. Exactly one approved L2 for this private trial.
 * This does not create a task or execute an improvement. Delivery remains goal. */
export async function startLoopRun(target, approval, { authorizeUser, costPath } = {}) {
  approval=structuredClone(approval);costPath=structuredClone(costPath);
  exactKeys(approval, ['id', 'goal_id', 'proposal_sha256', 'baseline_sha256', 'cost_path']);
  id(approval.id); id(approval.goal_id);
  for (const key of ['proposal_sha256', 'baseline_sha256']) if (!/^[a-f0-9]{64}$/.test(approval[key])) fail('sealed proposal and baseline required');
  if (typeof authorizeUser !== 'function' || await authorizeUser({ action: 'start-one-l2', approval }) !== true) fail('explicit user approval required');
  assertLoopCostPath(approval.cost_path, costPath);
  return withProjectMutationLock(target,()=>lock(target, async () => {
    if (await readLoopRun(target)) fail('this trial already consumed its one L2; clearing a stop never starts another');
    try{const file=await readTaskFile(target,'.ai-org/goals/'+approval.goal_id+'/state.json'),e=JSON.parse(file.content);if(executionDigest(e.value)!==e.sha256)fail('goal integrity before run');if(e.value.operations.some(o=>['running','intent','unknown'].includes(o.status)))fail('reconcile existing host work before starting a trial');}catch(error){if(error.code!=='ENOENT')throw error;}
    const started = Date.now();
    return write(target, { schema_version: 'workkeel.loop-run/v1', ...structuredClone(approval), started_at: new Date(started).toISOString(), deadline: new Date(started + LOOP_MAX_WALL_MS).toISOString(), operations: 0, cancellation_reservations: [], attempts: [], status: 'running', stop: { requested: false, confirmed: false, unknown: [], reason: null }, user_clearances: 0 }, true);
  }));
}
/** End the guard after the host records the comparison (or another normal
 * terminal outcome). This grants no delivery, model or second-L2 authority. */
export async function finishLoopRun(target, reason='comparison-complete') {
  if(!['comparison-complete','no-improvement','success'].includes(reason))fail('invalid normal stop reason');
  return lock(target,async()=>{const s=await readLoopRun(target);if(!s)fail('no run');
    if(s.stop.requested||s.status!=='running'||s.cancellation_reservations.length)fail('cannot finish unresolved work');
    if(Date.now()>=Date.parse(s.deadline)){s.stop={requested:true,confirmed:true,unknown:[],reason:'wall-clock-limit'};s.status='stopped';await write(target,stored(s));fail('wall-clock limit prevents normal completion');}
    s.status='completed';s.completion_reason=reason;return write(target,stored(s));});
}
export async function requestLoopStop(target, reason = 'user-requested') {
  return lock(target, async () => {
    const s = await readLoopRun(target); if (!s) return null;
    s.stop = { requested: true, confirmed: false, unknown: ['in-flight operations'], reason };
    s.status = 'stopping'; return write(target, stored(s));
  });
}
export async function clearLoopStop(target, { authorizeUser } = {}) {
  if (typeof authorizeUser !== 'function' || await authorizeUser({ action: 'clear-stop', run: await readLoopRun(target) }) !== true) fail('only the user can clear the persistent stop');
  return lock(target, async () => {
    const s = await readLoopRun(target); if (!s) fail('no run');
    if (!s.stop.confirmed || s.stop.unknown.length) fail('cancellation is still unknown');
    s.stop = { requested: false, confirmed: true, unknown: [], reason: 'user-cleared' };
    // The old run remains terminal; deadline, count and one-L2 seal survive.
    s.user_clearances++; return write(target, stored(s));
  });
}
export async function confirmLoopStop(target, unknown = []) {
  return lock(target, async () => {
    const s = await readLoopRun(target); if (!s) return null;
    s.stop.confirmed = unknown.length === 0; s.stop.unknown = unknown;
    s.status = unknown.length ? 'stopping' : 'stopped'; return write(target, stored(s));
  });
}
export async function assertLoopAdmission(target, goalId) {
  const s = await readLoopRun(target); if (!s) return null;
  if (s.stop.requested || s.status !== 'running') fail('persistent stop blocks new admission/dispatch');
  if (s.goal_id !== goalId) fail('one approved goal only; sub-jobs cannot reset the run budget');
  if (Date.now() >= Date.parse(s.deadline) || s.operations >= 60) {
    await requestLoopStop(target, Date.now() >= Date.parse(s.deadline) ? 'wall-clock-limit' : 'operation-limit');
    fail('run budget exhausted');
  }
  return s;
}
/** Charge before work, including failure and retry. No public reset parameter. */
export async function countLoopOperation(label, target = context.getStore()?.target) {
  target = context.getStore()?.target ?? target;
  if (!target) return;
  await lock(target, async () => {
    const s = await readLoopRun(target); if (!s) return;
    if (s.stop.requested || s.status !== 'running' || s.operations + (s.cancellation_reservations?.length??0) >= 60 || Date.now() >= Date.parse(s.deadline)) {
      if (!s.stop.requested) { s.stop = { requested: true, confirmed: false, unknown: ['in-flight operations'], reason: 'run-budget-exhausted' }; s.status = 'stopping'; await write(target, stored(s)); }
      fail('persistent stop or run budget exhausted');
    }
    s.operations++; s.attempts.push({ number: s.operations, operation: label, at: new Date().toISOString() });
    await write(target, stored(s));
  });
}
/** Reserve cancellation capacity before a host can start. Unused reservations
 * are released only on a confirmed terminal result; attempts never reset. */
export async function reserveLoopCancellation(operationId) {
  const target=context.getStore()?.target;if(!target)return;
  await lock(target,async()=>{const s=await readLoopRun(target);if(!s)return;
    s.cancellation_reservations??=[];if(s.cancellation_reservations.includes(operationId))return;
    if(s.stop.requested||s.operations+s.cancellation_reservations.length>=60)fail('no cancellation capacity before host dispatch');
    s.cancellation_reservations.push(operationId);await write(target,stored(s));});
}
export async function releaseLoopCancellation(operationId) {
  const target=context.getStore()?.target;if(!target)return;
  await lock(target,async()=>{const s=await readLoopRun(target);if(!s)return;
    s.cancellation_reservations=(s.cancellation_reservations??[]).filter(id=>id!==operationId);await write(target,stored(s));});
}
/** Safety may request cancellation without granting new execution. A host
 * observation still consumes the original allowance; exhaustion stays unknown. */
export async function countLoopCancellationOperation(label, target, operationId) {
  target = context.getStore()?.target ?? target;
  if(!target) return true;
  return lock(target,async()=>{
    const s=await readLoopRun(target);if(!s)return true;
    const reserved=(s.cancellation_reservations??[]).includes(operationId);
    if(s.operations+(s.cancellation_reservations?.length??0)>=60&&!reserved)return false;
    if(reserved)s.cancellation_reservations=s.cancellation_reservations.filter(id=>id!==operationId);
    s.operations++;s.attempts.push({number:s.operations,operation:label,at:new Date().toISOString()});
    await write(target,stored(s));return true;
  });
}
/** Shared context follows nested async operations; it never owns delivery. */
export async function withLoopRun(target, goalId, adapter, operation, cancel) {
  const inherited = context.getStore();
  const ledgerTarget = inherited?.target ?? target;
  const s = await readLoopRun(ledgerTarget);
  if (!s) return operation();
  try {
    await assertLoopAdmission(ledgerTarget, goalId);
    assertLoopCostPath(s.cost_path, adapter.costPath);
  } catch (error) {
    await requestLoopStop(ledgerTarget, error.message);
    // The persisted flag closes admission before cancellation starts.
    const cancellation=Promise.resolve().then(cancel).catch(e=>[e.message]);let timer,timedOut=false;
    const unknown=await Promise.race([cancellation,new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve(['cancellation not yet confirmed']);},Math.min(1000,s.remaining_ms));})]);clearTimeout(timer);
    await confirmLoopStop(ledgerTarget, unknown);if(timedOut)void cancellation.then(value=>confirmLoopStop(ledgerTarget,value)).catch(()=>{});throw error;
  }
  return context.run({ target: ledgerTarget }, async () => {
    let stopping = null, rejectStop;
    const interrupted = new Promise((_, reject) => { rejectStop = reject; });
    // Attach immediately: a timeout may precede the operation's await boundary.
    interrupted.catch(() => {});
    const stop = reason => stopping ??= (async () => {
      await requestLoopStop(ledgerTarget, reason);
      const cancellation = Promise.resolve().then(cancel).catch(e => [e.message]);
      const remaining = Math.min(1000, Math.max(0, Date.parse(s.deadline) - Date.now()));
      let limit,timedOut=false;
      const unknown = await Promise.race([cancellation, new Promise(resolve => { limit = setTimeout(() => {timedOut=true;resolve(['cancellation not yet confirmed']);}, remaining); })]);
      clearTimeout(limit);
      await confirmLoopStop(ledgerTarget, unknown);
      if(timedOut) void cancellation.then(value => confirmLoopStop(ledgerTarget,value)).catch(()=>{});
      rejectStop(Error('Loop run: stopped: '+reason));
    })();
    const timer = setTimeout(() => { void stop('wall-clock-limit'); }, s.remaining_ms);
    const poll = setInterval(() => { void readLoopRun(ledgerTarget).then(run => { if (run.stop.requested) return stop(run.stop.reason); }).catch(() => stop('ledger-unavailable')); }, 50);
    try {
      await countLoopOperation('goal-step');
      const result = await Promise.race([operation(), interrupted]), current = await readLoopRun(ledgerTarget);
      if (current.stop.requested || result?.operation?.status === 'unknown' || ['host-capability-unavailable', 'components-blocked', 'pre-dispatch-blocked', 'aborted'].includes(result?.idle) || result?.status === 'blocked') await stop(current.stop.reason ?? result?.reason ?? 'uncertain-or-blocked-result');
      return result;
    }
    catch (error) { await stop(error.message); throw error; }
    finally { clearTimeout(timer); clearInterval(poll); if(stopping) await stopping; }
  });
}
