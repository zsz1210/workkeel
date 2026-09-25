// Bounded offline exercise: only the dedicated child below is terminated.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {mutateNativeTask,readNativeTask} from '../src/workkeel-tasks.mjs';
import {recoverWorkflowLock} from '../src/workkeel-workflows.mjs';
import {sha256} from '../src/files.mjs';

const exec=promisify(execFile);
const actor={agent_id:'builder',principal_id:'owner'};
const result={status:'completed',conversation_id:'offline-process',output:'Local durable effect verified',outcome:'done',observed_model:null,usage:{input_tokens:null,output_tokens:null,cost_usd:null}};
const workflowURL=new URL('../src/workkeel-workflows.mjs',import.meta.url).href;
const childCode=`
  import fs from 'node:fs/promises';
  import {executeWorkflow} from ${JSON.stringify(workflowURL)};
  const [root,mode]=process.argv.slice(1);
  const request=JSON.parse(await fs.readFile(root+'/request.json','utf8'));
  const result=${JSON.stringify(result)};
  const step=async ({input,operation_id})=>{
    const name=input.instruction;
    await fs.writeFile(root+'/src/'+name+'.txt',operation_id+'\\n',{flag:'wx'});
    if(mode==='crash'&&name==='middle'){
      process.send({event:'effect-written',pid:process.pid,operation_id});
      setInterval(()=>{},1000);
      await new Promise(()=>{});
    }
    return result;
  };
  const reconciliations=mode==='resume'?[{operation_id:'middle-0-0',result,evidence_ref:'docs/reconciliation.json'}]:[];
  const run=await executeWorkflow(root,request,{reconciliations,adapters:[{id:'offline-process',assertCompatible:async()=>{},start:step,resume:step,cancel:async()=>{}}]});
  console.log(JSON.stringify(run.status));
`;

export async function verifyProcessRecovery(target) {
  if(process.platform==='win32') throw Error('This process-signal exercise requires POSIX');
  const root=path.resolve(target);
  await fs.mkdir(root); // Exclusive directory creation; never reuse a user's project.
  const started=performance.now(),phases=[];
  const phase=async(name,fn)=>{const at=performance.now();const value=await fn();phases.push({name,elapsed_ms:performance.now()-at});return value;};
  const write=(ref,value)=>fs.writeFile(path.join(root,ref),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  let child,closed;
  try {
    git('init','-q');git('config','user.name','Offline recovery fixture');git('config','user.email','fixture@example.invalid');
    await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor],approvers:['owner'],review_separation:'distinct-agent'});
    await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');
    await write('docs/approval.md','Approved synthetic local process recovery; no network, models, external effects or descendant processes. Preserve uncertain intent until actual filesystem effects are checked.');
    await write('docs/policy.json',{schema_version:'workkeel.execution-policy/v1',models:[{id:'offline',connection:{kind:'native'},data_classes:['internal']}],default_model:'offline',rules:[],headroom:{mode:'off'},limits:{steps:3,attempts_per_node:1,parallelism:1,timeout_ms:120000,max_cost_usd:null}});
    await write('docs/workflow.json',{schema_version:'workkeel.workflow/v1',nodes:['first','middle','last'].map(id=>({id,kind:'runtime',input:id})),edges:[{from:'start',to:'first'},{from:'first',to:'middle'},{from:'middle',to:'last'},{from:'last',to:'end'}]});
    const brief={schema_version:'workkeel.task-brief/v1',id:'WK-recovery',goal:'Qualify local interrupted-process recovery',actor,acceptance:['Each local effect written once; uncertain intent reconciled; no task acceptance inferred'],
      environment:{cwd:'.',read_paths:['src'],write_paths:['src'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md','docs/policy.json','docs/workflow.json']}},
      authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null},
      execution:{runtime:{kind:'adapter',adapter_id:'offline-process',required_features:[]},model_connection:{kind:'policy',policy_ref:'docs/policy.json'}}};
    const p=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,p.fingerprint);
    git('add','.');git('commit','-qm','Freeze offline process recovery fixture');
    const claim=await mutateNativeTask(root,brief.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
    const request={run_id:'recovery-one',task_id:brief.id,claim_id:claim.claim.id,actor,workflow_ref:'docs/workflow.json',policy_ref:'docs/policy.json'};
    await write('request.json',request);
    let stdout='',stderr='';
    const notice=await phase('start-until-middle-effect',()=>new Promise((resolve,reject)=>{
      child=spawn(process.execPath,['--input-type=module','-e',childCode,root,'crash'],{stdio:['ignore','pipe','pipe','ipc']});
      child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
      closed=new Promise(done=>child.once('close',(code,signal)=>done({code,signal})));
      const timer=setTimeout(()=>reject(Error('Effect notice timeout')),30000);
      child.once('error',e=>{clearTimeout(timer);reject(e);});
      child.once('message',m=>{clearTimeout(timer);resolve(m);});
      child.once('exit',(code,signal)=>{clearTimeout(timer);reject(Error('Child ended before notice: '+code+'/'+signal));});
    }));
    assert.equal(notice.event,'effect-written');assert.equal(notice.pid,child.pid);
    await assert.rejects(recoverWorkflowLock(root,request.run_id,actor),/still exists/);
    const exit=await phase('terminate-owned-runner',async()=>{child.kill('SIGKILL');return await closed;});
    assert.equal(exit.signal,'SIGKILL');
    assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
    await write('killed-child.json',{notice,exit,stdout,stderr,descendants:'none: adapter uses filesystem operations in the runner only'});
    await fs.cp(root+'/.ai-org/execution',root+'/journal-at-stop',{recursive:true,errorOnExist:true,force:false});
    const stoppedOperation=JSON.parse(await fs.readFile(root+'/journal-at-stop/recovery-one/operations/middle-0-0.json','utf8'));
    assert.equal(stoppedOperation.value.result,null);
    const runChild=mode=>exec(process.execPath,['--input-type=module','-e',childCode,root,mode],{timeout:30000,maxBuffer:1024*1024});
    let blocked=[];
    for(const [mode,pattern] of [['locked',/locked/],['uncertain',/Uncertain/]]) {
      if(mode==='uncertain') await phase('recover-stopped-lock',()=>recoverWorkflowLock(root,request.run_id,actor));
      let failure;
      try {await runChild('inspect');} catch(e){failure=e;}
      assert.ok(failure,mode+' must reject');assert.match(failure.stderr,pattern);
      blocked.push({mode,code:failure.code,stderr:failure.stderr});
    }
    await write('blocked-attempts.json',blocked);
    const before={};
    for(const name of ['first','middle']) {
      const bytes=await fs.readFile(root+'/src/'+name+'.txt');
      assert.equal(bytes.toString(),request.run_id+':'+name+'-0-0\n');before[name]=sha256(bytes);
    }
    await assert.rejects(fs.stat(root+'/src/last.txt'),{code:'ENOENT'});
    await write('docs/reconciliation.json',{operation_id:'middle-0-0',result,source:'Coordinator checked exact durable local effect after owning process exit',effect_sha256:before.middle,stopped_pid:child.pid});
    const resumed=await phase('reconcile-and-resume-fresh-process',async()=>JSON.parse((await runChild('resume')).stdout));
    await write('resumed-status.json',resumed);
    assert.equal(resumed.state,'completed');assert.equal(resumed.dispatches,3);
    const replay=await phase('completed-replay-fresh-process',async()=>JSON.parse((await runChild('replay')).stdout));
    await write('replayed-status.json',replay);
    assert.equal(replay.state,'completed');assert.equal(replay.dispatches,3);
    for(const name of ['first','middle']) assert.equal(sha256(await fs.readFile(root+'/src/'+name+'.txt')),before[name]);
    assert.equal(await fs.readFile(root+'/src/last.txt','utf8'),request.run_id+':last-0-0\n');
    const task=await readNativeTask(root,brief.id);assert.equal(task.state,'build');
    const report={schema_version:'workkeel.process-recovery-exercise/v1',passed:true,kind:'offline-adapter-real-process-kill',phases,elapsed_ms:performance.now()-started,
      guards:{live_lock_refused:true,dead_lock_recovered:true,locked_replay_refused:true,uncertain_replay_refused:true},effects:{first:1,middle:1,last:1},
      model_calls:0,model_tokens:null,human_actions_measured:null,coordinator_recovery_actions:['verify stopped process and durable effect','recover lock','record evidence and reconcile existing run'],task_state:task.state,
      limitation:'One synthetic local scenario; not Codex/model crash, cross-machine recovery or universal exactly-once external effects.'};
    await write('result.json',report);return report;
  } finally {
    if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length!==3) throw Error('Usage: node scripts/verify-workkeel-process-recovery.mjs <new-isolated-directory>');
  console.log(JSON.stringify(await verifyProcessRecovery(process.argv[2]),null,2));
}
