import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess,{execFileSync,spawnSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {prepareDeliveryRequest,recordDeliveryCheck} from '../scripts/workkeel-delivery-request.mjs';
import {readDeliveryGuide} from '../scripts/workkeel-delivery.mjs';

const actor={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'};
async function fixture(t,write_paths=['src']) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'delivery-request-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');
  await fs.writeFile(root+'/docs/approval.md','Approved fixture');await fs.writeFile(root+'/src/a.txt','baseline');
  git('add','.');git('commit','-qm','Baseline');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-entry',goal:'Delivery request fixture',actor,acceptance:['Preserve native guards'],
    environment:{cwd:'.',read_paths:['.'],write_paths,tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md']}},
    authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
  const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
  const input=(action,fields={})=>({task_id:brief.id,action,actor:action==='review'?reviewer:actor,operation_id:action,...fields});
  const prepare=(action,fields)=>prepareDeliveryRequest(root,input(action,fields));
  const apply=p=>mutateNativeTask(root,brief.id,p.action,p.request);
  const read=()=>readNativeTask(root,brief.id);
  const deliver=async(evidence=['docs/approval.md'])=>apply(await prepare('handoff',{summary:'Actual fixture result',evidence,unresolved:[]}));
  return {root,git,input,prepare,apply,read,deliver};
}

test('generated requests complete the unchanged lifecycle with explicit decisions and identical replay',async t=>{
  const f=await fixture(t),before=await f.read(),guide=await readDeliveryGuide(f.root,'WK-entry');
  assert.equal(guide.operation.action,'claim');assert.deepEqual(guide.context.acceptance_criteria,before.contract.acceptance.criteria);
  assert.equal(guide.context.timeline,undefined);assert.equal(guide.execution_authorized,false);
  const claim=await f.prepare('claim');assert.equal(claim.request.base_revision,f.git('rev-parse','HEAD'));
  assert.equal(claim.mutation_status,'no-write');assert.equal(claim.validation_status,'native-apply-required');assert.deepEqual(await f.read(),before);
  await f.apply(claim);assert.equal((await f.apply(claim)).replayed,true);
  await assert.rejects(f.prepare('claim'),/already recorded/);
  await fs.writeFile(f.root+'/src/a.txt','fixed');f.git('add','src/a.txt');f.git('commit','-qm','Fix');
  const handoff=await f.prepare('handoff',{summary:'Verified fixture',evidence:['docs/approval.md'],unresolved:[]});
  assert.equal(handoff.request.claim_id,(await f.read()).claim.id);assert.equal(handoff.request.expected_version,2);await f.apply(handoff);
  const review=await f.prepare('review',{judgment:'pass',summary:'Actual fixture review',evidence:['docs/approval.md']});
  assert.equal(review.request.revision,handoff.request.revision);await f.apply(review);
  const close=await f.prepare('close',{summary:'Accepted fixture',rollback:'Revert fixture commit',evidence:['docs/approval.md']});await f.apply(close);
  assert.equal((await f.read()).state,'done');assert.equal((await readDeliveryGuide(f.root,'WK-entry')).operation.action,null);
});

test('preparation rejects overrides, missing decisions and false resolution without writing',async t=>{
  const f=await fixture(t);await f.apply(await f.prepare('claim'));const before=await f.read();
  for(const fields of [{},{summary:'x',evidence:['docs/approval.md']},{summary:'x',evidence:[],unresolved:[]},{summary:'x',evidence:['docs/approval.md'],unresolved:['bug']},
    {summary:'x',evidence:['docs/approval.md'],unresolved:[],expected_version:1}])await assert.rejects(f.prepare('handoff',fields));
  await assert.rejects(f.prepare('handoff',{summary:'x',evidence:['docs/approval.md'],unresolved:[],actor:reviewer}),/matching implementation claim/);
  await assert.rejects(prepareDeliveryRequest(f.root,f.input('cancel',{summary:'x',evidence:['docs/approval.md']})),/unsupported/);
  assert.deepEqual(await f.read(),before);
});

test('stale saved requests are refused by native apply instead of silently refreshing',async t=>{
  const f=await fixture(t);await f.apply(await f.prepare('claim'));
  const old=await f.prepare('handoff',{summary:'x',evidence:['docs/approval.md'],unresolved:[]});
  await mutateNativeTask(f.root,'WK-entry','release',{operation_id:'release',expected_version:2,actor,claim_id:old.request.claim_id,summary:'Yield'});
  await f.apply(await f.prepare('claim',{operation_id:'claim-again'}));
  await assert.rejects(f.apply(old),/Stale/);assert.equal((await f.read()).state,'build');
});

test('native apply rejects HEAD changes after request preparation',async t=>{
  const f=await fixture(t);await f.apply(await f.prepare('claim'));
  const handoff=await f.prepare('handoff',{summary:'x',evidence:['docs/approval.md'],unresolved:[]});
  await fs.writeFile(f.root+'/src/a.txt','later');f.git('add','src/a.txt');f.git('commit','-qm','Later');
  await assert.rejects(f.apply(handoff),/current commit/);assert.equal((await f.read()).state,'build');
});

test('native apply rejects out-of-scope candidates and missing evidence',async t=>{
  const f=await fixture(t);await f.apply(await f.prepare('claim'));
  await assert.rejects(f.deliver(['docs/missing.md']));assert.equal((await f.read()).state,'build');
  await fs.writeFile(f.root+'/outside.txt','not approved');f.git('add','outside.txt');f.git('commit','-qm','Outside scope');
  await assert.rejects(f.deliver(),/outside approved write roots/);assert.equal((await f.read()).state,'build');
});

test('native apply refuses product drift and changed pinned authority',async t=>{
  const f=await fixture(t);await f.apply(await f.prepare('claim'));
  const handoff=await f.prepare('handoff',{summary:'x',evidence:['docs/approval.md'],unresolved:[]});
  await fs.writeFile(f.root+'/src/a.txt','uncommitted');await assert.rejects(f.apply(handoff),/clean product tree/i);
  await fs.writeFile(f.root+'/src/a.txt','baseline');await fs.writeFile(f.root+'/docs/approval.md','Changed approval');
  await assert.rejects(f.apply(handoff),/evidence|approval|changed/i);assert.equal((await f.read()).state,'build');
});

test('review requires a distinct actual actor and explicit verdict; fail cannot become close',async t=>{
  const f=await fixture(t);await f.apply(await f.prepare('claim'));await f.deliver();
  const fields={judgment:'pass',summary:'Reviewed',evidence:['docs/approval.md']};
  await assert.rejects(f.prepare('review',{...fields,actor}),/separation/);
  await assert.rejects(f.prepare('review',{summary:'Reviewed',evidence:['docs/approval.md']}));
  const pass=await f.prepare('review',fields);
  await assert.rejects(f.apply({...pass,request:{...pass.request,actor}}),/separation/);
  await f.apply(await f.prepare('review',{...fields,judgment:'fail'}));
  await assert.rejects(f.prepare('close',{summary:'Accept',rollback:'Revert',evidence:['docs/approval.md']}),/stage/);
  assert.equal((await readDeliveryGuide(f.root,'WK-entry')).operation.action,null);
});

test('close rechecks review evidence after preparation',async t=>{
  const f=await fixture(t);await f.apply(await f.prepare('claim'));await f.deliver();
  await fs.mkdir(f.root+'/.ai-org/artifacts/WK-entry',{recursive:true});
  const ref='.ai-org/artifacts/WK-entry/review.md';await fs.writeFile(f.root+'/'+ref,'Actual fixture review');
  await f.apply(await f.prepare('review',{judgment:'pass',summary:'Reviewed',evidence:[ref]}));
  const close=await f.prepare('close',{summary:'Accept',rollback:'Revert',evidence:['docs/approval.md']});
  await fs.writeFile(f.root+'/'+ref,'Changed judgment');await assert.rejects(f.apply(close),/changed|evidence/i);
  assert.equal((await f.read()).state,'release_gate');
});

test('guide retains authority warnings and full scope after authority changes',async t=>{
  const f=await fixture(t);await fs.writeFile(f.root+'/docs/approval.md','Changed');
  const guide=await readDeliveryGuide(f.root,'WK-entry');
  assert.ok(guide.context.attention_reasons.includes('evidence-unavailable'));
  assert.deepEqual(guide.context.execution_scope.write_paths,['src']);assert.equal(guide.execution_authorized,false);
});

test('CLI preparation is read-only, emits usable JSON and preserves bounded file admission',async t=>{
  const f=await fixture(t),privateDir=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-input-'));
  t.after(()=>fs.rm(privateDir,{recursive:true,force:true}));
  const input=privateDir+'/request.json',script=new URL('../scripts/workkeel-delivery.mjs',import.meta.url).pathname;
  await fs.writeFile(input,JSON.stringify(f.input('claim')));
  const run=(command,file)=>spawnSync(process.execPath,[script,command,f.root,file],{encoding:'utf8'});
  const before=await f.read(),prepared=run('prepare',input);assert.equal(prepared.status,0,prepared.stderr);
  assert.equal(JSON.parse(prepared.stdout).request.expected_version,1);assert.deepEqual(await f.read(),before);
  assert.equal(JSON.parse(run('guide','WK-entry').stdout).operation.action,'claim');
  await fs.symlink(input,privateDir+'/link.json');assert.equal(run('prepare',privateDir+'/link.json').status,1);
  await fs.writeFile(input,' '.repeat(65537));const large=run('prepare',input);assert.equal(large.status,1);assert.ok(!large.stderr.includes(privateDir));
});

async function checkFixture(t,write_paths=['src','.ai-org/artifacts/WK-entry']) {
  const f=await fixture(t,write_paths);await f.apply(await f.prepare('claim'));
  await fs.writeFile(f.root+'/src/check.test.mjs',"import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; test('value',()=>assert.equal(fs.readFileSync('src/a.txt','utf8'),'fixed'));\n");
  const input=name=>({task_id:'WK-entry',actor,expected_version:2,name,tests:['src/check.test.mjs'],files:['src/a.txt','src/check.test.mjs']});
  return {...f,check:name=>recordDeliveryCheck(f.root,input(name)),checkInput:input};
}

test('record-check writes real RED/GREEN commands, exits and hashes without changing lifecycle',async t=>{
  const f=await checkFixture(t),before=await f.read();
  const red=await f.check('red-test');assert.equal(red.status,'fail');assert.equal(red.exit_code,1);assert.equal(red.acceptance_granted,false);
  assert.deepEqual(red.command.args,['--test','--test-reporter=tap','./src/check.test.mjs']);
  assert.match(red.output.stdout,/not ok/);assert.equal(red.output.truncated,false);
  const redBytes=await fs.readFile(f.root+'/'+red.log_ref,'utf8');
  assert.match(redBytes,/Command: node --test/);assert.match(redBytes,/Exit code: 1/);assert.match(redBytes,/# fail 1/);
  assert.ok(redBytes.includes(red.files_before['src/a.txt']));assert.equal(red.files_before['src/a.txt'],red.files_after['src/a.txt']);
  await fs.writeFile(f.root+'/src/a.txt','fixed');
  const green=await f.check('green-test');assert.equal(green.status,'pass');assert.equal(green.exit_code,0);assert.equal(green.lifecycle_mutation,false);
  assert.match(green.output.stdout,/# fail 0/);assert.equal(green.output.truncated,false);
  assert.notEqual(red.files_before['src/a.txt'],green.files_before['src/a.txt']);
  assert.match(await fs.readFile(f.root+'/'+green.log_ref,'utf8'),/# fail 0/);
  await assert.rejects(f.check('red-test'),/exist/i);assert.equal(await fs.readFile(f.root+'/'+red.log_ref,'utf8'),redBytes);
  assert.deepEqual(await f.read(),before);
});

test('record-check rejects stale actor, invalid paths and changed authority before execution',async t=>{
  const f=await checkFixture(t),input=f.checkInput('rejected');
  for(const patch of [{actor:reviewer},{expected_version:1},{files:['../outside'],tests:['../outside']},{tests:[]},{name:'../escape'},{tests:['src/check.test.mjs'],files:['src/a.txt']}])
    await assert.rejects(recordDeliveryCheck(f.root,{...input,...patch}));
  await fs.symlink(f.root+'/src/check.test.mjs',f.root+'/src/link.test.mjs');
  await assert.rejects(recordDeliveryCheck(f.root,{...input,files:['src/link.test.mjs'],tests:['src/link.test.mjs']}));
  await fs.writeFile(f.root+'/docs/approval.md','changed approval');await assert.rejects(f.check('authority'));
  await assert.rejects(fs.access(f.root+'/.ai-org/artifacts/WK-entry/authority.log'));
});

test('record-check requires log write scope before creating evidence',async t=>{
  const f=await checkFixture(t,['src','.ai-org/artifacts/WK-entry-other']);
  await assert.rejects(f.check('denied'),/log outside approved write paths/);
  await assert.rejects(fs.access(f.root+'/.ai-org/artifacts/WK-entry'));
});

test('record-check does not report a supervisor startup failure as a RED test',async t=>{
  const f=await checkFixture(t),spawn=childProcess.spawn;
  // Fault injection: the real supervisor child receives the start request but
  // exits before starting the test command or acknowledging it over IPC.
  childProcess.spawn=function(executable,args,options) {
    if(args[0]?.endsWith('/delivery-check-worker.mjs'))args=['-e',"process.on('message',()=>process.exit(2))"];
    return spawn.call(this,executable,args,options);
  };
  syncBuiltinESMExports();
  try {
    const result=await f.check('startup-failure');
    assert.equal(result.execution_started,false);assert.equal(result.exit_code,2);
    assert.equal(result.status,'instrument-failure');assert.equal(result.instrument_error,'command-start-unconfirmed');
    assert.equal(result.process_exit_confirmed,true);
    assert.match(await fs.readFile(f.root+'/'+result.log_ref,'utf8'),/Status: instrument-failure/);
  } finally {childProcess.spawn=spawn;syncBuiltinESMExports();}
});

test('record-check invalidates a passing command that changes its declared inputs',async t=>{
  const f=await checkFixture(t);
  await fs.writeFile(f.root+'/src/check.test.mjs',"import fs from 'node:fs';fs.writeFileSync('src/a.txt','changed by test');\n");
  const result=await f.check('mutating');assert.equal(result.exit_code,0);assert.equal(result.status,'invalidated');assert.deepEqual(result.changed_files,['src/a.txt']);
});

test('record-check preserves bounded output failures and confirms test-process cleanup',async t=>{
  const f=await checkFixture(t);
  await fs.writeFile(f.root+'/src/check.test.mjs',"process.stdout.write('x'.repeat(700000));\n");
  const result=await f.check('overflow');assert.equal(result.status,'instrument-failure');assert.equal(result.instrument_error,'output-limit');assert.equal(result.process_exit_confirmed,true);
  assert.ok((await fs.stat(f.root+'/'+result.log_ref)).size<1024*1024);
});

test('record-check CLI returns failure for RED while keeping its receipt and log',async t=>{
  const f=await checkFixture(t),script=new URL('../scripts/workkeel-delivery.mjs',import.meta.url).pathname;
  const child=spawnSync(process.execPath,[script,'record-check',f.root,'-'],{encoding:'utf8',input:JSON.stringify(f.checkInput('cli-red'))});
  assert.equal(child.status,1,child.stderr);const receipt=JSON.parse(child.stdout);assert.equal(receipt.status,'fail');
  assert.match(await fs.readFile(f.root+'/'+receipt.log_ref,'utf8'),/Exit code: 1/);
  for(const input of [' '.repeat(65537),Buffer.from([0xff])]) {
    const rejected=spawnSync(process.execPath,[script,'record-check',f.root,'-'],{input,encoding:'utf8'});
    assert.equal(rejected.status,1);assert.equal(rejected.stdout,'');assert.ok(!rejected.stderr.includes(f.root));
  }
  const excluded=spawnSync(process.execPath,[script,'submit',f.root,'-'],{input:'{}',encoding:'utf8'});
  assert.equal(excluded.status,1);assert.equal(excluded.stdout,'');
});

test('record-check strips ambient Node preload options from the actual test child',async t=>{
  const f=await checkFixture(t),oldOptions=process.env.NODE_OPTIONS,oldPath=process.env.NODE_PATH;
  t.after(()=>{if(oldOptions===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=oldOptions;if(oldPath===undefined)delete process.env.NODE_PATH;else process.env.NODE_PATH=oldPath;});
  await fs.writeFile(f.root+'/src/check.test.mjs',"import assert from 'node:assert/strict';assert.equal(process.env.NODE_OPTIONS,undefined);assert.equal(process.env.NODE_PATH,undefined);\n");
  process.env.NODE_OPTIONS='--require /nonexistent-workkeel-preload.cjs';process.env.NODE_PATH='/nonexistent-workkeel-modules';
  assert.equal((await f.check('clean-node-env')).status,'pass');
});

test('record-check bounds displayed output and retains the complete admitted log',async t=>{
  const f=await checkFixture(t);
  await fs.writeFile(f.root+'/src/check.test.mjs',"process.stdout.write('界'.repeat(8000));\n");
  const result=await f.check('excerpt');assert.equal(result.status,'pass');assert.equal(result.output.truncated,true);
  assert.ok(Buffer.byteLength(result.output.stdout)<=12*1024);assert.ok(!result.output.stdout.includes('\ufffd'));
  assert.ok((await fs.readFile(f.root+'/'+result.log_ref,'utf8')).includes('界'.repeat(8000)));
});

test('record-check rechecks authority after reserving the log and before executing tests',async t=>{
  const f=await checkFixture(t),open=fs.open;
  await fs.writeFile(f.root+'/src/check.test.mjs',"import fs from 'node:fs';fs.writeFileSync('src/started.txt','started');\n");
  fs.open=async function(file,...args){
    const handle=await open.call(this,file,...args);
    if(String(file).endsWith('/prestart.log')){const sync=handle.sync.bind(handle);let first=true;handle.sync=async()=>{await sync();if(first){first=false;await fs.writeFile(f.root+'/docs/approval.md','revoked before command');}};}
    return handle;
  };
  t.after(()=>{fs.open=open;});
  const result=await f.check('prestart');assert.equal(result.status,'blocked');assert.equal(result.execution_started,false);assert.equal(result.process_exit_confirmed,true);
  await assert.rejects(fs.access(f.root+'/src/started.txt'));
});
