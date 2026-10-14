import {readNativeTask,listTaskItems} from './workkeel-tasks.mjs';
import {readTaskContractInput,readTaskFile} from './task-contract.mjs';
import {readModelPolicy,saveModelPolicyDraft,approveModelPolicy,selectModelPolicy} from './workkeel-model-policy.mjs';
import {listNativeSkillLifecycle,mutateNativeSkillLifecycle} from './workkeel-learning-lifecycle.mjs';
import {readAutonomy,mutateAutonomy,cancelAutonomyJob} from './workkeel-autonomy.mjs';
import {previewRetention,applyRetentionArchive} from './workkeel-retention.mjs';

async function authority(project,actor,taskId){
  const items=taskId?[await readNativeTask(project.task_root,taskId)]:await Promise.all((await listTaskItems(project.task_root)).filter(t=>t.state==='build').map(t=>readNativeTask(project.task_root,t.id)));
  const available=items.filter(t=>t.state==='build'&&t.claim?.actor.agent_id===actor?.agent_id&&t.claim?.actor.principal_id===actor?.principal_id);
  if(available.length!==1)throw Error('Select one approved task assigned to this operator before changing project settings');
  const task=available[0];return {task,request:{task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256}};
}
/** UI passes intent, never claim ownership or invented model capability evidence. */
export function createWorkspaceHooks({host_models=[]}={}){
  const retentionPolicy={schema_version:'workkeel.retention-policy/v1',roots:['.ai-org/host-usage'],protected_paths:[],archive_root:'.ai-org/retention',limits:{max_files:256,max_bytes:8388608,max_file_bytes:1048576}};
  const defaults={model:{mode:'auto'},reasoning:{mode:'auto'},service:{mode:'auto'}};
  async function projectPolicy(project,actor){
    const store=await readModelPolicy(project.task_root,'project-routing');
    const models=[];if(actor){try{const {task}=await authority(project,actor);
      for(const ref of task.contract.environment.data.policy_refs){const file=await readTaskFile(project.task_root,ref);if(!task.authority_pins.some(p=>p.path===ref&&p.sha256===file.digest))throw Error('Pinned model source changed');if(!ref.endsWith('.json'))continue;const input={document:JSON.parse(file.content)};
        if(input.document.schema_version==='workkeel.dispatch-policy/v1')for(const m of input.document.models){const host=host_models.find(h=>h.provider===m.provider&&h.model===m.model);const effort=m.reasoning??'provider-default';models.push({id:m.alias,provider:m.provider,model:m.model,data_classes:m.data_classes,risk_tiers:['low','standard'],quality:0,reasoning_efforts:host?.reasoning_efforts??[effort],service_tiers:host?.service_tiers??['provider-default'],auto_efforts:{low:effort,standard:effort,high:effort},auto_service:host?.service_tiers?.[0]??'provider-default',cost:null,quota_remaining:null});}
      }
    }catch(e){return {store,policy:store.entries.at(-1)?.policy??null,catalog:[],setup_reason:e.message};}}
    const catalog=[...new Map(models.map(model=>[model.id,model])).values()];
    return {store,catalog,policy:store.entries.at(-1)?.policy??(catalog.length?{schema_version:'workkeel.model-policy/v1',id:'project-routing',version:1,project:defaults,rules:[],models:catalog}:null),setup_reason:catalog.length?null:'An approved task model allowlist is required'};
  }
  return {
    retention:{
      async read({project,actor}){
        try{const preview=await previewRetention(project.task_root,retentionPolicy);let version=0;try{version=(await authority(project,actor)).task.version;}catch{ /* Observation requires no claim. */ }
          return {version,stored_bytes:preview.inventory.bytes,archive_bytes:preview.plan.projected_archive_upper_bound_bytes,release_bytes:0,roots:preview.inventory.roots,preview_sha256:preview.sha256,preview:{sha256:preview.sha256,plan:preview.plan},warnings:['The archive is an additional verified copy and preserves every source.'],actions:[{action:'retention.archive',label:'Create a verified archive',payload:{preview_sha256:preview.sha256}}]};
        }catch(e){return {version:0,available:false,reason:e.code==='ENOENT'?'No execution measurements have been recorded yet':e.message,actions:[]};}
      },
      async execute({action,expectedVersion,idempotencyKey,payload,project,actor}){
        if(action!=='retention.archive')throw Error('Unsupported retention command');const {task,request}=await authority(project,actor,payload.task_id);if(task.version!==expectedVersion)throw Error('Retention task version changed');
        const preview=await previewRetention(project.task_root,retentionPolicy);if(preview.sha256!==payload.preview_sha256)throw Error('Capacity sources changed; request a fresh archive preview');
        return applyRetentionArchive(project.task_root,{...request,expected_task_version:task.version,preview,expected_preview_sha256:payload.preview_sha256,archive_id:idempotencyKey});
      }
    },
    policy:{
      async read({project,actor}){const {store,policy,catalog,setup_reason}=await projectPolicy(project,actor);return {version:store.version,policy:policy?.project??defaults,policy_document:policy,active_version:store.active_version,entries:store.entries,setup_reason,capabilities:{catalog:catalog??[],model:(catalog??[]).map(m=>m.id),reasoning:[...new Set(host_models.flatMap(h=>h.reasoning_efforts))],service:[...new Set(host_models.flatMap(h=>h.service_tiers))]}};},
      async execute({action,expectedVersion,payload,project,actor}){
        const {task,request}=await authority(project,actor,payload.task_id);
        if(action==='policy.draft'){
          const base=await projectPolicy(project,actor);if(!base.catalog?.length)throw Error(base.setup_reason);let policy=payload.policy;
          if(policy?.schema_version===undefined){if(!base.policy)throw Error(base.setup_reason);policy={...base.policy,version:base.store.entries.length+1,project:policy};}
          if(!Array.isArray(policy.models)||policy.models.some(model=>!base.catalog.some(allowed=>allowed.id===model.id&&allowed.provider===model.provider&&allowed.model===model.model)))throw Error('Draft models must come from the approved task allowlist');
          return saveModelPolicyDraft(project.task_root,{...request,expected_task_version:task.version,expected_version:expectedVersion,policy});
        }
        if(action==='policy.approve')return approveModelPolicy(project.task_root,{...request,expected_task_version:task.version,expected_version:expectedVersion,policy_id:payload.policy_id,policy_version:payload.policy_version,policy_sha256:payload.policy_sha256});
        if(action==='policy.preview'){
          const approved=[];
          for(const ref of task.contract.environment.data.policy_refs){const file=await readTaskFile(project.task_root,ref);if(!task.authority_pins.some(p=>p.path===ref&&p.sha256===file.digest))throw Error('Task policy source changed');if(!ref.endsWith('.json'))continue;const input={document:JSON.parse(file.content)};
            if(input.document.schema_version==='workkeel.dispatch-policy/v1')approved.push(...input.document.models.map(m=>m.alias));
          }
          if(!approved.length)throw Error('No pinned approved model allowlist is available for this task');
          return selectModelPolicy(payload.policy,{...payload.selectors,authority:{allowed_models:approved,data_class:task.contract.environment.data.classification,risk_tier:task.contract.verification.risk_tier,min_quality:0},host_models});
        }
        throw Error('Unsupported model policy command');
      }
    },
    learning:{
      async read({project}){const view=await listNativeSkillLifecycle(project.task_root);const actions=[];
        for(const item of view.items){
          const base={skill_id:item.skill_id,version:item.version,evidence:item.review?.request.evidence??item.candidate.request.evidence};
          if(item.reviewed&&!item.approval)actions.push({action:'learning.approve',label:'Approve '+item.skill_id+' '+item.version,payload:{...base,decision:'approve'}});
          if(item.reviewed&&item.approval?.request.decision==='approve'&&!item.active)actions.push({action:'learning.activate',label:'Use '+item.skill_id+' '+item.version,payload:base});
          if(item.active)actions.push({action:'learning.suspend',label:'Disable '+item.skill_id+' '+item.version,payload:{...base,decision:'Disabled by the workspace operator'}});
        }
        return {...view,version:view.version,entries:view.items.map(item=>({...item,id:item.skill_id,title:item.skill_id,status:item.active?'active':item.suspended?'suspended':item.approval?.request.decision==='approve'?'approved':item.reviewed?'reviewed':item.evaluation?'evaluated':'candidate',summary:item.candidate.request.trigger})),actions};},
      async execute({action,expectedVersion,idempotencyKey,payload,project,actor}){const {request}=await authority(project,actor,payload.task_id);const {task_id,...fields}=payload;return mutateNativeSkillLifecycle(project.task_root,action.replace(/^learning\./,''),{...fields,...request,operation_id:idempotencyKey,expected_version:expectedVersion});}
    },
    autonomy:{
      async read({project}){const s=await readAutonomy(project.task_root);return {...s,enabled:s.policy.enabled,state:s.paused?'paused':s.jobs.some(j=>j.status==='recovery-required')?'needs-reconciliation':s.jobs.some(j=>j.status==='running')?'execution-recorded':s.jobs.some(j=>j.status==='awaiting-acceptance')?'awaiting-acceptance':'idle',live_activity:'unconfirmed',limits:s.policy,next_action:s.last_event??'Await an approved event'};},
      async execute({action,expectedVersion,idempotencyKey,payload,project,actor}){const {request}=await authority(project,actor,payload.task_id);const {task_id,...fields}=payload;const input={...fields,...request,operation_id:idempotencyKey,expected_version:expectedVersion};
        if(action==='autonomy.cancel'){const {createAutonomyWorkflowAdapter}=await import('./workkeel-autonomy-workflow.mjs');return cancelAutonomyJob(project.task_root,input,{adapter:createAutonomyWorkflowAdapter(project.task_root)});}
        return mutateAutonomy(project.task_root,action.replace(/^autonomy\./,''),input);}
    }
  };
}
