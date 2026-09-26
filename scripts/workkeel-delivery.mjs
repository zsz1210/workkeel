import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readTaskSummary} from '../src/workkeel-task-summary.mjs';
import {readDispatchTicket, bindDispatchTicket} from '../src/workkeel-dispatch.mjs';
import {collectHostUsage, reportHostUsage, reportHostActivity, readHostMeasurements} from '../src/workkeel-host-usage.mjs';
import {exactKeys} from '../src/workkeel-execution-policy.mjs';

const TOKEN_KEYS=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
const REPORT_REQUIRED=['report_id','status','usage','tool','observed_at'];
const REPORT_OPTIONAL=['provider','model','reported_reasoning','sample_kind','execution_duration_ms','execution_intervals'];
const ACTIVITY_REQUIRED=['report_id','observed_at','execution_duration_ms','execution_intervals'];
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));

/** Compact projection only. Scope, criteria and warnings are never excerpted. */
export async function readDeliveryContext(target,taskId) {
  const summary=await readTaskSummary(target,taskId);
  const result=pick(summary,['authority','mutation_status','task_id','goal','scope','execution_scope','task_state','version',
    'next_action','needs_attention','attention_reasons','actor','acceptance_criteria','candidate_revision','quality','evidence','limitations']);
  for(const stage of ['delivery','review','closeout'])result[stage]=summary[stage]===null?null:
    pick(summary[stage],['revision','summary','implementer','actor','judgment','rollback','external_release']);
  return {schema_version:'workkeel.delivery-context/v1',...result,execution_authorized:false};
}

function receipt(measurement) {
  const op=measurement.operations[0]??null;
  const usage=Object.fromEntries(TOKEN_KEYS.map(k=>[k,op?.usage[k]??null]));
  const metrics={provider:op?.provider??null,model:op?.runtime_model??null,reported_reasoning:op?.reported_reasoning??null,
    active_duration_ms:measurement.timing.adapter_work_ms,turn_duration_ms:measurement.observations.reported_turn_duration_ms};
  return {schema_version:'workkeel.delivery-receipt/v1',authority:'observation-only',execution_authorized:false,
    task_id:measurement.task_id,execution_id:measurement.run_id,source_kind:measurement.source_kind,
    state:measurement.runner_state,operation_completed:op?.result_recorded??false,task_coverage_complete:false,
    coverage:measurement.coverage,task_acceptance:'not-performed',collection_closed:measurement.collection_closed,
    activity_kind:op?.activity_kind??null,requested_model:op?.requested_model??null,selection_match:op?.selection_match??'unknown',
    ...metrics,usage,missing_fields:[...Object.keys(metrics).filter(k=>metrics[k]===null),...TOKEN_KEYS.filter(k=>usage[k]===null).map(k=>`usage.${k}`)],
    source_status:measurement.observations.source_status,error_code:measurement.observations.error_code,
    reporter_trust:measurement.reporter_trust,limitations:[...measurement.limitations,
      'Active duration requires explicitly reported execution intervals; turn duration includes tools and is not active time.',
      'Usage and optional activity are cumulative observations, not task handoff, review or closeout.']};
}

/** Explicit source only; the existing binder validates source and dispatch identity. */
export async function attachDelivery(target,request) {
  return receipt(await bindDispatchTicket(target,request));
}

/** Stable caller report IDs and timestamps make unchanged retries idempotent. */
export async function finishDelivery(target,request) {
  exactKeys(request,['execution_id'],['report','collect','activity']);
  const reporting=Object.hasOwn(request,'report');
  if(reporting) {
    if(Object.hasOwn(request,'collect')||Object.hasOwn(request,'activity'))throw Error('Delivery: choose report or collect with optional activity');
    exactKeys(request.report,REPORT_REQUIRED,REPORT_OPTIONAL);
  } else {
    if(request.collect!==true)throw Error('Delivery: explicit collect:true required');
    if(Object.hasOwn(request,'activity'))exactKeys(request.activity,ACTIVITY_REQUIRED);
  }
  const ticket=await readDispatchTicket(target,request.execution_id);
  const identity={actor:ticket.actor,claim_id:ticket.claim_id,contract_sha256:ticket.contract_sha256};
  // Existing report/collector APIs own authority and historical stop boundaries.
  // A pre-bound operation may report after handoff without claiming new work.
  const inventory=await readHostMeasurements(target);
  const bound=inventory.byTask.get(ticket.task_id)?.find(m=>m.run_id===ticket.execution_id);
  if(!bound)throw Error('Delivery: verified host binding required');
  if(bound.source_kind!==(reporting?'host-report':'codex-rollout'))throw Error('Delivery: report/source mismatch');
  const base={binding_id:ticket.execution_id,...identity,activity_kind:ticket.node.activity_kind};
  if(reporting)return receipt(await reportHostUsage(target,{...request.report,...base}));
  // Validate and persist optional activity first: invalid activity must not
  // advance the source checkpoint. A later collection failure is explicit in
  // the receipt; these existing operations are not one atomic transaction.
  if(request.activity)await reportHostActivity(target,{...request.activity,...base});
  return receipt(await collectHostUsage(target,ticket.execution_id));
}

async function requestFile(file) {
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat(),limit=64*1024;
    if(!before.isFile()||before.size>limit)throw Error('bounded JSON request required');
    const buffer=Buffer.alloc(limit+1);let length=0;
    while(length<buffer.length) {
      const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);
      if(!bytesRead)break;length+=bytesRead;
    }
    const after=await handle.stat();
    if(length!==before.size||length>limit||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('request changed');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length)));
  } finally {await handle.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)try {
  const [command,target,input,...extra]=process.argv.slice(2);
  if(extra.length||!target||!input||!['context','attach','finish'].includes(command))throw Error('invalid command');
  const result=command==='context'?await readDeliveryContext(target,input):
    await ({attach:attachDelivery,finish:finishDelivery}[command])(target,await requestFile(input));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
} catch(error) {
  // Underlying filesystem exceptions can contain a private source path.
  const safeCode=typeof error?.code==='string'&&/^host-[a-z-]+$/.test(error.code)?` (${error.code})`:'';
  process.stderr.write(`Delivery request failed${safeCode}; inspect command, bounded request, current authority and exact binding.\n`);
  process.exitCode=1;
}
