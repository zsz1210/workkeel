import fs from 'node:fs/promises';
import path from 'node:path';
import {createMonitorFixture} from './workkeel-monitor-fixture.mjs';
import {emptyLearningIndex} from '../src/learning.mjs';
export async function createObserverFixture(){
 const root=await createMonitorFixture({extended:true,rich:true});
 const files={
  '.agents/skills/custom-check/SKILL.md':'---\nname: custom-check\ndescription: A project-specific offline check.\n---\n# Custom check\n\nSearchable phrase: copper kestrel.\n<script>window.pwned=true</script>\n',
  '.agents/skills/external-check/SKILL.md':'---\nname: external-check\ndescription: A synthetic third-party example.\norigin: third-party\n---\n# External check\nSynthetic data only.\n',
  '.agents/skills/temple-work/SKILL.md':await fs.readFile(new URL('../project-overlay/.agents/skills/temple-work/SKILL.md',import.meta.url),'utf8')
 };
 const index=emptyLearningIndex();
 for(const [kind,status] of [['lesson','candidate'],['lesson','validated'],['practice','active'],['lesson','deprecated']]){
  const id=(kind==='practice'?'PRACTICE':'LESSON')+'-'+String(index.entries.length+1).padStart(4,'0');
  const ref='.ai-org/learning/'+(kind==='practice'?'practices':'lessons')+'/'+id+'.md',now=new Date().toISOString();
  index.entries.push({id,kind,title:{candidate:'更新資料時保留文件閱讀位置',validated:'接續任務先讀最新狀態摘要',active:'審查前核對交付版本',deprecated:'以固定欄數推算任務完成比例'}[status],summary:'Synthetic observer fixture; no learning or Skill activation performed.',status,confidence:'medium',tags:['observer'],applies_to:['observer'],source_work_items:[],path:ref,updated_at:now,last_validated_at:status==='candidate'?null:now,promotion:{target:kind==='practice'?'skill':'none',status:'none',reference:null},derived_from:[],owner_position:null,revalidation:{last_result:null,review_after:null,evidence_refs:[],history:[]}});
  files[ref]='# '+id+'\n\nOffline synthetic learning record.\n';
 }
 files['.ai-org/learning/index.json']=JSON.stringify(index,null,2)+'\n';
 for(const [ref,body] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,ref)),{recursive:true});await fs.writeFile(path.join(root,ref),body);}
 return root;
}
