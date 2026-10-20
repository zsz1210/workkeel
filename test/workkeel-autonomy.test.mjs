import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {mutateNativeTask,readNativeTask} from '../src/workkeel-tasks.mjs';
import {readAutonomy,mutateAutonomy,runAutonomyStep,serveAutonomy} from '../src/workkeel-autonomy.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-autonomy-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  await fs.mkdir(root+'/docs');await fs.writeFile(root+'/docs/approval.md','Synthetic approval');
  git('add','docs');git('commit','-qm','Synthetic baseline');
  const actor={agent_id:'builder',principal_id:'owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,{agent_id:'reviewer',principal_id:'owner'}],approvers:['owner'],review_separation:'distinct-agent'});
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-test',goal:'Synthetic bounded execution',actor,acceptance:['Approved goal accepted independently'],environment:{cwd:'.',read_paths:['docs'],write_paths:['.ai-org/autonomy'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
  const p=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,p.fingerprint);await mutateNativeTask(root,'WK-test','claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
  const task=await readNativeTask(root,'WK-test');let n=0;
  const request=async extra=>({task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,operation_id:'operation-'+(++n),expected_version:(await readAutonomy(root)).version,...extra});
  return {root,task,request};
}
test('off and idle make no host calls; optimistic versions and retries are stable',async t=>{
  const f=await fixture(t);let calls=0;const adapter={idempotent:true,start:async()=>{calls++;return {status:'completed'};},reconcile:async()=>{calls++;return {status:'running'};}};
  assert.equal((await readAutonomy(f.root)).policy.enabled,false);
  assert.equal((await runAutonomyStep(f.root,{goalAdapter:adapter})).model_called,false);assert.equal(calls,0);
  const req=await f.request({});const first=await mutateAutonomy(f.root,'pause',req);
  assert.equal(first.state.paused,true);assert.equal((await mutateAutonomy(f.root,'pause',req)).replayed,true);
  await assert.rejects(mutateAutonomy(f.root,'resume',{...req,operation_id:'stale'}),/version conflict/);
  await assert.rejects(mutateAutonomy(f.root,'resume',req),/operation conflict/);
  assert.equal((await runAutonomyStep(f.root,{goalAdapter:adapter})).idle,'paused');assert.equal(calls,0);
});

test('retired job and marker commands fail without changing state',async t=>{
  const f=await fixture(t),before=await readAutonomy(f.root);
  for(const action of ['enqueue','cancel','resume-job','discover']){
    await assert.rejects(mutateAutonomy(f.root,action,await f.request({})),/retired.*goal/);
    assert.deepEqual(await readAutonomy(f.root),before);
  }
});

test('legacy jobs stay readable; only possibly live executions block tick and serve',async t=>{
  const f=await fixture(t);await mutateAutonomy(f.root,'event',await f.request({event_id:'approved-event'}));
  const ref=f.root+'/.ai-org/autonomy/state.json',state=await readAutonomy(f.root);
  const job={id:'legacy',origin:'assigned',direction:null,reason:'Synthetic historical work',task_id:f.task.id,request_ref:'docs/retired.json',request_sha256:'a'.repeat(64),depends_on:[],status:'running',attempts:1,execution_id:'frozen-operation',updated_at:new Date().toISOString(),error:null,retry_at:null};
  state.jobs.push(job);
  const save=()=>fs.writeFile(ref,JSON.stringify({state,sha256:executionDigest(state)}));await save();
  const before=await fs.readFile(ref,'utf8');
  assert.equal((await readAutonomy(f.root)).jobs[0].execution_id,'frozen-operation');
  for(const status of ['running','recovery-required']){
    state.jobs[0].status=status;await save();
    await assert.rejects(runAutonomyStep(f.root),/Legacy.*original runner.*before b7dd85b2\.\.f3f97d97.*autonomy tick\/cancel/);
  }
  state.jobs[0].status='running';await save();assert.equal(await fs.readFile(ref,'utf8'),before);
  state.paused=true;await save();assert.equal((await runAutonomyStep(f.root)).idle,'paused');
  state.paused=false;
  const cli=fileURLToPath(new URL('../bin/workkeel.mjs',import.meta.url));
  for(const [status,execution_id] of [['awaiting-acceptance','frozen-operation'],['queued',null],['running',null],['recovery-required',null],['completed','frozen-operation']]){
    state.jobs[0].status=status;state.jobs[0].execution_id=execution_id;await save();
    const retained=await fs.readFile(ref,'utf8');
    assert.equal((await runAutonomyStep(f.root)).idle,'improvement-disabled');
    const output=execFileSync(process.execPath,[cli,'autonomy','tick',f.root],{encoding:'utf8'});
    assert.equal(JSON.parse(output).idle,'improvement-disabled');
    const settled=Promise.withResolvers(),service=await serveAutonomy(f.root,{debounce_ms:0,reconcile_ms:60000,watchFactory:()=>({close(){}}),onError:settled.reject,onStep:settled.resolve});
    try{assert.equal((await settled.promise).idle,'improvement-disabled');}finally{service.close();}
    assert.equal(await fs.readFile(ref,'utf8'),retained,'legacy jobs remain unchanged');
    assert.equal((await readAutonomy(f.root)).jobs[0].status,status);
  }
});

test('events and policy retain authority and integrity checks',async t=>{
  const f=await fixture(t),request=await f.request({event_id:'source-changed'});
  await assert.rejects(mutateAutonomy(f.root,'event',{...request,claim_id:'wrong'}));
  await assert.rejects(mutateAutonomy(f.root,'policy',await f.request({policy:{enabled:true,directions:[],max_jobs:3,max_attempts:2,cooldown_ms:0}})),/explicit directions/);
  await mutateAutonomy(f.root,'event',request);assert.equal((await readAutonomy(f.root)).last_event,'source-changed');
  const ref=f.root+'/.ai-org/autonomy/state.json',envelope=JSON.parse(await fs.readFile(ref,'utf8'));envelope.state.paused=true;
  await fs.writeFile(ref,JSON.stringify(envelope));await assert.rejects(readAutonomy(f.root),/integrity/);
});

test('idle service uses no host, observes events and closes all watchers',async t=>{
  const f=await fixture(t),settled=Promise.withResolvers(),errors=[];let steps=0,closed=0;
  const service=await serveAutonomy(f.root,{debounce_ms:0,reconcile_ms:60000,watchFactory:()=>({close(){closed++;}}),onError:e=>{errors.push(e);settled.reject(e);},onStep:r=>{steps++;assert.equal(r.model_called,false);settled.resolve();}});
  t.after(()=>service.close());await settled.promise;
  const deadline=Date.now()+5000;while(service.observe().state==='checking'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(steps,1);assert.equal(service.observe().state,'listening');assert.equal(service.observe().started_at,null);
  service.close();service.trigger();assert.equal(service.observe().state,'stopped');assert.equal(closed,2);assert.deepEqual(errors,[]);
});

test('aborted ticks and services never initiate a goal operation',async t=>{
  const f=await fixture(t),controller=new AbortController();controller.abort();let steps=0;
  assert.equal((await runAutonomyStep(f.root,{signal:controller.signal})).idle,'aborted');
  const service=await serveAutonomy(f.root,{signal:controller.signal,onStep:()=>steps++,watchFactory:()=>({close(){}})});
  assert.equal(service.observe().state,'stopped');assert.equal(steps,0);
});


test('CLI tick is idle without a workflow host and retired commands report goal guidance',async t=>{
  const f=await fixture(t),cli=fileURLToPath(new URL('../bin/workkeel.mjs',import.meta.url));
  const output=execFileSync(process.execPath,[cli,'autonomy','tick',f.root],{encoding:'utf8'});
  assert.equal(JSON.parse(output).idle,'improvement-disabled');
  const requestRef=f.root+'/docs/request.json';await fs.writeFile(requestRef,JSON.stringify(await f.request({})));
  for(const action of ['enqueue','cancel','discover','resume-job']){
    assert.throws(()=>execFileSync(process.execPath,[cli,'autonomy',action,f.root,'--request','docs/request.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}),error=>{
      assert.match(error.stderr,/retired.*goal/);return true;
    });
  }
  assert.deepEqual((await readAutonomy(f.root)).jobs,[]);
});
