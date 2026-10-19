import fs from 'node:fs/promises';
import path from 'node:path';
import {createMonitorFixture} from './workkeel-monitor-fixture.mjs';
import {createHash} from 'node:crypto';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {durableAtomicCreate,formatJson} from '../src/files.mjs';
export async function createObserverFixture(){
 const root=await createMonitorFixture({extended:true,rich:true});
 const files={
  '.agents/skills/custom-check/SKILL.md':'---\nname: custom-check\ndescription: A project-specific offline check.\n---\n# Custom check\n\nSearchable phrase: copper kestrel.\n<script>window.pwned=true</script>\n',
  '.agents/skills/external-check/SKILL.md':'---\nname: external-check\ndescription: A synthetic third-party example.\norigin: third-party\n---\n# External check\nSynthetic data only.\n',
  '.agents/skills/workkeel-work/SKILL.md':await fs.readFile(new URL('../.agents/skills/workkeel-work/SKILL.md',import.meta.url),'utf8')
 };
 files['docs/learning-evidence.md']='Synthetic observer fixture evidence.\n';
 for(const [ref,body] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,ref)),{recursive:true});await fs.writeFile(path.join(root,ref),body);}
 await writeNativeLearning(root);
 return root;
}

// Injects fixture learning events directly, not through production lifecycle
// writes: one candidate, one validated Lesson, one adopted Practice and one
// contradicted Lesson, with the same hash chain the native reader verifies.
async function writeNativeLearning(root){
 const evidence='docs/learning-evidence.md',pin={path:evidence,sha256:createHash('sha256').update(await fs.readFile(path.join(root,evidence))).digest('hex')};
 const context=n=>({task_id:'WK-accepted',actor:{agent_id:'builder',principal_id:'owner'},claim_id:'claim-fixture',contract_sha256:'0'.repeat(64),operation_id:'learning-'+n});
 const record=(id,kind,title,derived_from=[])=>({id,kind,title,summary:'Synthetic observer fixture; no learning or Skill activation.',applicability:'Observer fixture only.',exclusions:'Real projects.',aliases:[],derived_from,evidence:[evidence],skill_refs:[]});
 const review=(learning_id,result,adopt=false)=>({learning_id,result,decision:'Fixture review.',evidence:[evidence],adopt});
 const steps=[['capture',record('LESSON-0001','lesson','更新資料時保留文件閱讀位置')],['capture',record('LESSON-0002','lesson','接續任務先讀最新狀態摘要')],
  ['review',review('LESSON-0002','confirmed')],['capture',record('PRACTICE-0003','practice','審查前核對交付版本',['LESSON-0002'])],
  ['review',review('PRACTICE-0003','confirmed',true)],['capture',record('LESSON-0004','lesson','以固定欄數推算任務完成比例')],['review',review('LESSON-0004','contradicted')]];
 const dir=path.join(root,'.ai-org/learning/native');await fs.mkdir(dir,{recursive:true});
 let previous=null;
 for(const [index,[action,body]] of steps.entries()){
  const request={...context(index+1),...(action==='capture'?{record:body}:body)};
  const event={schema_version:'workkeel.learning-event/v1',sequence:index+1,previous_hash:previous,action,request,request_sha256:executionDigest(request),at:new Date(Date.now()-(steps.length-index)*60000).toISOString(),pins:[pin]};
  const envelope={event,sha256:executionDigest(event)};previous=envelope.sha256;
  await durableAtomicCreate(path.join(dir,String(index+1).padStart(6,'0')+'.json'),formatJson(envelope));
 }
}
