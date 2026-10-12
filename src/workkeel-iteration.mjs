import {exactKeys} from './workkeel-execution-policy.mjs';

const text=(v,n=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const count=v=>v===null||Number.isSafeInteger(v)&&v>=0;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(v);
const ref=v=>text(v,500);
export const PROGRESS_STAGES=['produced','functionally_verified','quality_accepted'];
export const ITERATION_METRICS=['ai_active_ms','input_tokens','output_tokens','generated_bytes','retained_bytes'];

/** Optional attributed evidence. These records never grant lifecycle acceptance. */
export function validateDeliveryProgress(p,value) {
  exactKeys(p,['total',...PROGRESS_STAGES,'quality_authority']);
  if(!Number.isSafeInteger(p.total)||p.total<1||p.total>10000||value.candidate_revision===null)throw Error('Progress requires a bounded total and exact revision');
  for(const key of PROGRESS_STAGES){const s=p[key];exactKeys(s,['count','evidence_ref']);
    if(!count(s.count)||s.count>p.total||!(s.evidence_ref===null||ref(s.evidence_ref))||s.count!==null&&s.evidence_ref===null)throw Error('Measured progress requires evidence, including measured zero');}
  if(!(p.quality_authority===null||text(p.quality_authority,160))||p.quality_accepted.count>0&&p.quality_authority===null)throw Error('Quality acceptance requires named authority');
  const [a,b,c]=PROGRESS_STAGES.map(k=>p[k].count);
  if(a!==null&&b!==null&&b>a||b!==null&&c!==null&&c>b||a!==null&&c!==null&&c>a)throw Error('Progress counts contradict stage coverage');
}
export function validateIteration(i,value) {
  exactKeys(i,['id','issue_id','hypothesis','change','conditions_sha256','baseline_ref','result_ref','resolution','failure_kind','metrics']);
  if(!id(i.id)||!id(i.issue_id)||!text(i.hypothesis)||!text(i.change)||!/^[a-f0-9]{64}$/.test(i.conditions_sha256)||!ref(i.baseline_ref)||!ref(i.result_ref)||value.candidate_revision===null)throw Error('Iteration requires exact candidate, issue and comparable evidence');
  if(!['unresolved','improved','resolved'].includes(i.resolution)||!['product','environment','none','unknown'].includes(i.failure_kind))throw Error('Invalid iteration outcome');
  exactKeys(i.metrics,ITERATION_METRICS);
  if(ITERATION_METRICS.some(k=>!count(i.metrics[k])))throw Error('Invalid iteration measurement');
}
export function iterationEvidence(value) {
  return [...(value.delivery_progress?PROGRESS_STAGES.map(k=>value.delivery_progress[k].evidence_ref).filter(Boolean):[]),
    ...(value.iteration?[value.iteration.baseline_ref,value.iteration.result_ref]:[])];
}
export function summarizeIterations(observed,candidate) {
  const records=observed.records??[],progressRecord=records.find(v=>v.delivery_progress),events=records.filter(v=>v.iteration).map(v=>({...v.iteration,candidate_revision:v.candidate_revision,observed_at:v.observed_at,actor:v.actor,sample_kind:v.sample_kind,comparison_group:v.comparison_group}));
  const group=records.find(v=>v.sample_kind==='real-task'&&v.comparison_group&&(v.iteration||v.delivery_progress))?.comparison_group??null;
  const actual=events.filter(v=>v.sample_kind==='real-task'&&group!==null&&v.comparison_group===group).toReversed().slice(0,3);
  return {
    status:observed.status==='unavailable'?'unavailable':progressRecord||events.length?'recorded':'unobserved',
    authority:'attributed-observation-only',acceptance_granted:false,
    progress:progressRecord?{...progressRecord.delivery_progress,...Object.fromEntries(PROGRESS_STAGES.map(k=>{const s=progressRecord.delivery_progress[k];return [k,{...s,evidence_sha256:observed.pins?.find(p=>p.path===s.evidence_ref)?.sha256??null,evidence_status:s.evidence_ref?'verified':'unreported'}];})),candidate_revision:progressRecord.candidate_revision,observed_at:progressRecord.observed_at,actor:progressRecord.actor,
      revision_status:candidate===null?'not-delivered':candidate===progressRecord.candidate_revision?'candidate-matched':'stale'}:null,
    iterations:events,recorded_rounds:events.length||null,
    environment_reruns:events.length?events.filter(v=>v.failure_kind==='environment').length:null,
    three_iteration_window:{comparison_group:group,target:3,recorded:Math.min(3,actual.length),pending:Math.max(0,3-actual.length),complete:actual.length>=3,
      metric_coverage:Object.fromEntries(ITERATION_METRICS.map(k=>[k,{known:actual.slice(0,3).filter(v=>v.metrics[k]!==null).length,total:Math.min(3,actual.length)}]))}
  };
}

/** An identical unresolved approach twice must change before another long run. */
export function repeatedRepair(events,next) {
  const previous=events.filter(v=>v.issue_id===next.issue_id).slice(0,2);
  return previous.length===2&&previous.every(v=>v.resolution==='unresolved'&&v.hypothesis===next.hypothesis&&v.change===next.change);
}
