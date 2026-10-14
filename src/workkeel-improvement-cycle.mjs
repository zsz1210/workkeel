import {readAutonomy,recordGoalDiscovery} from './workkeel-autonomy.mjs';
import {readNativeGoal,runNativeGoalStep,assertNativeGoalAuthority} from './workkeel-goals.mjs';
import {readGoalAdmissions,admitGoalImprovement,validateGoalAdmissionGrant} from './workkeel-autonomy-admission.mjs';
import {executionDigest} from './workkeel-execution-policy.mjs';
import {readTaskFile} from './task-contract.mjs';

const under=(p,r)=>r==='.'||p===r||p.startsWith(r+'/');
const idle=(reason,details={})=>({idle:reason,progressed:false,model_called:false,...details});
const exhausted=e=>/budget exhausted|cooldown|journal capacity|inventory exhausted/.test(e.message);

/** Events wake a deterministic controller; idle observations do not call a
 * model. Every inference is an operation of a sealed, independently reviewed
 * native goal, with reservations made before intake or dispatch. */
export async function runImprovementCycle(target,{adapter,signal}={}){
  const state=await readAutonomy(target),policy=state.policy;
  if(signal?.aborted)return idle('aborted');
  if(state.paused||!policy.enabled||!policy.admission?.enabled)return idle('improvement-disabled');
  const source=await readNativeGoal(target,policy.admission.goal_id),grant=validateGoalAdmissionGrant(source.manifest.admission);
  await assertNativeGoalAuthority(target,source,{actor:source.manifest.roles.approver,execution:true});
  if(!source.accepted&&!(source.state==='done'&&source.integration))return idle('source-goal-awaiting-acceptance');
  const journal=await readGoalAdmissions(target),entries=journal.entries.filter(e=>e.goal_id===source.id);
  const pending=entries.filter(e=>e.status==='created');
  let waiting=null;
  for(const entry of pending){
    const goal=await readNativeGoal(entry.intent.root,entry.intent.manifest.id);
    if(goal.accepted){if(entry.kind==='discovery')await recordGoalDiscovery(target,{goal_root:entry.intent.root,goal_id:goal.id});continue;}
    if(goal.state==='done'&&goal.integration)continue;
    if(['done','paused','cancelled','cancel-requested'].includes(goal.state)){waiting??=goal;continue;}
    const result=await runNativeGoalStep(entry.intent.root,goal.id,{adapter,signal});
    if(result.operation)return {...result,goal_id:goal.id,goal_root:entry.intent.root,progressed:result.operation.status==='completed'};
    waiting??=goal;
  }
  // An unresolved host or rejected issue remains visible and consumes its
  // reservation; it is not re-issued as a supposedly new task.
  if(waiting||entries.some(e=>e.status!=='created'))return idle('derived-goal-needs-attention',{goal_id:waiting?.id??null});
  const refreshed=await readAutonomy(target);
  const discoveredIds=new Set(entries.filter(e=>e.kind==='discovery').map(e=>e.intent.manifest.id));
  let manual=0;
  for(const proposal of refreshed.proposals.filter(p=>discoveredIds.has(p.origin_goal_id))){
    if(entries.some(e=>e.kind==='execution'&&e.proposal_id===proposal.id))continue;
    if(!['low','standard'].includes(proposal.risk_tier)||!policy.directions.includes(proposal.direction)){manual++;continue;}
    if(proposal.scope.read_paths.some(p=>!policy.discovery?.read_paths.some(r=>under(p,r)))||proposal.scope.write_paths.some(p=>!policy.discovery?.write_paths.some(r=>under(p,r)))){manual++;continue;}
    if(entries.length+state.jobs.length>=policy.max_jobs)return idle('project-job-budget');
    const bounded={...proposal,budget:{...proposal.budget,max_attempts:Math.min(proposal.budget.max_attempts,policy.max_attempts),max_runtime_ms:Math.min(proposal.budget.max_runtime_ms,policy.discovery.max_runtime_ms),max_cost_usd:policy.discovery.max_cost_usd===null?proposal.budget.max_cost_usd:proposal.budget.max_cost_usd===null?policy.discovery.max_cost_usd:Math.min(proposal.budget.max_cost_usd,policy.discovery.max_cost_usd)}};
    try{const result=await admitGoalImprovement(target,{goal_id:source.id,actor:source.manifest.roles.approver,operation_id:'auto-'+executionDigest({source:source.id,proposal:proposal.id}).slice(0,32),expected_version:(await readGoalAdmissions(target)).version,proposal_id:proposal.id},{proposal:bounded});return {...result,progressed:!result.replayed,model_called:false};}
    catch(e){if(exhausted(e))return idle('standing-budget-or-cooldown',{reason:e.message});manual++;}
  }
  if(!policy.discovery?.enabled)return idle('discovery-disabled',{manual_proposals:manual});
  const template=JSON.parse((await readTaskFile(target,grant.template_ref)).content),component=source.manifest.components.find(c=>c.id===template.source_component_id);
  const refs=grant.source_refs.filter(p=>policy.discovery.read_paths.some(r=>under(p,r)));
  let bytes=0;const pins=[];for(const ref of refs){const file=await readTaskFile(component.root,ref);bytes+=Buffer.byteLength(file.content);if(bytes>policy.discovery.max_source_bytes)return idle('discovery-source-capacity');pins.push({path:ref,sha256:file.bytes_digest});}
  if(!refs.length)return idle('no-approved-trigger-sources');
  for(const direction of policy.directions){
    const fingerprint=executionDigest({direction,source_refs:pins});
    if(entries.some(e=>e.kind==='discovery'&&e.problem_sha256===fingerprint))continue;
    if(entries.length+state.jobs.length>=policy.max_jobs)return idle('project-job-budget');
    const discoveries=entries.filter(e=>e.kind==='discovery');
    if(discoveries.length>=policy.discovery.max_rounds)return idle('discovery-round-budget');
    if(discoveries.at(-1)&&Date.now()-Date.parse(discoveries.at(-1).updated_at)<policy.discovery.cooldown_ms)return idle('discovery-cooldown');
    try{const result=await admitGoalImprovement(target,{goal_id:source.id,actor:source.manifest.roles.approver,operation_id:'event-'+fingerprint.slice(0,32),expected_version:(await readGoalAdmissions(target)).version},{trigger:{direction,source_refs:refs,read_paths:policy.discovery.read_paths,max_runtime_ms:policy.discovery.max_runtime_ms,max_cost_usd:policy.discovery.max_cost_usd}});return {...result,progressed:!result.replayed,model_called:false};}
    catch(e){if(exhausted(e))return idle('standing-budget-or-cooldown',{reason:e.message});throw e;}
  }
  return idle('unchanged-approved-sources',{manual_proposals:manual});
}
