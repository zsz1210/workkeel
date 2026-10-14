import {exactKeys,executionDigest} from './workkeel-execution-policy.mjs';
import {searchNativeLearning} from './workkeel-learning.mjs';
import {listNativeSkillLifecycle} from './workkeel-learning-lifecycle.mjs';
import {readTaskFile} from './task-contract.mjs';

const under=(ref,root)=>root==='.'||ref===root||ref.startsWith(root+'/');
/** Bounded task-scoped guidance. Discovery records neither reading nor application. */
export async function selectLearningContext(target,contract,request){
  exactKeys(request,['query'],['limit']);if(typeof request.query!=='string'||!request.query.trim()||request.query.length>512)throw Error('A concrete learning topic is required');
  const limit=request.limit??5;if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw Error('Invalid learning context limit');
  const learning=await searchNativeLearning(target,{query:request.query,limit});const skills=await listNativeSkillLifecycle(target);
  const query=request.query.normalize('NFKC').toLowerCase();const terms=query.match(/[\p{L}\p{N}]+/gu)??[];const materials=[];
  for(const item of learning.items){
    const refs=item.current_pins??item.pins??[];
    for(const pin of refs)if(contract.environment.read_paths.some(root=>under(pin.path,root)))materials.push({path:pin.path,use:'reference',purpose:'validated-learning:'+item.id});
  }
  for(const item of skills.active){
    const body=JSON.stringify({trigger:item.candidate.request.trigger,title:item.skill_id}).normalize('NFKC').toLowerCase();
    if(!terms.some(t=>t.length>1&&body.includes(t))&&!contract.skills.includes(item.entrypoint?.path))continue;
    if(!item.entrypoint||!contract.environment.read_paths.some(root=>under(item.entrypoint.path,root)))continue;
    const file=await readTaskFile(target,item.entrypoint.path);if(file.bytes_digest!==item.entrypoint.sha256)throw Error('Active Skill source changed');
    // Referencing enables deliberate selection; it never modifies the task's mandatory Skills.
    materials.push({path:item.entrypoint.path,use:'reference',purpose:'active-project-skill:'+item.skill_id});
  }
  const selected=[...new Map(materials.map(m=>[m.path,m])).values()].slice(0,limit);
  return {schema_version:'workkeel.learning-context/v1',query:request.query,materials:selected,selection_sha256:executionDigest(selected),authority:'navigation-only',reading:'not-inferred',application:'not-inferred',model_called:false,limitations:['Deterministic discovery does not establish task applicability or output quality.','Only approved read roots are returned.']};
}
