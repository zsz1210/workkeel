// Synthetic offline data only; no provider calls. Shared by monitor checks.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {createNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {executeWorkflow} from '../src/workkeel-workflows.mjs';
const actor={agent_id:'builder',principal_id:'owner'};
export async function createMonitorFixture({empty=false,extended=false}={}) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-monitor-'));
 const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-C',root,...args],{env,timeout:10000,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q','--template=');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 const reviewer={agent_id:'reviewer',principal_id:'owner'};
 await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
 await fs.mkdir(path.join(root,'docs'));await fs.mkdir(path.join(root,'src'));
 const policy={schema_version:'workkeel.execution-policy/v1',models:[{id:'native',connection:{kind:'native'},data_classes:['public']}],default_model:'native',rules:[],headroom:{mode:'off'},limits:{steps:1,attempts_per_node:1,parallelism:1,timeout_ms:10000,max_cost_usd:null}};
 const graph={schema_version:'workkeel.workflow/v1',nodes:[{id:'work',kind:'runtime',input:'Offline fixture'}],edges:[{from:'start',to:'work'},{from:'work',to:'end'}]};
 for(const [name,value] of [['policy.json',JSON.stringify(policy)],['workflow.json',JSON.stringify(graph)],['approval.md','Approved synthetic offline monitor fixture; no providers.']])await fs.writeFile(path.join(root,'docs',name),value);
 git('add','.');git('commit','-qm','Synthetic monitor fixture');
 if(empty)return root;
 for(const mode of ['unobserved','completed','interrupted',...(extended?['review','accepted','working']:[])]) {
  const id='WK-'+mode;
  const task={schema_version:'workkeel.task-contract/v1',id,goal:mode==='unobserved'?'<img src=x onerror=alert(1)> Unobserved task':mode+' synthetic task',state:'intake',actor,scope:{include:['Offline fixture'],exclude:['External calls']},dependencies:[],acceptance:{criteria:['Fixture only'],evidence:[]},handoff:null,verification:{risk_tier:'standard',separation:'distinct-agent',implementer:null,reviewer:null,candidate_revision:null},environment:{cwd:'.',read_paths:['src'],write_paths:['src'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'public',model_access:'none',policy_refs:['docs/approval.md','docs/policy.json','docs/workflow.json']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null},skills:[],execution:{runtime:{kind:'adapter',adapter_id:'fixture',required_features:[]},model_connection:{kind:'policy',policy_ref:'docs/policy.json'}},legacy:null};
  await createNativeTask(root,task,{operation_id:'create',expected_version:0,actor});
  if(mode==='unobserved')continue;
  if(['review','accepted','working'].includes(mode)){
   git('add','.');git('commit','-qm','Pin synthetic lifecycle candidate');
   const revision=git('rev-parse','HEAD');
   const claimed=await mutateNativeTask(root,id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:revision});
   if(mode==='working')continue;
   await mutateNativeTask(root,id,'handoff',{operation_id:'handoff',expected_version:2,actor,claim_id:claimed.claim.id,revision,summary:'Synthetic delivery',evidence:['docs/approval.md'],unresolved:[]});
   if(mode==='accepted'){
    await mutateNativeTask(root,id,'review',{operation_id:'review',expected_version:3,actor:reviewer,revision,judgment:'pass',summary:'Synthetic review only',evidence:['docs/approval.md']});
    await mutateNativeTask(root,id,'close',{operation_id:'close',expected_version:4,actor,revision,summary:'Synthetic local acceptance',rollback:'Retain fixture only',evidence:['docs/approval.md']});
   }
   continue;
  }
  const claim=await mutateNativeTask(root,id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
  const run={run_id:mode,task_id:id,actor,claim_id:claim.claim.id,policy_ref:'docs/policy.json',workflow_ref:'docs/workflow.json'};
  const perform=async({observe})=>{const usage={input_tokens:1200,output_tokens:80,cost_usd:null};if(mode==='interrupted'){await observe({runtime_model:'fixture-runtime',observed_model:null,usage});throw Error('Synthetic interrupted operation');}return {status:'completed',conversation_id:null,output:'PRIVATE_OUTPUT_NOT_FOR_MONITOR',outcome:'done',runtime_model:'fixture-runtime',observed_model:null,usage};};
  try{await executeWorkflow(root,run,{adapters:[{id:'fixture',assertCompatible:async()=>{},start:perform,resume:perform,cancel:async()=>{}}]});}catch(e){if(mode!=='interrupted')throw e;}
  await mutateNativeTask(root,id,'release',{operation_id:'release',expected_version:2,actor,claim_id:claim.claim.id,summary:'Offline fixture finished'});
 }
 return root;
}
