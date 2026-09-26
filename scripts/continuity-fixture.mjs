// Coordinator-only offline fixture/oracle. Never copy this file into actor roots.
// This module does not dispatch providers or qualify a hostile-code sandbox.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { digest, subprocessEnvironment } from './delivery-control-pair.mjs';
import { formatJson, sha256 } from '../src/files.mjs';
import { CONTINUITY_BLOB_BATCH_LIMIT, readContinuityBlobs } from './continuity-git-blobs.mjs';

const source = path.resolve(import.meta.dirname, '..');
const check = (condition, reason) => { if (!condition) throw Error(reason); };
const env = () => subprocessEnvironment({ GIT_AUTHOR_DATE: '2026-09-07T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-07T00:00:00Z' });
function run(cwd, binary, args, options = {}) {
  const started = performance.now();
  const r = spawnSync(binary, args, { cwd, env: env(), encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, ...options });
  return { exit_code: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', elapsed_ms: performance.now() - started };
}
function command(cwd, binary, args, options) {
  const r = run(cwd, binary, args, options);
  check(r.exit_code === 0, `fixture-command-failed:${binary}:${r.stderr.slice(0, 400)}`);
  return r.stdout.trim();
}
const git = (root, ...args) => command(root, 'git', ['-c', 'core.hooksPath=' + os.devNull, '-c', 'commit.gpgsign=false', ...args]);
// Exercise this candidate's compatibility CLI against isolated fixture state;
// the repository's retained Temple launcher is pinned historical evidence.
const cli = (root, ...args) => JSON.parse(command(source, process.execPath, [path.join(source, 'bin/temple.mjs'), ...args, root, '--json']));
async function write(root, file, value) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
export const discountSource = `export function discount(subtotal, amount) {
  if (![subtotal, amount].every(x => Number.isInteger(x) && x >= 0 && x <= 1000000000) || amount > subtotal) throw new TypeError('amount');
  return subtotal - amount;
}
`;
export function referenceQuote(threshold) {
  check([3000, 5000].includes(threshold), 'unknown-threshold');
  return `import { discount } from './discount.mjs';
export function quote(subtotalCents, discountCents) {
  const discountedCents = discount(subtotalCents, discountCents);
  const shippingCents = discountedCents === 0 || discountedCents >= ${threshold} ? 0 : 500;
  return { subtotalCents, discountedCents, shippingCents, totalCents: discountedCents + shippingCents };
}
`;
}
const unfinished = `import { discount } from './discount.mjs';
export function quote(subtotalCents, discountCents) {
  discount(subtotalCents, discountCents);
  throw new Error('shipping integration unfinished');
}
`;
const discountTest = `import assert from 'node:assert/strict';
import { discount } from '../discount.mjs';
assert.equal(discount(3100, 200), 2900);
assert.equal(discount(0, 0), 0);
assert.throws(() => discount(1, 2), TypeError);
`;
const quoteTest = threshold => `import assert from 'node:assert/strict';
import { quote } from '../quote.mjs';
assert.deepEqual(quote(${threshold}, 0), { subtotalCents:${threshold}, discountedCents:${threshold}, shippingCents:0, totalCents:${threshold} });
assert.equal(quote(${threshold}, 1).shippingCents, 500);
`;
function specification(threshold, revision) {
  return `# Current approved quote specification ${revision}\n\n` +
    `quote(subtotalCents, discountCents) accepts integer amounts from 0 to 1000000000 inclusive, discount <= subtotal. Invalid inputs throw TypeError.\n` +
    `Preserve discount.mjs. Apply discount BEFORE shipping. Discounted zero ships free. Otherwise charge 500 unless discountedCents >= ${threshold} (inclusive), then zero.\n` +
    `Return exactly subtotalCents, discountedCents, shippingCents, totalCents; total is discounted plus shipping. Preserve caller input and synchronous export shape.\n` +
    `Edit quote.mjs and optionally test/additional.test.mjs only. Preserve public tests and all existing documents. Low-risk offline fixture; no UI, services, dependencies or external actions.\n`;
}
async function snapshot(root, revision = 'HEAD') {
  const result = {};
  for (const row of git(root, 'ls-tree', '-r', '-z', revision).split('\0').filter(Boolean)) {
    const [meta, file] = row.split('\t'); const [mode, type, oid] = meta.split(' ');
    check(mode === '100644' && type === 'blob' && file && !file.includes('..') && !file.includes('\n'), 'unsafe-fixture-tree');
    result[file] = { mode, oid };
  }
  return result;
}
export async function createContinuityPair(directory, state, { currentRuntime = source, previousRuntime = null } = {}) {
  check(['stable', 'changed-spec'].includes(state), 'unknown-state');
  // Exclusive target: never adopt or clean a pre-existing directory.
  await fs.mkdir(directory);
  const seed = path.join(directory, 'seed'); await fs.mkdir(seed);
  git(seed, 'init', '-b', 'main');
  await write(seed, 'discount.mjs', discountSource);
  await write(seed, 'quote.mjs', state === 'stable' ? unfinished : referenceQuote(3000));
  await write(seed, 'test/discount.test.mjs', discountTest);
  await write(seed, 'SPEC.md', specification(3000, 'v1'));
  if (state === 'changed-spec') await write(seed, 'test/public.test.mjs', quoteTest(3000));
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Record completed predecessor scope');
  const historicalRevision = git(seed, 'rev-parse', 'HEAD');
  const tests = state === 'stable' ? ['test/discount.test.mjs'] : ['test/discount.test.mjs', 'test/public.test.mjs'];
  const observation = run(seed, process.execPath, ['--test', ...tests]);
  check(observation.exit_code === 0, 'invalid-historical-checkpoint');
  await write(seed, 'history/verification-v1.json', { revision: historicalRevision, command: ['node', '--test', ...tests], ...observation, authority: 'historical-scope-only' });
  const threshold = state === 'stable' ? 3000 : 5000, specRevision = state === 'stable' ? 'v1' : 'v2';
  if (state === 'changed-spec') await write(seed, 'history/SPEC-v1.md', specification(3000, 'v1'));
  await write(seed, 'SPEC.md', specification(threshold, specRevision));
  await write(seed, 'test/public.test.mjs', quoteTest(threshold));
  const task = state === 'stable' ? 'Complete shipping integration while preserving accepted discount behavior.' : 'Update old shipping threshold 3000 to current 5000 while preserving accepted discount behavior.';
  await write(seed, 'HANDOFF.md', `# Takeover\n\n${task}\nCurrent authority: SPEC.md ${specRevision}. ${state === 'changed-spec' ? 'v2 supersedes historical v1 explicitly.' : 'v1 is current.'}\n` +
    `Predecessor revision: ${historicalRevision}. Historical command and actual pass: history/verification-v1.json; its scope is not current candidate verification.\n` +
    `Completed: discount.mjs and its tests. Remaining: ${task}\nEditable: quote.mjs, optional test/additional.test.mjs. No active predecessor claim or unresolved business decision. Read current requirements and test the new exact candidate before handing it off.\n`);
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Freeze current takeover facts');
  const sharedRevision = git(seed, 'rev-parse', 'HEAD'), product = await snapshot(seed), arms = {};
  const config = JSON.parse(await fs.readFile(path.join(source, 'docs/getting-started/temple-init.example.json')));
  config.project = { id: 'continuity-fixture', name: 'Synthetic continuity fixture' };
  config.repository_integration = { schema_version: 'temple.repository-integration/v1', status: 'confirmed', authority: 'project', source: 'human-confirmed', policy_refs: [], summary: 'Synthetic local fixture, no external integration', integration_target: 'main', change_isolation: 'not-required', review_gate: 'not-required', recorded_at: '2026-09-07T00:00:00Z', recorded_by: 'human' };
  const configPath = path.join(directory, 'init.json'); await fs.writeFile(configPath, JSON.stringify(config));
  for (const arm of previousRuntime ? ['ordinary', 'temple', 'temple_previous'] : ['ordinary', 'temple']) {
    const root = path.join(directory, arm), started = performance.now();
    await fs.cp(seed, root, { recursive: true, errorOnExist: true, force: false });
    let itemId = null;
    if (arm !== 'ordinary') {
      // Install through the real CLI. Only the four distribution instruction
      // bodies differ between qualified runtimes; never rewrite an installed lock.
      command(source, process.execPath, [path.join(arm === 'temple_previous' ? previousRuntime : currentRuntime, 'bin/temple.mjs'),
        'init', root, '--config', configPath, '--json']);
      itemId = cli(root, 'work-item', 'create', '--title', 'Resume approved quote change', '--scope', task, '--acceptance', 'Current SPEC.md governs; preserve completed discount behavior and protected files.', '--affected-path', 'quote.mjs', '--affected-path', 'test/additional.test.mjs', '--workflow-profile', 'lean', '--risk-tier', 'low', '--scope-class', 'bounded', '--profile-rationale', 'Synthetic bounded offline quote', '--ui-mode', 'not-applicable').item.id;
      cli(root, 'transition', '--work-item', itemId, '--to', 'build', ...['work_order', 'approved_scope', 'acceptance_criteria', 'technical_design', 'risk_review', 'profile_eligibility'].flatMap(g => ['--satisfy', `${g}=${g === 'work_order' ? 'HANDOFF.md' : 'SPEC.md'}`]));
      cli(root, 'doctor'); cli(root, 'status');
      git(root, 'add', '.'); git(root, 'commit', '-m', 'Record Temple representation of shared facts');
    }
    const baseline = git(root, 'rev-parse', 'HEAD'), tree = await snapshot(root);
    for (const [file, entry] of Object.entries(product)) check(isDeepStrictEqual(tree[file], entry), 'unequal-product-facts');
    arms[arm] = { root, baseline, tree, item_id: itemId, preparation_ms: performance.now() - started };
  }
  return { version: 'continuity-offline/v1', state, threshold, spec_revision: specRevision, historical_revision: historicalRevision, shared_revision: sharedRevision,
    product, arms, source_revision: git(source, 'rev-parse', 'HEAD'), fact_digest: digest(product), live_ready: false, model_calls: 0 };
}

// Read-only audit of our synthetic fixture. Never output bodies or private roots.
export async function auditContinuityInputs(root,itemId,agentId) {
  const project=JSON.parse(await fs.readFile(path.join(root,'.ai-org/project/project.json')));
  check(project.id==='continuity-fixture'&&/^WI-[0-9]+$/.test(itemId),'synthetic-audit-only');
  const args=['--work-item',itemId,'--position','developer','--no-write'];
  const entry=cli(root,'context','enter',...args,'--agent-id',agentId,'--principal-id','human');
  check(entry.status==='eligible'&&entry.packet?.acquisition==='complete','audit-context-unavailable');
  const navigation=cli(root,'context','resolve',...args,'--compact');
  const sources=entry.packet.sources.map(s=>({path:s.path,representation:s.representation,
    body_bytes:Buffer.byteLength(s.body??''),source_sha256:s.source_sha256}));
  const operating=new Set(['AGENTS.md','TEMPLE.md','.agents/skills/temple-work/SKILL.md',
    '.agents/skills/temple-work/references/lean-execution.md']);
  const bytes=value=>Buffer.byteLength(JSON.stringify(value,null,2)+'\n');
  return {schema_version:'continuity-input-audit/v1',model_generation_performed:false,mutation_performed:false,
    sources,selected_body_bytes:sources.reduce((n,s)=>n+s.body_bytes,0),
    operating_instruction_bytes:sources.filter(s=>operating.has(s.path)).reduce((n,s)=>n+s.body_bytes,0),
    product_fact_bytes:sources.filter(s=>['SPEC.md','HANDOFF.md'].includes(s.path)).reduce((n,s)=>n+s.body_bytes,0),
    optional_entry_json_bytes:bytes(entry),compact_navigation_json_bytes:bytes(navigation),
    navigation_includes_source_bodies:false,source_set_is_selected_not_universal:true,
    provider_tokens:null,actual_read_sequence:null,live_treatment_effect:null};
}

// Shared happy-path qualification for tests and generation-free live preflight.
// The caller supplies a freshly created, exclusively owned synthetic Temple arm.
export async function recordContinuityControl(checkpoint, arm = 'temple', { baselineReference } = {}) {
  check(['temple','temple_previous'].includes(arm),'invalid-control-arm');
  const base=checkpoint.arms[arm],root=base.root,itemId=base.item_id;
  const item=JSON.parse(await fs.readFile(path.join(root,`.ai-org/work-items/${itemId}.json`)));
  check(item.state==='build'&&item.claim===null&&git(root,'rev-parse','HEAD')===base.baseline,'control-not-fresh');
  cli(root,'work-item','claim','--work-item',itemId,'--agent-id',item.assigned_agent_id,'--principal-id','human',
    '--base-revision',baselineReference ?? base.baseline,'--branch','main');
  await fs.writeFile(path.join(root,'quote.mjs'),referenceQuote(checkpoint.threshold));
  const tests=run(root,process.execPath,['--test','test/public.test.mjs','test/discount.test.mjs']);
  check(tests.exit_code===0,'control-test-failed');
  git(root,'add','quote.mjs');git(root,'commit','-m','Tested synthetic product');const revision=git(root,'rev-parse','HEAD');
  const claim=JSON.parse(await fs.readFile(path.join(root,`.ai-org/work-items/${itemId}.json`))).claim;
  const evidence=`.ai-org/artifacts/${itemId}/test-evidence.json`;
  await write(root,evidence,{candidate_revision:revision,test_exit_code:tests.exit_code});
  const result=cli(root,'work-item','finish','--work-item',itemId,'--position','developer','--operation-id','qualification',
    '--claim-id',claim.id,'--agent-id',item.assigned_agent_id,'--principal-id','human','--revision',revision,
    '--completed','Implemented and tested current synthetic threshold.','--evidence',evidence);
  check(result.success===true,'control-finish-failed');
  git(root,'add','.ai-org');git(root,'commit','-m','Record synthetic delivery');
  return {revision,delivery_revision:git(root,'rev-parse','HEAD'),evidence,model_generation_performed:false};
}

function vectors(threshold) {
  const cases = [[0,0], [1,0], [100,100], [threshold-1,0], [threshold,0], [threshold+1,0], [threshold,1], [threshold+200,200], [1000000000,0], [1000000000,1000000000], [3000,0], [5000,1]];
  for (let i = 1; i <= 24; i++) cases.push([threshold + i * 17, i * 29]);
  return cases.concat([[-1,0], [1,2], [1.1,0], [null,0], ['3',0], [1,null], [1000000001,0], [1,-1], [], [1]]);
}
function expected(args, threshold) {
  const [a,b] = args;
  if (![a,b].every(x => Number.isInteger(x) && x >= 0 && x <= 1e9) || b > a) return { error: 'TypeError' };
  const discountedCents = a-b, shippingCents = discountedCents === 0 || discountedCents >= threshold ? 0 : 500;
  return { value: { subtotalCents:a, discountedCents, shippingCents, totalCents:discountedCents+shippingCents } };
}
function bookkeeping(file, item) {
  return item && (file === `.ai-org/work-items/${item}.json` || file === '.ai-org/events/events.jsonl' || file.startsWith('.ai-org/views/') || file.startsWith(`.ai-org/artifacts/${item}/`));
}
// CLI claims preserve revision spelling. Compare commit identity, not a prefix or
// raw string. Git may succeed with an ambiguous refname warning: reject that too.
function baselineMatches(root, reference, baseline) {
  if (typeof reference !== 'string' || !reference || reference.length > 1024 ||
      /[\s\0]/.test(reference) || reference.startsWith('-') || !/^[a-f0-9]{40}$/.test(baseline)) return false;
  const resolved = run(root, 'git', ['-c', 'core.warnAmbiguousRefs=true', 'rev-parse',
    '--verify', '--end-of-options', `${reference}^{commit}`]);
  return resolved.exit_code === 0 && resolved.stderr.trim() === '' && resolved.stdout.trim() === baseline;
}
// Bounded experiment record contract, not a new framework evidence schema.
// Validate recorded administration independently of product correctness.
function deliveryRecords(root, base, revision, finalRevision, finalTree) {
  const itemPath=`.ai-org/work-items/${base.item_id}.json`, prefix=`.ai-org/artifacts/${base.item_id}/`;
  const read=file=>git(root,'show',`${finalRevision}:${file}`);
  const artifact=file=>typeof file==='string'&&file.startsWith(prefix)&&
    /^[A-Za-z0-9][A-Za-z0-9_.-]*\.(md|json)$/.test(file.slice(prefix.length))&&Boolean(finalTree[file]);
  try {
    const item=JSON.parse(read(itemPath)),before=JSON.parse(git(root,'show',`${base.baseline}:${itemPath}`));
    const mutable=new Set(['state','owner_position','assigned_agent_id','updated_at','base_revision','claim','claims','handoffs',
      'developer_candidate_revision','gate_evidence','evidence','next_position','unresolved']);
    for(const key of new Set([...Object.keys(before),...Object.keys(item)]))
      if(!mutable.has(key))check(isDeepStrictEqual(before[key],item[key]),'delivery-record-invalid');
    check(item.state==='test'&&item.owner_position==='quality_evaluator'&&item.developer_candidate_revision===revision&&
      item.claim?.status==='released'&&item.claim.agent_id===before.assigned_agent_id&&
      item.claim.principal_id==='human'&&baselineMatches(root,item.claim.base_revision,base.baseline)&&
      baselineMatches(root,item.base_revision,base.baseline)&&item.handoffs?.length===1,'delivery-record-invalid');
    for(const [key,value] of Object.entries(before.gate_evidence))check(isDeepStrictEqual(value,item.gate_evidence[key]),'delivery-record-invalid');
    const handoff=item.handoffs[0],evidence=item.gate_evidence.developer_evidence;
    check(handoff.from_position==='developer'&&handoff.to_position==='quality_evaluator'&&
      handoff.input_revision===revision&&handoff.actor===item.claim.agent_id&&artifact(handoff.artifact)&&
      read(handoff.artifact).includes(revision)&&Array.isArray(evidence)&&evidence.length>0&&
      evidence.every(file=>artifact(file)&&read(file).includes(revision)),'delivery-record-invalid');
    const receipts=Object.keys(finalTree).filter(file=>file.startsWith(prefix+'finish-')&&file.endsWith('.json'));
    check(receipts.length===1,'delivery-record-invalid');
    const receiptBytes=run(root,'git',['show',`${finalRevision}:${receipts[0]}`]);
    check(receiptBytes.exit_code===0,'delivery-record-invalid');
    const receipt=JSON.parse(receiptBytes.stdout),q=receipt.request,r=receipt.result;
    check(receipt.schema_version==='temple.lean-finish-receipt/v1'&&receipt.request_digest===sha256(formatJson(q))&&
      q.work_item_id===base.item_id&&q.candidate_revision===revision&&q.position==='developer'&&
      q.agent_id===handoff.actor&&q.claim_id===item.claim.id&&q.principal_id===item.claim.principal_id&&
      isDeepStrictEqual(q.evidence,evidence)&&r.candidate_revision===revision&&r.work_item_id===base.item_id&&
      r.handoff===handoff.artifact&&r.receipt===receipts[0]&&r.resulting_state==='test','delivery-record-invalid');
    const observations=[];
    if(receipt.diagnostics_observation!==undefined){
      const file=prefix+`diagnostics-${q.operation_id}.json`;
      check(receipt.diagnostics_observation===file&&artifact(file),'delivery-record-invalid');
      const observation=JSON.parse(read(file));
      check(observation.schema_version==='temple.finish-observation/v1'&&observation.authority==='observation-only'&&
        observation.work_item_id===base.item_id&&observation.operation_id===q.operation_id&&
        observation.candidate_revision===revision&&observation.request_digest===receipt.request_digest&&
        observation.plan_digest===r.plan_digest&&observation.receipt_sha256===sha256(receiptBytes.stdout)&&
        observation.status==='passed'&&Array.isArray(observation.errors)&&observation.errors.length===0&&
        Number.isFinite(Date.parse(observation.observed_at)),'delivery-record-invalid');
      observations.push(file);
    }
    const eventPath='.ai-org/events/events.jsonl',oldEvents=git(root,'show',`${base.baseline}:${eventPath}`);
    const events=read(eventPath);
    check(events.startsWith(oldEvents+'\n')&&events.slice(oldEvents.length).trim().split('\n')
      .every(line=>JSON.parse(line).work_item_id===base.item_id),'delivery-record-invalid');
    return new Set([itemPath,'.ai-org/events/events.jsonl','.ai-org/views/status.md',
      '.ai-org/views/capabilities.json',handoff.artifact,...evidence,...receipts,...observations]);
  } catch {throw Error('delivery-record-invalid');}
}

export async function assessContinuityCandidate(root, checkpoint, arm, revision, { scratchParent = os.tmpdir(), candidateExecutor = run, allowRecordDescendant = false } = {}) {
  checkpoint = structuredClone(checkpoint);
  check(checkpoint?.version === 'continuity-offline/v1' && ['ordinary','temple','temple_previous'].includes(arm) && ['stable','changed-spec'].includes(checkpoint.state) &&
    checkpoint.threshold === (checkpoint.state === 'stable' ? 3000 : 5000) && checkpoint.spec_revision === (checkpoint.state === 'stable' ? 'v1' : 'v2') &&
    checkpoint.fact_digest === digest(checkpoint.product), 'invalid-coordinator-checkpoint');
  const base = checkpoint.arms[arm];
  const templeArm = arm !== 'ordinary';
  check(base, 'candidate-arm-missing');
  check(/^[a-f0-9]{40}$/.test(revision ?? '') && revision !== base.baseline, 'exact-new-candidate-required');
  const finalRevision=git(root,'rev-parse','HEAD');
  check(finalRevision===revision || allowRecordDescendant&&templeArm,'candidate-not-current');
  git(root, 'merge-base', '--is-ancestor', base.baseline, revision);
  const tree = await snapshot(root, revision), editable = new Set(['quote.mjs','test/additional.test.mjs']);
  let deliveryTree=null;
  if(allowRecordDescendant&&templeArm) {
    git(root,'merge-base','--is-ancestor',revision,finalRevision);
    deliveryTree=await snapshot(root,finalRevision);
    const records=deliveryRecords(root,base,revision,finalRevision,deliveryTree);
    for(const file of new Set([...Object.keys(tree),...Object.keys(deliveryTree)])) {
      if(!records.has(file))check(isDeepStrictEqual(tree[file],deliveryTree[file]),'delivery-source-drift');
      if(bookkeeping(file,base.item_id)&&!records.has(file))check(isDeepStrictEqual(base.tree[file],deliveryTree[file]),'delivery-record-scope-drift');
    }
  }
  for (const file of new Set([...Object.keys(base.tree), ...Object.keys(tree)])) {
    if (!editable.has(file) && !bookkeeping(file, base.item_id)) check(isDeepStrictEqual(tree[file], base.tree[file]), 'protected-source-changed');
  }
  // Check every tracked non-bookkeeping byte and mode plus untracked files; Git's
  // status alone can hide assume-unchanged files or ignore-listed additions.
  const disk = {}, pending = [];
  async function safeWorkingFile(file) {
    const stat = await fs.lstat(path.join(root,file));
    check(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o111) && stat.size <= 1024*1024, 'unsafe-working-file');
  }
  async function comparePending() {
    if (!pending.length) return;
    const blobs = readContinuityBlobs(root, pending.map(file => (deliveryTree??tree)[file].oid), { env:env(), failure:'dirty-source' });
    for (let index = 0; index < pending.length; index++) {
      const file = pending[index];
      // Recheck after collecting a batch; never reuse a disk observation.
      await safeWorkingFile(file);
      check((await fs.readFile(path.join(root,file))).equals(blobs[index]), 'dirty-source');
    }
    pending.length = 0;
  }
  async function walk(relative = '') {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name); if (file === '.git' || !deliveryTree&&bookkeeping(file, base.item_id)) continue;
      if (entry.isDirectory()) { await walk(file); continue; }
      await safeWorkingFile(file);
      disk[file] = true;
      check((deliveryTree??tree)[file], 'untracked-source');
      // Binary-safe object comparison, independent of trim/UTF-8 decoding.
      pending.push(file);
      if (pending.length === CONTINUITY_BLOB_BATCH_LIMIT) await comparePending();
    }
  }
  await walk();
  await comparePending();
  for (const file of Object.keys(deliveryTree??tree))
    if (deliveryTree || !bookkeeping(file,base.item_id)) check(disk[file], 'missing-source');
  const scratch = await fs.mkdtemp(path.join(scratchParent, 'continuity-oracle-'));
  let cleanupSafe = true;
  try {
    const testPaths = ['test/discount.test.mjs','test/public.test.mjs', ...(tree['test/additional.test.mjs'] ? ['test/additional.test.mjs'] : [])];
    const extracted = {};
    const files = ['discount.mjs','quote.mjs', ...testPaths];
    const blobs = readContinuityBlobs(root, files.map(file => tree[file]?.oid), { env:env(), maxBlobBytes:65536 });
    for (const [index, file] of files.entries()) {
      await fs.mkdir(path.dirname(path.join(scratch,file)),{recursive:true});
      await fs.writeFile(path.join(scratch,file), blobs[index]); extracted[file] = blobs[index];
    }
    const inputs = vectors(checkpoint.threshold);
    // Preserve properties JSON would erase, and distinguish real error types
    // from objects that merely claim a name. Expected answers stay in the parent.
    const script = `import {types} from 'node:util';
const NativeTypeError=TypeError, nativeError=types.isNativeError;
const keys=['discountedCents','shippingCents','subtotalCents','totalCents'];
const inputs=JSON.parse(process.argv[1]); const {quote}=await import('./quote.mjs');
console.log(JSON.stringify(inputs.map(args=>{try{
  const value=quote(...args);
  if(value===null || typeof value!=='object') return {invalid:'return-shape'};
  const actual=Reflect.ownKeys(value);
  if(actual.length!==4 || actual.some(k=>typeof k!=='string') || actual.sort().some((k,i)=>k!==keys[i])) return {invalid:'return-shape'};
  const fields={subtotalCents:value.subtotalCents,discountedCents:value.discountedCents,shippingCents:value.shippingCents,totalCents:value.totalCents};
  if(Object.values(fields).some(v=>typeof v!=='number'||!Number.isSafeInteger(v))) return {invalid:'return-value-type'};
  return {value:fields};
}catch(e){return {error:nativeError(e)&&e instanceof NativeTypeError?'TypeError':'other'}}})));`;
    const result = await candidateExecutor(scratch, process.execPath, ['--input-type=module','-e',script,JSON.stringify(inputs)], { timeout:2000,maxBuffer:65536 });
    let observed = null; try { observed = JSON.parse(result.stdout); } catch {}
    const answers = inputs.map(args => expected(args, checkpoint.threshold));
    let reason = result.exit_code !== 0 ? 'oracle-process-failed' : isDeepStrictEqual(observed, answers) ? 'accepted' : 'product-mismatch';
    if (reason === 'accepted') {
      const tests = await candidateExecutor(scratch,process.execPath,['--test',...testPaths],{timeout:3000,maxBuffer:65536});
      if (tests.exit_code !== 0) reason = 'regression-failed';
    }
    for(const [file,bytes] of Object.entries(extracted)) {
      const actual=await fs.readFile(path.join(scratch,file)).catch(()=>null);
      if(!actual?.equals(bytes)) reason='oracle-input-mutated';
    }
    return { passed: reason === 'accepted', revision, ...(allowRecordDescendant?{delivery_revision:finalRevision}:{}), state:checkpoint.state,
      case_count:inputs.length, exit_code:result.exit_code, reason,
      product_scope_only:true, live_sandbox_qualified:false };
  } catch (error) {
    if (error.retainScratch === true) cleanupSafe = false;
    throw error;
  } finally { if (cleanupSafe) await fs.rm(scratch, { recursive:true,force:true }); }
}
