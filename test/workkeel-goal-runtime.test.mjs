import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,execFile} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {createNativeTask,readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {readTaskFile} from '../src/task-contract.mjs';
import {createNativeGoal,readNativeGoal,controlNativeGoal,runNativeGoalStep,createTrustedGoalAdapter,validateGoalManifest,assertNativeGoalAuthority,goalAdmissionManifestDigest} from '../src/workkeel-goals.mjs';

const builder={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'};
const model={provider:'openai',model:'gpt-6-luna',reasoning:'low',service:'provider-default'};
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function fixture(t,{count=1,maxReworks=2,purpose='execution',release=false,checks=null,modelPolicy=null,roleModels={},browserScript=null}={}){
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-whole-goal-')));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const roots=[];
  for(let n=0;n<count;n++){
    const root=directory+'/repo-'+n;roots.push(root);await fs.mkdir(root+'/src',{recursive:true});await fs.mkdir(root+'/docs');git(root,'init','-q');git(root,'config','user.name','Synthetic');git(root,'config','user.email','fixture@example.invalid');
    await fs.writeFile(root+'/.gitignore','.ai-org/\n');await fs.writeFile(root+'/docs/approval.md','Explicit synthetic whole-goal scope, distinct review and bounded rework.');await fs.writeFile(root+'/src/value.mjs','export const value="baseline";\n');
    if(modelPolicy)await fs.writeFile(root+'/docs/models.json',JSON.stringify(modelPolicy)+'\n');
    if(browserScript){await fs.writeFile(root+'/docs/browser.mjs',browserScript);await fs.cp(new URL('../node_modules/playwright-core',import.meta.url),root+'/node_modules/playwright-core',{recursive:true});await fs.appendFile(root+'/.gitignore','node_modules/\n');}
    await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[builder,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
    git(root,'add','.');git(root,'commit','-qm','Synthetic initial project');
  }
  const target=roots[0],contracts=[];
  for(let n=0;n<count;n++){
    const root=roots[n],id='WK-component-'+n;
    const contract={schema_version:'workkeel.task-contract/v1',id,goal:'Exact synthetic component',actor:builder,state:'intake',scope:{include:['src'],exclude:['publication']},dependencies:[],acceptance:{criteria:['Exact synthetic component verified','Whole combination accepted'],evidence:[]},verification:{risk_tier:'standard',separation:'distinct-agent',implementer:null,reviewer:null,candidate_revision:null},handoff:null,environment:{cwd:'.',read_paths:['.'],write_paths:['src'],tools:['codex'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'approved-connection',policy_refs:['docs/approval.md']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null},execution:{runtime:{kind:'adapter',adapter_id:'codex-app-server',required_features:['filesystem-sandbox','network-disabled','fixed-model','resume','cancel']},model_connection:{kind:'codex-subscription',model:'gpt-6-luna',effort:'low'}},skills:[],legacy:null};
    if(modelPolicy){contract.execution.model_connection={kind:'policy',policy_ref:'docs/models.json'};contract.environment.data.policy_refs.push('docs/models.json');}
    if(browserScript){contract.environment.tools.push('node','browser');contract.environment.network={mode:'allowlist',hosts:['127.0.0.1']};contract.authorization.operations.push('network');contract.environment.data.policy_refs.push('docs/browser.mjs');}
    await createNativeTask(root,contract,{operation_id:'create-component-'+n,expected_version:0,actor:builder});contracts.push(await readNativeTask(root,id));
  }
  const manifest={schema_version:'workkeel.goal/v1',id:'goal-one',title:'All agreed synthetic components',approval_ref:'docs/approval.md',approved_by:builder,expires_at:null,components:roots.map((root,n)=>({id:'component-'+n,project_id:'project-'+n,repo_id:'repo-'+n,root,task_id:contracts[n].id,contract_sha256:contracts[n].contract_sha256,depends_on:n===count-1?roots.slice(0,-1).map((_,k)=>'component-'+k):[],checks:checks??[{id:'syntax',command:'node',args:['--check','src/value.mjs']}],rollback:'Restore the recorded source baseline with a separately governed revert',interface_refs:['src/value.mjs'],purpose})),integration:{component_id:'component-'+(count-1),criteria:['Whole combination accepted']},roles:{implementer:builder,reviewer,approver:builder},models:Object.fromEntries(['planning','implementation','verification','repair','review'].map(phase=>[phase,model])),limits:{max_operations:80,max_reworks:maxReworks,timeout_ms:800000,operation_timeout_ms:10000,max_cost_usd:null},control:{release_parent:release}};
  Object.assign(manifest.models,roleModels);
  await fs.writeFile(target+'/docs/goal.json',JSON.stringify(manifest,null,2)+'\n');
  // The approved manifest is committed before intake so source drift never hides
  // in task metadata, even when it lives beside component documentation.
  git(target,'add','docs/goal.json');git(target,'commit','-qm','Approve synthetic mandatory whole goal');
  const control={...structuredClone(contracts[0].contract),id:'WK-controller',goal:'Coordinate the explicitly approved whole goal',environment:{...contracts[0].contract.environment,write_paths:release?['.']:['.ai-org/goals'],tools:['node','git','codex'],data:{...contracts[0].contract.environment.data,policy_refs:['docs/approval.md','docs/goal.json']}},acceptance:{criteria:['Coordinate exact goal'],evidence:[]}};
  if(modelPolicy)control.environment.data.policy_refs.push('docs/models.json');
  if(browserScript){control.environment.tools.push('browser');control.environment.data.policy_refs.push('docs/browser.mjs');}
  await createNativeTask(target,control,{operation_id:'create-controller',expected_version:0,actor:builder});await mutateNativeTask(target,control.id,'claim',{operation_id:'claim-controller',expected_version:1,actor:builder,base_revision:git(target,'rev-parse','HEAD')});
  const task=await readNativeTask(target,control.id),request={task_id:task.id,actor:builder,claim_id:task.claim.id,contract_sha256:task.contract_sha256,operation_id:'register-whole-goal',expected_version:0,manifest_ref:'docs/goal.json'};
  await createNativeGoal(target,request);
  return {target,roots,manifest,request,directory};
}

import {createCodexGoalAdapter} from '../src/workkeel-goal-runtime.mjs';
import {createCodexProcessHost} from '../src/workkeel-codex-runtime.mjs';
// Actual child-process JSON-RPC; agents/model/permissions are offline fixtures.
function protocolHost({events=[],neverComplete=false,reviewAttention=false,reroute=false,efforts=['low'],models=['gpt-6-luna'],onQualify=async()=>{},onResponse=async()=>{}}={}){
  const source=`import readline from 'node:readline';import fs from 'node:fs';import crypto from 'node:crypto';
  const send=x=>process.stdout.write(JSON.stringify(x)+'\\n'),reply=(id,result)=>send({id,result});let thread,cwd;
  readline.createInterface({input:process.stdin}).on('line',line=>{
    const m=JSON.parse(line);
    if(m.method==='initialize')reply(m.id,{userAgent:'synthetic-offline-goal'});
    if(m.method==='account/read')reply(m.id,{account:{type:'chatgpt'}});
    if(m.method==='model/list')reply(m.id,{data:${JSON.stringify(models.map(model=>({model,supportedReasoningEfforts:efforts.map(reasoningEffort=>({reasoningEffort}))})))} });
    if(m.method==='thread/start'||m.method==='thread/resume'){
      thread=m.method==='thread/resume'?m.params.threadId:crypto.randomUUID();cwd=m.params.cwd;
      send({method:'fixture/thread',params:{method:m.method,thread_id:thread,...m.params}});
      reply(m.id,{thread:{id:thread,turns:[]},cwd,approvalPolicy:'never',instructionSources:[],runtimeWorkspaceRoots:[cwd],model:m.params.model,modelProvider:m.params.modelProvider,reasoningEffort:m.params.config.model_reasoning_effort,serviceTier:m.params.serviceTier,activePermissionProfile:{id:m.params.permissions}});
    }
    if(m.method==='thread/backgroundTerminals/clean')reply(m.id,{});
    if(m.method==='thread/backgroundTerminals/list')reply(m.id,{data:[],nextCursor:null});
    if(m.method==='thread/read')reply(m.id,{thread:{id:m.params.threadId,turns:[{id:'fixture-turn',status:'interrupted'}]}});
    if(m.method==='turn/start'){
      const context=JSON.parse(m.params.input[0].text),instruction=context.work.instruction,role=context.execution_context.role.role;
      send({method:'fixture/turn',params:{role,actor:context.task.actor,thread_id:thread,instruction,previous_results:context.work.previous_results}});
      reply(m.id,{turn:{id:'fixture-turn',status:'inProgress'}});
      send({method:'turn/started',params:{threadId:thread,turn:{id:'fixture-turn',status:'inProgress'}}});
      if(${reroute}){send({method:'model/rerouted',params:{threadId:thread,turnId:'fixture-turn',toModel:'unapproved'}});return;}
      if(${neverComplete})return;
      let output='Synthetic bounded planning completed';
      if(role==='implementation'||role==='repair')fs.writeFileSync(cwd+'/src/value.mjs','export const value="'+(role==='repair'?'fixed':'first')+'";\\n');
      if(role==='review'){
        const begin=instruction.indexOf('{"native_request":'),end=instruction.indexOf('}}',begin)+2,authored=JSON.parse(instruction.slice(begin,end));
        authored.native_request.judgment=fs.readFileSync(cwd+'/src/value.mjs','utf8').includes('"fixed"')?'pass':'fail';
        authored.native_request.summary='Distinct synthetic protocol reviewer checked observed fixed value';
        output=JSON.stringify(authored);
      }
      if(instruction.startsWith('Explore permitted')){const bytes=fs.readFileSync(cwd+'/src/value.mjs');output=JSON.stringify({proposals:[{id:'observed-source-value',title:'Observed source opportunity',direction:'fixture-improvement',risk_tier:'low',expected_benefit:'Test fixed exported value',acceptance:['Value is fixed'],evidence:[{path:'src/value.mjs',sha256:crypto.createHash('sha256').update(bytes).digest('hex')}],scope:{read_paths:['src'],write_paths:['src']},budget:{max_attempts:1,max_runtime_ms:1000,max_cost_usd:null}}]});}
      const outcome=${reviewAttention}&&role==='review'&&JSON.parse(output).native_request.judgment==='fail'?'attention':'done';
      send({method:'item/completed',params:{threadId:thread,turnId:'fixture-turn',item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify({outcome,output})}}});
      send({method:'thread/tokenUsage/updated',params:{threadId:thread,turnId:'fixture-turn',tokenUsage:{last:{inputTokens:2,outputTokens:1},total:{inputTokens:10,outputTokens:4}}}});
      send({method:'turn/completed',params:{threadId:thread,turn:{id:'fixture-turn',status:'completed'}}});
    }
    if(m.method==='turn/interrupt'){send({method:'fixture/interrupt',params:m.params});reply(m.id,{});send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:m.params.turnId,status:'interrupted'}}});}
  });`;
  const host=createCodexProcessHost({command:process.execPath,args:['--input-type=module','-e',source,'--'],env:{PATH:process.env.PATH},assertCompatible:onQualify});
  const connect=host.connect;host.connect=options=>{
    const rpc=connect({...options,onNotification:message=>{if(message.method.startsWith('fixture/'))events.push(message);else options.onNotification(message);}}),request=rpc.request.bind(rpc);
    return {...rpc,request:async(method,params,timeout)=>{const value=await request(method,params,timeout);await onResponse(method,params,value);return value;}};
  };
  return host;
}
async function fixtureCommand(ctx,{command,args}){
  assert.ok(['node','git'].includes(command));assert.ok(ctx.component.root.startsWith('/private/')||ctx.component.root.startsWith(os.tmpdir()));
  return new Promise(resolve=>execFile(command==='node'?process.execPath:'git',args,{cwd:ctx.component.root,timeout:5000,maxBuffer:1024*1024,env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}},(error,stdout,stderr)=>resolve({exit_code:error?.code??0,signal:error?.signal??null,stdout,stderr,output_complete:true})));
}
async function stockAdapter(options={}){return createCodexGoalAdapter({hostFactory:async()=>protocolHost(options),commandRunner:fixtureCommand});}

for(const boundary of ['adapter-qualification','runtime-qualification','initialize','model/list','thread/start','thread/backgroundTerminals/list'])test('actual stock host blocks stale authority at '+boundary+' and resumes only a proven unstarted operation',async t=>{
  const f=await fixture(t),events=[],original=await fs.readFile(f.target+'/docs/goal.json');let qualifications=0,injected=false;
  const inject=async()=>{if(!injected){injected=true;await fs.appendFile(f.target+'/docs/goal.json',' ');}};
  const host=protocolHost({events,onQualify:async()=>{qualifications++;if(boundary==='adapter-qualification'&&qualifications===2||boundary==='runtime-qualification'&&qualifications===3)await inject();},onResponse:async method=>{if(method===boundary)await inject();}});
  const adapter=await createCodexGoalAdapter({hostFactory:async()=>host,commandRunner:fixtureCommand});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  const blocked=await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  assert.equal(injected,true);assert.equal(events.filter(e=>e.method==='fixture/turn').length,0);assert.equal(blocked.model_called,false);
  assert.equal(blocked.operation.status,'intent');assert.equal(blocked.operation.first_result.dispatch_started,false);
  const before=await readNativeGoal(f.target,f.manifest.id);await fs.writeFile(f.target+'/docs/goal.json',original);
  const resumed=await runNativeGoalStep(f.target,f.manifest.id,{adapter});assert.equal(resumed.operation.id,blocked.operation.id);assert.equal(resumed.operation.status,'completed');
  assert.equal(events.filter(e=>e.method==='fixture/turn').length,1);const after=await readNativeGoal(f.target,f.manifest.id);
  assert.equal(after.operations.length,before.operations.length);assert.equal(after.reserved_ms,before.reserved_ms);assert.equal(after.components[0].phase,'implementation');assert.equal(after.last_error,null);
  if(boundary!=='adapter-qualification'){
    const slot=JSON.parse((await readTaskFile(f.target,'.ai-org/goals/goal-one/runtime/'+resumed.operation.id+'/slot.json')).content).value;
    assert.equal(slot.pre_model_stops.length,1);assert.equal(slot.pre_model_stops[0].quiescence,'no-model-request-and-owned-runtime-settled');
  }
});
for(const boundary of ['runtime-qualification','thread/start'])test('frozen cancellation settles proven unstarted stock work at '+boundary,async t=>{
  const f=await fixture(t),events=[];let qualifications=0,injected=false;
  const inject=async()=>{if(!injected){injected=true;await fs.appendFile(f.target+'/docs/goal.json',' ');}};
  const host=protocolHost({events,onQualify:async()=>{if(++qualifications===3&&boundary==='runtime-qualification')await inject();},onResponse:async method=>{if(method===boundary)await inject();}});
  const adapter=await createCodexGoalAdapter({hostFactory:async()=>host,commandRunner:fixtureCommand});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  const blocked=await runNativeGoalStep(f.target,f.manifest.id,{adapter}),before=await readNativeGoal(f.target,f.manifest.id);
  assert.equal(injected,true);assert.equal(blocked.model_called,false);assert.equal(blocked.operation.status,'intent');
  const ref='.ai-org/goals/goal-one/runtime/'+blocked.operation.id+'/slot.json',prior=JSON.parse((await readTaskFile(f.target,ref)).content).value;
  assert.equal(prior.status,'not-started');assert.equal(prior.model_requested,false);assert.equal(prior.turn_id,null);
  await controlNativeGoal(f.target,f.manifest.id,'cancel',{actor:builder,operation_id:'stop-proven-unstarted-'+boundary.replaceAll('/','-'),expected_version:before.version});
  for(let n=0;n<4;n++){if((await readNativeGoal(f.target,f.manifest.id)).status==='cancelled')break;await runNativeGoalStep(f.target,f.manifest.id,{adapter});}
  const after=await readNativeGoal(f.target,f.manifest.id),slot=JSON.parse((await readTaskFile(f.target,ref)).content).value;
  assert.equal(after.status,'cancelled');assert.equal((await readNativeTask(f.target,'WK-component-0')).state,'cancelled');
  assert.equal(slot.status,'cancelled');assert.deepEqual(slot.pre_model_stops,prior.pre_model_stops);
  const operation=after.operations.find(o=>o.id===blocked.operation.id);assert.equal(operation.status,'completed');assert.deepEqual(operation.first_result,before.operations.find(o=>o.id===blocked.operation.id).first_result);
  assert.equal(events.filter(e=>e.method==='fixture/turn').length,0);assert.equal(events.filter(e=>e.method==='fixture/interrupt').length,0);
});
async function finish(f,adapter,max=60){for(let n=0;n<max;n++){const view=await readNativeGoal(f.target,f.manifest.id);if(view.accepted)return view;const result=await runNativeGoalStep(f.target,f.manifest.id,{adapter});if(result.idle&&result.idle!=='whole-goal-accepted')throw Error(JSON.stringify({result,components:(await readNativeGoal(f.target,f.manifest.id)).components}));if(result.operation?.status==='unknown')throw Error(JSON.stringify(result.operation.result));}throw Error('Stock goal did not accept');}
test('stock protocol drives same-thread implementation, independent FAIL, repair and exact native PASS',async t=>{
  const f=await fixture(t),events=[],adapter=await stockAdapter({events,reviewAttention:true}),accepted=await finish(f,adapter);
  const task=await readNativeTask(f.target,'WK-component-0');assert.equal(task.state,'done');assert.equal(task.attempts[0].review.judgment,'fail');assert.equal(task.review.judgment,'pass');assert.equal(accepted.accepted,true);
  const turns=events.filter(e=>e.method==='fixture/turn').map(e=>e.params),planning=turns.find(e=>e.role==='planning'),implementation=turns.find(e=>e.role==='implementation'),reviews=turns.filter(e=>e.role==='review');
  assert.equal(planning.thread_id,implementation.thread_id);assert.equal(reviews.length,2);assert.ok(reviews.every(r=>r.actor.agent_id==='reviewer'&&r.thread_id!==implementation.thread_id));
  assert.equal(turns.find(e=>e.role==='repair').previous_results.prior_attempt.review.judgment,'fail','repair receives the original reviewer finding');
  for(const entry of events.filter(e=>e.method==='fixture/thread')){assert.equal(entry.params.modelProvider,'openai');assert.equal(entry.params.model,'gpt-6-luna');assert.equal(entry.params.serviceTier,'default');const profile=entry.params.config.permissions[entry.params.permissions];assert.equal(profile.network.enabled,false);assert.equal(profile.filesystem[':root'],'deny');}
  for(const review of accepted.operations.filter(o=>o.input.phase==='review')){assert.equal(review.result.product_access,'read');assert.equal(review.result.runtime_selection.provider,'openai');assert.equal(review.result.usage.input_tokens,10);}
  assert.equal(accepted.cost_complete,false);assert.equal(events.some(e=>e.method==='fixture/interrupt'),false);
});
test('stock host blocks finite financial caps and provider aliases before inference',async t=>{
  const f=await fixture(t),events=[],adapter=await stockAdapter({events}),task=await readNativeTask(f.target,'WK-component-0'),input={phase:'implementation',actor:builder,model};
  await assert.rejects(adapter.assertCapabilities({target:f.target,controller:{task_id:'WK-controller'},manifest:{...f.manifest,limits:{...f.manifest.limits,max_cost_usd:1}},component:f.manifest.components[0],task,input}),/finite financial/);
  await assert.rejects(adapter.assertCapabilities({target:f.target,controller:{task_id:'WK-controller'},manifest:f.manifest,component:f.manifest.components[0],task,input:{...input,model:{...model,provider:'codex'}}}),/provider or service/);assert.equal(events.length,0);
});

test('planning and review cannot replace the original fixed component connection',async t=>{
  const f=await fixture(t),events=[],adapter=await stockAdapter({events}),task=await readNativeTask(f.target,'WK-component-0');
  for(const phase of ['planning','review','implementation','repair'])await assert.rejects(adapter.assertCapabilities({target:f.target,controller:{task_id:'WK-controller'},manifest:f.manifest,component:f.manifest.components[0],task,input:{phase,actor:phase==='review'?reviewer:builder,model:{...model,model:'gpt-6.1-sol',reasoning:'high'}}}),/fixed native model/);
  assert.equal(events.length,0);
});

test('original policy authorizes separate review selection, while its data allowlist still blocks widening',async t=>{
  const stronger={provider:'openai',model:'gpt-6.1-sol',reasoning:'high',service:'provider-default'},policy={schema_version:'workkeel.execution-policy/v1',models:[{id:'implementation',connection:{kind:'codex-subscription',model:model.model,effort:model.reasoning},data_classes:['internal']},{id:'review',connection:{kind:'codex-subscription',model:stronger.model,effort:stronger.reasoning},data_classes:['internal']}],default_model:'implementation',rules:[],limits:{steps:80,attempts_per_node:2,parallelism:1,timeout_ms:800000,max_cost_usd:null},headroom:{mode:'off'}};
  const f=await fixture(t,{modelPolicy:policy,roleModels:{review:stronger}}),events=[],adapter=await stockAdapter({events,models:[model.model,stronger.model],efforts:['low','high']}),accepted=await finish(f,adapter);
  const actual=accepted.operations.filter(o=>o.input.phase==='review');assert.ok(actual.length);assert.ok(actual.every(o=>o.result.runtime_selection.model===stronger.model&&o.result.runtime_selection.reasoning==='high'));assert.equal(accepted.accepted,true);
  const denied={...policy,models:policy.models.map(m=>m.id==='review'?{...m,data_classes:['public']}:m)},other=await fixture(t,{modelPolicy:denied}),otherTask=await readNativeTask(other.target,'WK-component-0'),before=events.length;
  await assert.rejects(adapter.assertCapabilities({target:other.target,controller:{task_id:'WK-controller'},manifest:other.manifest,component:other.manifest.components[0],task:otherTask,input:{phase:'review',actor:reviewer,model:stronger}}),/original component data\/risk allowlist/);assert.equal(events.length,before);
});

test('stock macOS sandbox runs actual bounded Git checkpoints and readonly Node checks', {skip:process.platform!=='darwin'},async t=>{
  const f=await fixture(t),adapter=await createCodexGoalAdapter({hostFactory:async()=>protocolHost()});let accepted;
  try{accepted=await finish(f,adapter);}catch(e){const view=await readNativeGoal(f.target,f.manifest.id),last=view.operations.filter(o=>o.input.phase==='verification'&&o.result?.report_pin).at(-1);if(last)throw Error(e.message+' actual check log: '+(await readTaskFile(f.target,last.result.report_pin.path)).content);throw e;}
  assert.equal(accepted.accepted,true);assert.ok(accepted.operations.filter(o=>o.input.phase==='verification').every(o=>o.result.model_called===false));
});

test('stock host rejects missing local checkpoint identity before starting a model', {skip:process.platform!=='darwin'},async t=>{
  const f=await fixture(t),events=[],adapter=await createCodexGoalAdapter({hostFactory:async()=>protocolHost({events})});
  git(f.target,'config','--unset','user.email');git(f.target,'config','--unset','user.name');
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  const blocked=await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  assert.equal(blocked.idle,'host-capability-unavailable');
  const state=await readNativeGoal(f.target,f.manifest.id);
  assert.match(state.mandatory_components[0].progress.last_error,/repository-local Git author and committer identity/);
  assert.equal(events.length,0,'no qualification or inference starts for a checkout unable to commit');
  assert.equal(git(f.target,'diff','--name-only'),'');
  git(f.target,'config','user.name','Synthetic');git(f.target,'config','user.email','fixture@example.invalid');
  await controlNativeGoal(f.target,f.manifest.id,'recover',{actor:builder,operation_id:'recover-local-identity',expected_version:state.version});
  const resumed=await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  assert.equal(resumed.operation.result.status,'completed');
  assert.ok(events.some(event=>event.method==='fixture/turn'));
  await assert.rejects(fs.access(path.join(f.target,'.ai-org/goals/undefined')),{code:'ENOENT'});
});

test('actual readonly command sandbox denies check writes to approved product source', {skip:process.platform!=='darwin'},async t=>{
  const f=await fixture(t,{checks:[{id:'deny-source-write',command:'node',args:['-e',"require('node:fs').writeFileSync('src/forbidden.txt','unauthorized')"]}]}),adapter=await createCodexGoalAdapter({hostFactory:async()=>protocolHost()});let verification;
  for(let n=0;n<6;n++){const step=await runNativeGoalStep(f.target,f.manifest.id,{adapter});if(step.operation?.input.phase==='verification'){verification=step.operation.result;break;}}
  assert.equal(verification.model_called,false);assert.equal(verification.checks[0].status,'fail');await assert.rejects(fs.stat(f.target+'/src/forbidden.txt'),{code:'ENOENT'});assert.equal((await readNativeTask(f.target,'WK-component-0')).state,'build');
});

test('approved browser check runs owned Chrome, denies child processes and confines loopback ports', {skip:process.platform!=='darwin'||process.env.WORKKEEL_BROWSER_CHECKS!=='1'},async t=>{
  const browserScript=String.raw`import fs from 'node:fs/promises';import http from 'node:http';import net from 'node:net';import assert from 'node:assert/strict';import {chromium} from 'playwright-core';
await assert.rejects(fs.writeFile('src/forbidden-browser.txt','forbidden'));
await assert.rejects(fs.readFile('/etc/hosts'));
const {spawn}=await import('node:child_process');assert.throws(()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}),{code:'EPERM'});
const blocked=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:Number(process.env.WORKKEEL_CHECK_PORT)===1?2:1});s.on('error',e=>resolve(e.code));s.on('connect',()=>{s.destroy();resolve('connected');});});assert.equal(blocked,'EPERM');
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end('<html><body style="background:#171719;color:white"><h1>Ready</h1><button onclick="document.querySelector(\'h1\').textContent=\'Started\'">Start</button></body></html>');});await new Promise(resolve=>server.listen(Number(process.env.WORKKEEL_CHECK_PORT),'127.0.0.1',resolve));let browser;try{browser=await chromium.connectOverCDP(process.env.WORKKEEL_BROWSER_URL,{timeout:10000});const page=await browser.newPage({viewport:{width:1000,height:700}});await page.goto('http://127.0.0.1:'+process.env.WORKKEEL_CHECK_PORT);await page.getByRole('button',{name:'Start'}).click();assert.equal(await page.locator('h1').innerText(),'Started');await page.screenshot({path:process.env.WORKKEEL_CHECK_OUTPUT+'/dark.png'});}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}`;
  const f=await fixture(t,{browserScript,checks:[{id:'desktop',command:'browser',args:['docs/browser.mjs']}]}),events=[],adapter=await createCodexGoalAdapter({hostFactory:async()=>protocolHost({events})});
  let verification;for(let n=0;n<5;n++){const step=await runNativeGoalStep(f.target,f.manifest.id,{adapter});if(step.operation?.input.phase==='verification'){verification=step.operation.result;break;}}
  assert.ok(verification,JSON.stringify(await readNativeGoal(f.target,f.manifest.id)));
  assert.equal(verification.status,'completed',JSON.stringify(verification));
  const report=JSON.parse((await readTaskFile(f.target,verification.report_pin.path)).content);
  assert.equal(verification.checks[0].status,'pass',JSON.stringify(report));assert.equal(report.model_called,false);
  assert.equal(report.logs[0].visual_evidence.length,1);
  const pin=report.logs[0].visual_evidence[0],bytes=await fs.readFile(path.join(f.target,pin.path));assert.equal(bytes.subarray(0,4).toString('hex'),'89504e47');
  const turn=events.find(e=>e.method==='fixture/thread');assert.equal(turn.params.config.permissions[turn.params.permissions].network.enabled,false);
  await assert.rejects(fs.stat(f.target+'/src/forbidden-browser.txt'),{code:'ENOENT'});
});

test('crash after exact Git checkpoint recovers persisted role result without another implementation turn',async t=>{
  const f=await fixture(t),events=[];let interrupted=false;
  const adapter=await createCodexGoalAdapter({hostFactory:async()=>protocolHost({events}),commandRunner:async(ctx,request)=>{const value=await fixtureCommand(ctx,request);if(!interrupted&&request.command==='git'&&request.args.includes('commit')&&value.exit_code===0){interrupted=true;throw Error('Synthetic process loss after actual commit');}return value;}});
  for(let n=0;n<6;n++){const result=await runNativeGoalStep(f.target,f.manifest.id,{adapter});if(result.operation?.status==='unknown')break;}assert.equal(interrupted,true);
  const restarted=await stockAdapter({events}),accepted=await finish(f,restarted);assert.equal(accepted.accepted,true);assert.equal(events.filter(e=>e.method==='fixture/turn'&&e.params.role==='implementation').length,1);assert.ok(accepted.operations.some(o=>o.first_result?.reason?.includes('after actual commit')));
});
test('frozen stock cancellation interrupts exactly one actual owned turn after source drift',async t=>{
  const f=await fixture(t),events=[],adapter=await stockAdapter({events,neverComplete:true});await runNativeGoalStep(f.target,f.manifest.id,{adapter});const running=runNativeGoalStep(f.target,f.manifest.id,{adapter});
  while(!events.some(e=>e.method==='fixture/turn'))await new Promise(r=>setTimeout(r,10));
  const view=await readNativeGoal(f.target,f.manifest.id);await fs.appendFile(f.target+'/docs/goal.json',' ');await fs.appendFile(f.target+'/docs/approval.md',' changed');await controlNativeGoal(f.target,f.manifest.id,'cancel',{actor:builder,operation_id:'stop-stock-drift',expected_version:view.version});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});await running;for(let n=0;n<5;n++)await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  assert.equal((await readNativeGoal(f.target,f.manifest.id)).status,'cancelled');assert.equal(events.filter(e=>e.method==='fixture/turn').length,1);assert.ok(events.some(e=>e.method==='fixture/interrupt'));
});
test('cancellation loads an already terminal persisted thread without starting another turn',async t=>{
  const f=await fixture(t),events=[];let injected=false;
  const host=protocolHost({events,onResponse:async method=>{if(method==='thread/backgroundTerminals/list'&&!injected&&events.some(e=>e.method==='fixture/turn')){injected=true;throw Error('Synthetic lost cleanup acknowledgment');}}});
  const adapter=await createCodexGoalAdapter({hostFactory:async()=>host,commandRunner:fixtureCommand});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});const failed=await runNativeGoalStep(f.target,f.manifest.id,{adapter});assert.equal(failed.operation.status,'unknown');
  const before=await readNativeGoal(f.target,f.manifest.id);await controlNativeGoal(f.target,f.manifest.id,'cancel',{actor:builder,operation_id:'cancel-terminal-thread',expected_version:before.version});
  const cold=await stockAdapter({events});for(let n=0;n<4;n++)await runNativeGoalStep(f.target,f.manifest.id,{adapter:cold});
  assert.equal((await readNativeGoal(f.target,f.manifest.id)).status,'cancelled');
  assert.equal(events.filter(e=>e.method==='fixture/turn').length,1);assert.equal(events.filter(e=>e.method==='fixture/interrupt').length,0);
  assert.equal(events.filter(e=>e.method==='fixture/thread'&&e.params.method==='thread/resume').length,1);
});
test('readonly discovery exposes pinned benefit proposal only after actual native independent acceptance',async t=>{
  const f=await fixture(t,{purpose:'discovery'}),events=[],adapter=await stockAdapter({events});await fs.writeFile(f.target+'/src/value.mjs','export const value="fixed";\n');git(f.target,'add','src/value.mjs');git(f.target,'commit','-qm','Synthetic observed source');
  const accepted=await finish(f,adapter),reports=accepted.completed_discovery_reports;assert.equal(reports.length,1);assert.equal(reports[0].proposal_report.proposals[0].risk_tier,'low');assert.equal(reports[0].proposal_report.proposals[0].expected_benefit,'Test fixed exported value');
  assert.ok(events.filter(e=>e.method==='fixture/turn').every(e=>e.params.role!=='implementation'));assert.equal(await fs.readFile(f.target+'/src/value.mjs','utf8'),'export const value="fixed";\n');
});


