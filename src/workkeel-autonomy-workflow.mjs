import {exactKeys,executionDigest} from './workkeel-execution-policy.mjs';
import {readWorkflowRun,readExecutionRecord,executeWorkflow,cancelWorkflow} from './workkeel-workflows.mjs';
import {readTaskFile} from './task-contract.mjs';
import {assertTaskExecutionContext} from './workkeel-tasks.mjs';

/** This adapter loads only the canonical native engine. Resume uses its exact
 * run/checkpoint identity, never a new run ID or synthesized approval. */
export function createAutonomyWorkflowAdapter(target,{runtimeFactory}={}){
  const requestFor=r=>{
    exactKeys(r.request,['run'],['approvals','reconciliations']);
    const recipe=r.request.run;
    exactKeys(recipe,['run_id','workflow_ref','policy_ref'],['task_id','actor','claim_id','material_refs','model_policy','capabilities']);
    const frozen=r.job.authority;
    if(!frozen||frozen.task_id!==r.task.id||frozen.contract_sha256!==r.task.contract_sha256)throw Error('Missing or changed canonical autonomy authority');
    if(recipe.task_id!==undefined&&recipe.task_id!==frozen.task_id||recipe.claim_id!==undefined&&recipe.claim_id!==frozen.claim_id||recipe.actor!==undefined&&executionDigest(recipe.actor)!==executionDigest(frozen.actor))throw Error('Autonomy workflow authority differs from frozen task');
    return {...recipe,task_id:frozen.task_id,actor:frozen.actor,claim_id:frozen.claim_id};
  };
  const lockPresent=async id=>{
    try{await readTaskFile(target,'.ai-org/execution/'+id+'/runner.lock');return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
  };
  const convert=async run=>{
    const locked=await lockPresent(run.run_id),state=run.status.state;
    if(state==='cancelled'&&locked)return {status:'unknown',run_id:run.run_id,reason:'Cancellation requested; runner quiescence not confirmed'};
    const status=({completed:'completed',cancelled:'cancelled',rejected:'failed',failed:'failed',interrupted:'paused',paused:'paused','awaiting-approval':'paused',blocked:'unknown'})[state]??'running';
    return {status,run_id:run.run_id,reason:state,quiescent:!locked};
  };
  const existing=async r=>{
    const q=requestFor(r);try{const run=await readWorkflowRun(target,q.run_id);if(executionDigest(run.request)!==executionDigest(q))throw Error('Autonomy existing run identity differs');return run;}catch(e){if(e.code==='ENOENT')return null;throw e;}
  };
  const reported=async(run,r)=>{
    const value=await convert(run);value.usage=run.status.usage??null;
    if(r.job.purpose!=='discovery'||value.status!=='completed')return value;
    try{
    const root='.ai-org/execution/'+run.run_id;
    const ids=await readExecutionRecord(target,root+'/operations-index.json');
    if(!Array.isArray(ids)||!ids.length||ids.length>1000)throw Error('Discovery requires a bounded completed operation journal');
    const operationRef=root+'/operations/'+ids.at(-1)+'.json',operation=await readExecutionRecord(target,operationRef);
    if(operation.run_id!==run.run_id||operation.result?.status!=='completed'||typeof operation.result.output!=='string'||Buffer.byteLength(operation.result.output)>65536)throw Error('Discovery output is unavailable or exceeds bound');
    try{value.proposal_report=JSON.parse(operation.result.output);}catch{throw Error('Discovery output must be structured proposal JSON');}
    value.source_pins=[];
    for(const ref of [root+'/run.json',root+'/status.json',operationRef])value.source_pins.push({path:ref,sha256:(await readTaskFile(target,ref)).bytes_digest});
    }catch{value.proposal_report=null;value.proposal_error='Runtime completed; proposal output missing, invalid or stale';}
    return value;
  };
  const execute=async(r,{signal}={})=>{
    const q=requestFor(r);
    await assertTaskExecutionContext(target,q.task_id,{...q,contract_sha256:r.job.authority.contract_sha256});
    const factory=runtimeFactory??(await import('./workkeel-codex-host.mjs')).createLocalCodexSubscriptionRuntime;
    const runtime=await factory(target);
    return reported(await executeWorkflow(target,q,{adapters:[runtime],approvals:r.recovery?.approvals??r.request.approvals,reconciliations:r.recovery?.reconciliations??r.request.reconciliations,signal}),r);
  };
  return {idempotent:true,qualified:'native-workflow-checkpoints',discovery:true,
    async start(r,options={}){
      const old=await existing(r);if(old)return reported(old,r);
      return execute(r,options);
    },
    async resume(r,options={}){
      const old=await existing(r);if(!old)throw Error('Resume requires the existing exact workflow run');
      if(['completed','cancelled','rejected'].includes(old.status.state))return reported(old,r);
      // executeWorkflow enforces a diagnostic runner lock, unchanged policy/model
      // pins, operation journals and explicit reconciliation of uncertain dispatch.
      return execute(r,options);
    },
    async reconcile(r){
      const old=await existing(r);return old?reported(old,r):{status:'unknown',reason:'No run found; explicit recovery required before restarting inference'};
    },
    async cancel(r){
      const run=await existing(r);if(!run)return {status:'unknown',reason:'No canonical run; dispatch effects unknown'};
      if(['completed','cancelled','rejected'].includes(run.status.state)&&!await lockPresent(run.run_id))return convert(run);
      try{await cancelWorkflow(target,run.run_id,r.job.authority.actor);}catch(e){if(e.code!=='EEXIST')throw e;}
      const result=await convert(await readWorkflowRun(target,run.run_id));
      if(result.quiescent&&['awaiting-approval','paused','created'].includes(run.status.state)){
        // A paused graph has no owning process. The durable native cancel marker
        // blocks its next dispatch; every prior intent still needs a known result.
        const root='.ai-org/execution/'+run.run_id,ids=await readExecutionRecord(target,root+'/operations-index.json');
        if(Array.isArray(ids)&&ids.length<=1000){
          let settled=true;for(const id of ids){const op=await readExecutionRecord(target,root+'/operations/'+id+'.json');if(op.run_id!==run.run_id||!op.result)settled=false;}
          if(settled&&!await lockPresent(run.run_id))return {...result,status:'cancelled',reason:'Native cancel marker and settled journal confirm quiescence'};
        }
      }
      return result.status==='cancelled'&&result.quiescent?result:{...result,status:result.status==='completed'?'completed':'unknown',reason:'Cancellation requested; awaiting canonical quiescence'};
    }
  };
}
