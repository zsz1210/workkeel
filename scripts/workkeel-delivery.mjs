import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readTaskSummary} from '../src/workkeel-task-summary.mjs';
import {readNativeTask} from '../src/workkeel-tasks.mjs';
import {readTaskProject,assertActor} from '../src/workkeel-project.mjs';
import {readDispatchTicket, bindDispatchTicket} from '../src/workkeel-dispatch.mjs';
import {collectHostUsage, reportHostUsage, reportHostActivity, readHostMeasurements} from '../src/workkeel-host-usage.mjs';
import {exactKeys} from '../src/workkeel-execution-policy.mjs';
import {prepareDeliveryRequest,recordDeliveryCheck,deliveryOperationGuide} from './workkeel-delivery-request.mjs';
import {captureDeliveryCheck,assessDeliveryChecks} from './workkeel-check-evidence.mjs';

const TOKEN_KEYS=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
const REPORT_REQUIRED=['report_id','status','usage','tool','observed_at'];
const REPORT_OPTIONAL=['provider','model','reported_reasoning','sample_kind','execution_duration_ms','execution_intervals'];
const ACTIVITY_REQUIRED=['report_id','observed_at','execution_duration_ms','execution_intervals'];
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
const KINDS=['planning','implementation','review','repair','verification'];
const REQUIRED_METRICS=['active_duration_ms','usage.input_tokens','usage.output_tokens'];
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

function collectionProgress(rows,errors) {
  const counts={completed:0,pending:0,stopped:0,unavailable:0,missing:0},followUp=[];
  for(const row of rows) {
    const state=row.collection_status;
    counts[state]++;
    const actions=[];
    if(state==='missing')actions.push('resolve-missing-binding');
    if(state==='unavailable')actions.push('inspect-binding-or-source');
    if(state==='pending')actions.push('collect-after-operation-ends');
    if(state==='stopped')actions.push('record-collection-limitation');
    if(state==='completed'&&!row.receipt.operation_completed)actions.push('preserve-unsuccessful-outcome');
    if(row.issues.some(issue=>issue.startsWith('missing:')))actions.push('report-known-metrics-or-record-gap');
    if(row.receipt?.cutoffs.usage_observed_after_activity===true)actions.push('keep-usage-and-activity-cutoffs-separate');
    if(actions.length)followUp.push({label:row.label,binding:row.binding,actions});
  }
  const status=errors.length||counts.unavailable||counts.missing?'unavailable':counts.pending?'pending':counts.stopped?'stopped':'completed';
  return {status,counts,follow_up:followUp};
}

/** Inspect an explicit expected set. Never discover sessions or collect sources. */
export async function checkDeliveryReports(target,request) {
  exactKeys(request,['task_id','expected']);
  if(!Array.isArray(request.expected)||!request.expected.length||request.expected.length>64)throw Error('Delivery: expected operations required (1-64)');
  const labels=new Set(),bindings=new Set();
  for(const entry of request.expected) {
    exactKeys(entry,['label','activity_kind','binding']);
    if(typeof entry.label!=='string'||!ID.test(entry.label)||labels.has(entry.label)||!KINDS.includes(entry.activity_kind))throw Error('Delivery: invalid or duplicate expected operation');
    labels.add(entry.label);
    if(entry.binding!==null) {
      exactKeys(entry.binding,['kind','id']);
      if(!['dispatch','host'].includes(entry.binding.kind)||typeof entry.binding.id!=='string'||!ID.test(entry.binding.id)||bindings.has(entry.binding.id))throw Error('Delivery: invalid or duplicate expected binding');
      bindings.add(entry.binding.id);
    }
  }
  const summary=await readTaskSummary(target,request.task_id),inventory=await readHostMeasurements(target);
  const measurements=inventory.byTask.get(summary.task_id)??[],rows=[];
  for(const entry of request.expected) {
    const row={...entry,status:'missing-binding',issues:[],receipt:null};
    let ticket=null;
    if(entry.binding?.kind==='dispatch') {
      try {
        ticket=await readDispatchTicket(target,entry.binding.id);
        if(ticket.task_id!==summary.task_id||ticket.node.activity_kind!==entry.activity_kind)throw Error('binding mismatch');
      } catch {row.issues.push('dispatch-unavailable-or-mismatched');}
    }
    const bound=entry.binding&&measurements.find(m=>m.run_id===entry.binding.id);
    if(!bound)row.issues.push('binding-missing-or-unavailable');
    else {
      row.receipt=receipt(bound);
      if(entry.binding.kind==='dispatch'&&bound.dispatch_execution_id!==entry.binding.id)row.issues.push('dispatch-binding-mismatch');
      if(entry.binding.kind==='host'&&bound.dispatch_execution_id!==null)row.issues.push('binding-kind-mismatch');
      // Before a report, a non-dispatch binding has no observed activity kind.
      const kind=bound.operations[0]?.activity_kind??ticket?.node.activity_kind??null;
      if(kind!==entry.activity_kind)row.issues.push(kind===null?'activity-unreported':'activity-mismatch');
      if(!row.receipt.operation_completed)row.issues.push('operation-not-completed');
      if(!['observed','reporter-observed'].includes(row.receipt.source_status)||row.receipt.error_code)row.issues.push('source-incomplete-or-unavailable');
      for(const field of REQUIRED_METRICS)if(row.receipt.missing_fields.includes(field))row.issues.push(`missing:${field}`);
      row.status=row.issues.length?'incomplete':'reported';
    }
    if(row.issues.some(issue=>['dispatch-unavailable-or-mismatched','dispatch-binding-mismatch','binding-kind-mismatch'].includes(issue)))row.status='unavailable';
    row.collection_status=row.status==='unavailable'||row.issues.includes('activity-mismatch')?'unavailable':row.receipt?.collection_status??'missing';
    rows.push(row);
  }
  const errors=inventory.errors.filter(e=>e.task_id===summary.task_id||e.task_id===null);
  const unlisted=measurements.filter(m=>!bindings.has(m.run_id)).length;
  return {schema_version:'workkeel.delivery-report-check/v1',authority:'observation-only',mutation_status:'no-write',execution_authorized:false,
    task_id:summary.task_id,task_version:summary.version,task_state:summary.task_state,task_locally_accepted:summary.task_state==='done',
    collection:collectionProgress(rows,errors),coverage:'declared-operations-only',task_coverage_complete:false,
    bindings_ready:errors.length===0&&rows.every(r=>r.receipt&&r.status!=='unavailable'&&!r.issues.includes('activity-mismatch')),
    declared_reports_complete:errors.length===0&&rows.every(r=>r.status==='reported'),unlisted_binding_count:unlisted,
    required_metrics:REQUIRED_METRICS,expected_operations:rows,inventory_errors:errors,
    activity_coverage:Object.fromEntries(KINDS.map(kind=>{const entries=rows.filter(r=>r.activity_kind===kind);return [kind,{declared:entries.length,reported:entries.filter(r=>r.status==='reported').length,status:!entries.length?'not-declared':entries.every(r=>r.status==='reported')?'reported':'incomplete'}];})),
    limitations:['The expected list is caller-declared; omitted coordinator, repair or other work is not proven absent.',
      'Reported coverage is limited to these bindings. Missing time or tokens remain unknown; zero is a measured value.',
      'Task acceptance, terminal source collection and metric completeness are separate observations. Completed collection does not prove successful execution or complete task coverage.',
      'No source was collected and no lifecycle action was performed. Recheck the same bindings after final reports; preserve earlier evidence snapshots.']};
}

/** One packet for the actual reviewer to inspect and record in the same turn. */
export async function readDeliveryReview(target,request) {
  exactKeys(request,['task_id','execution_id','reviewer']);
  const task=await readNativeTask(target,request.task_id),project=await readTaskProject(target);
  assertActor(project.policy,request.reviewer);
  if(task.state!=='test'||task.review||!task.delivery)throw Error('Delivery: candidate is not awaiting review');
  const implementer=task.delivery.implementer;
  if(request.reviewer.agent_id===implementer.agent_id||task.contract.verification.separation==='distinct-principal'&&request.reviewer.principal_id===implementer.principal_id)throw Error('Delivery: reviewer separation required');
  const ticket=await readDispatchTicket(target,request.execution_id);
  if(ticket.task_id!==task.id||ticket.claim_id!==task.delivery.claim_id||ticket.node.activity_kind!=='review')throw Error('Delivery: exact review ticket required');
  const inventory=await readHostMeasurements(target);
  if(!inventory.byTask.get(task.id)?.some(m=>m.run_id===ticket.execution_id&&m.dispatch_execution_id===ticket.execution_id))throw Error('Delivery: pre-bound review operation required');
  const context=await readDeliveryContext(target,task.id);
  const blocking=context.attention_reasons.filter(r=>r!=='awaiting-review');
  if(inventory.errors.some(e=>e.run_id===ticket.execution_id||e.run_id===null))blocking.push('review-source-unavailable');
  const diff=await promisify(execFile)('git',['-C',target,'diff','--no-renames','--name-only','-z',task.base_revision,task.delivery.revision,'--'],{maxBuffer:512*1024,timeout:5000});
  return {schema_version:'workkeel.delivery-review/v1',authority:'observation-only',mutation_status:'no-write',execution_authorized:false,
    task_id:task.id,execution_id:ticket.execution_id,ready_for_review:blocking.length===0,blocking_reasons:blocking,
    candidate_revision:task.delivery.revision,changed_paths:diff.stdout.split('\0').filter(Boolean),context,
    review_request_template:{operation_id:null,expected_version:task.version,actor:request.reviewer,revision:task.delivery.revision,judgment:null,summary:null,evidence:[]},
    steps:['Inspect the exact candidate, approval, acceptance and evidence; run only relevant independent checks.',
      'Write your own pass/fail judgment and evidence, then record task review in this same turn using the current version.',
      'Finish the pre-bound execution report before local acceptance; do not claim or accept the task as reviewer.'],
    limitations:['This packet does not verify the candidate or prove that an actual independent Agent performed review.',
      'Native task review rechecks candidate drift, evidence, dependencies, authority and identity when recording judgment.']};
}

/** Compact projection only. Scope, criteria and warnings are never excerpted. */
export async function readDeliveryContext(target,taskId) {
  const summary=await readTaskSummary(target,taskId);
  const result=pick(summary,['authority','mutation_status','task_id','goal','scope','execution_scope','task_state','version',
    'next_action','needs_attention','attention_reasons','actor','acceptance_criteria','candidate_revision','quality','evidence','limitations']);
  for(const stage of ['delivery','review','closeout'])result[stage]=summary[stage]===null?null:
    pick(summary[stage],['revision','summary','implementer','actor','judgment','rollback','external_release']);
  return {schema_version:'workkeel.delivery-context/v1',...result,execution_authorized:false};
}

export async function readDeliveryGuide(target,taskId) {
  const context=await readDeliveryContext(target,taskId);
  return {schema_version:'workkeel.delivery-guide/v1',authority:'observation-only',mutation_status:'no-write',execution_authorized:false,
    context,operation:deliveryOperationGuide(context.task_state,context.review)};
}

function receipt(measurement) {
  const op=measurement.operations[0]??null;
  const usage=Object.fromEntries(TOKEN_KEYS.map(k=>[k,op?.usage[k]??null]));
  const metrics={provider:op?.provider??null,model:op?.runtime_model??null,reported_reasoning:op?.reported_reasoning??null,
    active_duration_ms:measurement.timing.adapter_work_ms,turn_duration_ms:measurement.observations.reported_turn_duration_ms};
  const intervals=op?.execution_intervals??[];
  const activityEnded=intervals.reduce((last,interval)=>last===null||Date.parse(interval.completed_at)>Date.parse(last)?interval.completed_at:last,null);
  const usageObserved=TOKEN_KEYS.some(k=>usage[k]!==null)?measurement.last_observed_at:null;
  const sourceUnavailable=Boolean(measurement.observations.error_code)||['unavailable','partial-source'].includes(measurement.observations.source_status);
  const sourceObserved=['observed','reporter-observed'].includes(measurement.observations.source_status);
  const collectionStatus=sourceUnavailable?'unavailable':measurement.collection_closed?'stopped':
    sourceObserved&&['completed','interrupted','cancelled'].includes(measurement.runner_state)?'completed':'pending';
  return {schema_version:'workkeel.delivery-receipt/v1',authority:'observation-only',execution_authorized:false,
    task_id:measurement.task_id,execution_id:measurement.run_id,dispatch_execution_id:measurement.dispatch_execution_id,source_kind:measurement.source_kind,
    state:measurement.runner_state,operation_completed:op?.result_recorded??false,task_coverage_complete:false,
    coverage:measurement.coverage,usage_scope:measurement.usage_scope??null,task_acceptance:'not-performed',collection_closed:measurement.collection_closed,collection_status:collectionStatus,
    cutoffs:{usage_observed_at:usageObserved,activity_ended_at:activityEnded,collected_at:measurement.observations.last_collected_at,
      usage_observed_after_activity:usageObserved===null||activityEnded===null?null:Date.parse(usageObserved)>Date.parse(activityEnded)},
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
  if(!bound||bound.dispatch_execution_id!==ticket.execution_id)throw Error('Delivery: verified dispatch host binding required');
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

async function stdinRequest() {
  const chunks=[];let length=0;
  for await(const chunk of process.stdin) {
    length+=chunk.length;
    if(length>64*1024)throw Error('bounded JSON request required');
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)try {
  const [command,target,input,...extra]=process.argv.slice(2);
  if(extra.length||!target||!input||!['context','guide','prepare','record-check','capture-check','assess-checks','attach','finish','check','review'].includes(command))throw Error('invalid command');
  const result=['context','guide'].includes(command)?await ({context:readDeliveryContext,guide:readDeliveryGuide}[command])(target,input):
    await ({prepare:prepareDeliveryRequest,'record-check':recordDeliveryCheck,'capture-check':captureDeliveryCheck,'assess-checks':assessDeliveryChecks,attach:attachDelivery,finish:finishDelivery,check:checkDeliveryReports,review:readDeliveryReview}[command])(target,['record-check','capture-check','assess-checks'].includes(command)&&input==='-'?await stdinRequest():await requestFile(input));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(command==='record-check'&&result.status!=='pass')process.exitCode=1;
  if(command==='capture-check'&&result.status!=='pass')process.exitCode=1;
} catch(error) {
  // Underlying filesystem exceptions can contain a private source path.
  const safeCode=typeof error?.code==='string'&&/^host-[a-z-]+$/.test(error.code)?` (${error.code})`:'';
  process.stderr.write(`Delivery request failed${safeCode}; inspect command, bounded request, current authority and exact binding.\n`);
  process.exitCode=1;
}
