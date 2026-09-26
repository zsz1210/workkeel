import {exactKeys} from './workkeel-execution-policy.mjs';
import {assertTaskExecutionContext} from './workkeel-tasks.mjs';
import {readTaskContractInput} from './task-contract.mjs';
import {prepareDispatchTicket,validateDispatchPolicy} from './workkeel-dispatch.mjs';

/** Adapt the existing local selector to a pinned project policy. No provider SDK,
 * proxy or classifier dependency is bundled. The caller supplies an approved
 * local classifier; it must not send the prompt to a model. */
export function classifierRoute(policy,result) {
  validateDispatchPolicy(policy);
  if(!result||result.model_called!==false||typeof result.model!=='string'||
    typeof result.classifier!=='string'||typeof result.selection_reason!=='string')throw Error('Invalid local classifier result');
  const matches=policy.models.filter(m=>m.model===result.model&&(result.provider===undefined||m.provider===result.provider));
  if(matches.length!==1)throw Error('Classifier model is missing or ambiguous in the approved policy');
  // Complexity scores are not confidence probabilities. Eligibility means the
  // local selector returned one approved, guarded model, not measured accuracy.
  return {classifier:{alias:matches[0].alias,eligible:true,name:result.classifier,
    tier:String(result.tier??'unreported'),selection_reason:result.selection_reason,model_called:false}};
}

export async function prepareClassifiedDispatch(target,request,classify) {
  exactKeys(request,['dispatch','prompt'],['profile']);
  if(typeof request.prompt!=='string'||!request.prompt.trim()||Buffer.byteLength(request.prompt)>16384)throw Error('Invalid bounded classifier prompt');
  if(!['auto','bounded-low-risk','review'].includes(request.profile??'auto')||typeof classify!=='function')throw Error('Invalid local classifier profile');
  if(request.dispatch.route?.alias||request.dispatch.route?.classifier)throw Error('Classified dispatch cannot also override the model');
  const task=await assertTaskExecutionContext(target,request.dispatch.task_id,request.dispatch);
  const ref=request.dispatch.policy_ref,input=await readTaskContractInput(target,ref);
  if(!task.contract.environment.data.policy_refs.includes(ref)||!task.authority_pins.some(p=>p.path===ref&&p.sha256===input.digest))throw Error('Classifier requires an unchanged approved dispatch policy');
  validateDispatchPolicy(input.document);
  const result=await classify(request.prompt,{profile:request.profile??'auto'});
  const route={...classifierRoute(input.document,result),...(request.dispatch.route?.risk?{risk:request.dispatch.route.risk}:{})};
  return prepareDispatchTicket(target,{...request.dispatch,route});
}
