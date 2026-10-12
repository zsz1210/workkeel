import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {readNativeTask,assertTaskExecutionContext} from '../src/workkeel-tasks.mjs';
import {readTaskSummary} from '../src/workkeel-task-summary.mjs';
import {readTaskFile} from '../src/task-contract.mjs';
import {repeatedRepair} from '../src/workkeel-iteration.mjs';

const finite=v=>Number.isSafeInteger(v)&&v>=0;
const revision=/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const digest=/^[a-f0-9]{64}$/;
const git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:1024*1024}).trim();
function commandAllowed(argv,task){
 if(!Array.isArray(argv)||!argv.length||argv.length>80||argv.some(v=>typeof v!=='string'||!v||v.length>4096))throw Error('Invalid command argv');
 if(!task.contract.environment.tools.includes(path.basename(argv[0])))throw Error('Command is not in the approved tool list');
}
async function pinned(root,pin){
 if(!pin||typeof pin.path!=='string'||!digest.test(pin.sha256))throw Error('Invalid sample pin');
 const file=await readTaskFile(root,pin.path);if(file.digest!==pin.sha256)throw Error('Sample evidence changed');
 return file.content;
}
const sample=async(root,pin)=>JSON.parse(await pinned(root,pin));
export function checkProbe(probe,{expected_revision,free_bytes,now=Date.now()}) {
 const reasons=[];
 if(probe.schema_version!=='workkeel.test-probe/v1'||probe.revision!==expected_revision)reasons.push('probe-revision-mismatch');
 const age=now-Date.parse(probe.observed_at);if(!Number.isFinite(age)||age< -1000||age>30000)reasons.push('probe-not-fresh');
 const v=probe.viewport,i=probe.input_viewport;
 if(!v||!i||![v.width,v.height,i.width,i.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=32768)||v.width!==i.width||v.height!==i.height)reasons.push('input-viewport-mismatch');
 if(!Array.isArray(probe.targets)||!probe.targets.length||probe.targets.length>1000||probe.targets.some(t=>![t.x,t.y,t.width,t.height].every(Number.isFinite)||t.x<0||t.y<0||t.width<=0||t.height<=0||t.x+t.width>v?.width||t.y+t.height>v?.height))reasons.push('input-target-outside-viewport');
 if(![probe.estimated_generated_bytes,probe.max_generated_bytes,probe.reserve_bytes,free_bytes].every(finite)||probe.estimated_generated_bytes>probe.max_generated_bytes||free_bytes-probe.estimated_generated_bytes<probe.reserve_bytes)reasons.push('media-budget-exceeded');
 return reasons;
}
/** Explicit opt-in wrapper: inspect -> fresh probe -> validate -> long command.
 * Commands are caller supplied and host scoped; this is not a process sandbox. */
export async function preflight(root,request,{runProbe}={}) {
 root=await fs.realpath(root);
 const task=await readNativeTask(root,request.task_id);
 if(task.state!=='build'||task.claim?.id!==request.claim_id)throw Error('Preflight requires the current active claim');
 await assertTaskExecutionContext(root,task.id,{actor:task.claim.actor,claim_id:request.claim_id,contract_sha256:task.contract_sha256});
 if(!task.contract.authorization.operations.includes('execute'))throw Error('Task does not authorize execution');
 if(!revision.test(request.expected_revision)||git(root,['rev-parse','HEAD'])!==request.expected_revision)throw Error('Candidate revision changed');
 const summary=await readTaskSummary(root,task.id),reasons=[];
 if(summary.quality.delivery_progress.status==='unavailable')reasons.push('iteration-evidence-unavailable');
 if(!request.issue||!['issue_id','hypothesis','change'].every(k=>typeof request.issue[k]==='string'&&request.issue[k].trim()))throw Error('Issue, hypothesis and intended change are required');
 if(repeatedRepair(summary.quality.delivery_progress.iterations,request.issue))reasons.push('repeated-unresolved-approach');
 const before=await sample(root,request.sample?.baseline),after=await sample(root,request.sample?.result),decision=await sample(root,request.sample?.approval);
 if(before.schema_version!=='workkeel.sample/v1'||after.schema_version!=='workkeel.sample/v1'||before.pass!==false||!revision.test(before.candidate_revision)||request.sample.baseline.path===request.sample.result.path||request.sample.baseline.sha256===request.sample.result.sha256||!digest.test(before.conditions_sha256)||before.conditions_sha256!==after.conditions_sha256||after.candidate_revision!==request.expected_revision||after.pass!==true||decision.schema_version!=='workkeel.sample-decision/v1'||decision.candidate_revision!==request.expected_revision||decision.sample_sha256!==request.sample.result.sha256||decision.decision!=='ready'||!task.contract.authorization.approved_by||decision.authority!==task.contract.authorization.approved_by)reasons.push('comparable-sample-not-approved');
 commandAllowed(request.probe_command,task);commandAllowed(request.test_command,task);
 if(!Number.isSafeInteger(request.timeout_ms)||request.timeout_ms<1||request.timeout_ms>3600000)throw Error('Invalid bounded test timeout');
 if(reasons.length)return {schema_version:'workkeel.preflight-result/v1',ready:false,reasons,probe_executed:false,long_test_executed:false};
 const stdout=runProbe?await runProbe(request.probe_command):execFileSync(request.probe_command[0],request.probe_command.slice(1),{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:64*1024});
 const probe=typeof stdout==='string'?JSON.parse(stdout):stdout,space=await fs.statfs(root,{bigint:true}),free=space.bavail*space.bsize;
 reasons.push(...checkProbe(probe,{expected_revision:request.expected_revision,free_bytes:Number(free>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):free)}));
 if(!Array.isArray(probe.required_resources)||!probe.required_resources.length||probe.required_resources.length>100)reasons.push('resource-inventory-missing');
 else for(const pin of probe.required_resources){try{await pinned(root,pin);}catch{reasons.push('required-resource-unavailable');}}
 if(git(root,['rev-parse','HEAD'])!==request.expected_revision)reasons.push('candidate-changed-during-probe');
 const current=await readNativeTask(root,request.task_id);if(current.version!==task.version||current.claim?.id!==request.claim_id)reasons.push('claim-changed-during-probe');
 else await assertTaskExecutionContext(root,task.id,{actor:task.claim.actor,claim_id:request.claim_id,contract_sha256:task.contract_sha256});
 for(const pin of Object.values(request.sample)){try{await pinned(root,pin);}catch{reasons.push('sample-changed-during-probe');}}
 return {schema_version:'workkeel.preflight-result/v1',ready:reasons.length===0,reasons:[...new Set(reasons)],probe_executed:true,long_test_executed:false,checked_at:new Date().toISOString(),candidate_revision:request.expected_revision,
  sample_pins:request.sample,probe,free_bytes:Number(free>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):free),authority:'caller-attributed-probe',acceptance_granted:false};
}
export async function runIteration(root,request,options={}) {
 const result=await preflight(root,request,options);if(!result.ready)return result;
 const run=options.runTest??((argv)=>spawnSync(argv[0],argv.slice(1),{cwd:root,timeout:request.timeout_ms,stdio:'inherit'}));
 const execution=await run(request.test_command);
 return {...result,long_test_executed:true,test_exit_code:execution.status??null,test_signal:execution.signal??null,test_passed:execution.status===0};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {const [mode,root,file]=process.argv.slice(2);if(!['check','run'].includes(mode)||!root||!file)throw Error('Usage: workkeel-iteration.mjs check|run PROJECT REQUEST');
 const request=JSON.parse(await fs.readFile(file,'utf8')),result=await (mode==='run'?runIteration:preflight)(root,request);
 console.log(JSON.stringify(result,null,2));if(!result.ready||mode==='run'&&!result.test_passed)process.exitCode=1;
 }catch(error){console.error(JSON.stringify({ready:false,message:error.message,long_test_executed:false}));process.exitCode=1;}
}
