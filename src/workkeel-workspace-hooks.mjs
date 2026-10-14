import {readNativeTask,listTaskItems} from './workkeel-tasks.mjs';
import {readTaskContractInput,readTaskFile} from './task-contract.mjs';
import {readModelPolicy,saveModelPolicyDraft,approveModelPolicy,selectModelPolicy} from './workkeel-model-policy.mjs';
import {listNativeSkillLifecycle,mutateNativeSkillLifecycle} from './workkeel-learning-lifecycle.mjs';
import {readAutonomy,mutateAutonomy,cancelAutonomyJob,serveAutonomy} from './workkeel-autonomy.mjs';
import {listNativeGoals,readNativeGoal,createNativeGoal,validateGoalManifest,controlNativeGoal,assertNativeGoalAuthority,serveNativeGoal,runNativeGoalStep} from './workkeel-goals.mjs';
import {readGoalAdmissions} from './workkeel-autonomy-admission.mjs';
import {previewRetention,applyRetentionArchive,inventoryRetention} from './workkeel-retention.mjs';
import {safeDirectory} from './workkeel-project.mjs';

async function authority(project,actor,taskId){
  const items=taskId?[await readNativeTask(project.task_root,taskId)]:await Promise.all((await listTaskItems(project.task_root)).filter(t=>t.state==='build').map(t=>readNativeTask(project.task_root,t.id)));
  const available=items.filter(t=>t.state==='build'&&t.claim?.actor.agent_id===actor?.agent_id&&t.claim?.actor.principal_id===actor?.principal_id);
  if(available.length!==1)throw Error('Select one approved task assigned to this operator before changing project settings');
  const task=available[0];return {task,request:{task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256}};
}
function selectedGoalProject(project,repoId){
  if(repoId===undefined||repoId===null)return project;
  const repo=project.repositories?.find(r=>r.id===repoId);if(!repo)throw Error('Select an explicitly registered goal repository');
  return {...project,task_root:repo.path};
}
/** UI passes intent, never claim ownership or invented model capability evidence. */
export function createWorkspaceHooks({host_models=[],goalAdapter}={}){
  const goalServices=new Map(),improvementServices=new Map();
  const closeServices=services=>{for(const item of services.values()){item.controller.abort();item.service.close();}services.clear();};
  const retentionPolicy={schema_version:'workkeel.retention-policy/v1',roots:['.ai-org/host-usage'],protected_paths:[],archive_root:'.ai-org/retention',limits:{max_files:256,max_bytes:8388608,max_file_bytes:1048576}};
  const defaults={model:{mode:'auto'},reasoning:{mode:'auto'},service:{mode:'auto'}};
  async function protectedCapacity(project){
    const roots=[];try{
      for(const ref of ['.ai-org/goals','.ai-org/autonomy','.ai-org/work-items','.ai-org/artifacts','.ai-org/learning','.ai-org/skill-lifecycle'])try{await safeDirectory(project.task_root,ref);roots.push(ref);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(!roots.length)return {available:true,bytes:0,files:0,roots:[],scope:'configured-canonical-evidence-roots',release_bytes:0};
      const view=await inventoryRetention(project.task_root,{...retentionPolicy,roots,protected_paths:roots,limits:{max_files:1024,max_bytes:16777216,max_file_bytes:1048576}});
      return {available:true,bytes:view.bytes,files:view.file_count,roots:view.roots,scope:'configured-canonical-evidence-roots',release_bytes:0};
    }catch(e){return {available:false,bytes:null,files:null,roots:roots.map(path=>({path})),reason:e.message,scope:'configured-canonical-evidence-roots',release_bytes:0};}
  }
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
    goals:{
      async read({project,actor}){const entries=[],candidates=[],unavailable_roots=[];
        const roots=new Map([[project.task_root,project.repositories?.find(r=>r.path===project.task_root)?.id??null]]);for(const repo of project.repositories??[])if(!roots.has(repo.path))roots.set(repo.path,repo.id);
        for(const [root,repo_id]of roots){
          let goals;try{goals=await listNativeGoals(root);}catch(e){unavailable_roots.push({repo_id,reason:e.message});continue;}
          entries.push(...goals.map(g=>({id:g.id,root,repo_id,title:g.manifest?.title??g.id,version:g.version,state:g.state,accepted:g.accepted,authority_status:g.authority_status})));
          if(!actor)continue;
          let items;try{items=await listTaskItems(root);}catch(e){if(e.code==='ENOENT')continue;unavailable_roots.push({repo_id,reason:e.message});continue;}
          for(const item of items.filter(t=>t.state==='build').slice(0,64)){
            const task=await readNativeTask(root,item.id);if(task.claim?.actor.agent_id!==actor.agent_id||task.claim?.actor.principal_id!==actor.principal_id)continue;
            for(const pin of task.authority_pins.filter(p=>p.path.endsWith('.json')).slice(0,32))try{const file=await readTaskFile(root,pin.path);if(file.digest!==pin.sha256)continue;const manifest=JSON.parse(file.content);if(manifest.schema_version!=='workkeel.goal/v1')continue;validateGoalManifest(manifest);if(manifest.roles.approver.agent_id!==actor.agent_id||manifest.roles.approver.principal_id!==actor.principal_id)continue;if(!goals.some(g=>g.id===manifest.id))candidates.push({task_id:task.id,manifest_ref:pin.path,title:manifest.title,goal_id:manifest.id,repo_id,version:task.version,component_count:manifest.components.length,repository_count:new Set(manifest.components.map(c=>c.root)).size});}catch{/* Ineligible source is not a registration choice. */}
          }
        }
        if(entries.length>200||candidates.length>128)throw Error('Workspace goal control inventory exceeds its bound');
        return {entries,candidates,unavailable_roots,version:0,services:entries.map(g=>({goal_id:g.id,root:g.root,repo_id:g.repo_id,state:goalServices.has(g.root+':'+g.id)?'running-in-this-host':'not-confirmed-in-this-host',errors:goalServices.get(g.root+':'+g.id)?.errors??[]}))};},
      async execute({action,expectedVersion,idempotencyKey,payload,project,actor}){
        project=selectedGoalProject(project,payload.repo_id);
        if(action==='goals.create'){
          const {task,request}=await authority(project,actor,payload.task_id);if(task.version!==expectedVersion)throw Error('Approved goal source task changed');
          return createNativeGoal(project.task_root,{...request,operation_id:idempotencyKey,expected_version:0,manifest_ref:payload.manifest_ref});
        }
        const goal=await readNativeGoal(project.task_root,payload.goal_id),key=project.task_root+':'+goal.id;
        if(goal.version!==expectedVersion)throw Error('Goal version changed; reload before controlling execution');
        await assertNativeGoalAuthority(project.task_root,goal,{actor,execution:!['goals.pause','goals.cancel'].includes(action)});
        if(action==='goals.start'){
          if(goalServices.has(key))return {goal_id:goal.id,state:'running-in-this-host',model_called:false};
          if(goal.state!=='running')throw Error('Resume this goal before starting its background service');
          const controller=new AbortController(),errors=[];
          const service=await serveNativeGoal(project.task_root,goal.id,{adapter:goalAdapter,signal:controller.signal,onError:e=>{errors.push(e.message);if(errors.length>10)errors.shift();}});
          goalServices.set(key,{controller,service,errors});return {goal_id:goal.id,state:'listening',model_called:false};
        }
        const result=await controlNativeGoal(project.task_root,goal.id,action.replace(/^goals\./,''),{actor,expected_version:expectedVersion,operation_id:idempotencyKey});
        if(action==='goals.cancel'){
          // Interrupt the exact recorded model turn now, even if this host's
          // regular scheduler is awaiting that turn's completion.
          await runNativeGoalStep(project.task_root,goal.id,{adapter:goalAdapter});
          if(!goalServices.has(key)){const controller=new AbortController(),errors=[],service=await serveNativeGoal(project.task_root,goal.id,{adapter:goalAdapter,signal:controller.signal,onError:e=>errors.push(e.message)});goalServices.set(key,{controller,service,errors});}
        }
        goalServices.get(key)?.service.trigger();return result;
      },
      close:()=>closeServices(goalServices)
    },
    retention:{
      async read({project,actor}){
        const protected_evidence=await protectedCapacity(project);
        try{const preview=await previewRetention(project.task_root,retentionPolicy);let version=0;try{version=(await authority(project,actor)).task.version;}catch{ /* Observation requires no claim. */ }
          return {version,protected_evidence,stored_scope:'host-measurements-only',stored_bytes:preview.inventory.bytes,archive_bytes:preview.plan.projected_archive_upper_bound_bytes,release_bytes:0,roots:preview.inventory.roots,preview_sha256:preview.sha256,preview:{sha256:preview.sha256,plan:preview.plan},warnings:['The archive is an additional verified copy and preserves every source.'],actions:[{action:'retention.archive',label:'Create a verified archive',payload:{preview_sha256:preview.sha256}}]};
        }catch(e){return {version:0,available:protected_evidence.available,protected_evidence,stored_scope:'host-measurements-only',stored_bytes:null,archive_bytes:null,release_bytes:0,reason:e.code==='ENOENT'?'No execution measurements have been recorded yet':e.message,actions:[]};}
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
      async read({project,actor}){const s=await readAutonomy(project.task_root),admissions=await readGoalAdmissions(project.task_root),goals=await listNativeGoals(project.task_root),item=improvementServices.get(project.task_root);const available_goals=[];
        for(const goal of goals)if(goal.manifest?.admission&&goal.controller?.actor.agent_id===actor?.agent_id&&goal.controller?.actor.principal_id===actor?.principal_id){let current=true;try{await assertNativeGoalAuthority(project.task_root,goal,{actor,execution:true});}catch{current=false;}available_goals.push({id:goal.id,title:goal.manifest.title,accepted:goal.accepted,historically_accepted:goal.state==='done'&&!!goal.integration,authority_current:current,grant:goal.manifest.admission});}
        return {...s,admissions:admissions.entries.map(e=>({id:e.id,goal_id:e.intent.manifest.id,root:e.intent.root,kind:e.kind,status:e.status,proposal_id:e.proposal_id,reservation:e.reservation,error:e.error})),available_goals,service:{state:item?'running-in-this-host':'not-confirmed-in-this-host',errors:item?.errors??[],last_step:item?.last_step??null},enabled:s.policy.enabled,state:s.paused?'paused':s.jobs.some(j=>j.status==='recovery-required')?'needs-reconciliation':s.jobs.some(j=>j.status==='running')?'execution-recorded':s.jobs.some(j=>j.status==='awaiting-acceptance')?'awaiting-acceptance':'idle',live_activity:item?'service-running':'unconfirmed',limits:s.policy,next_action:s.last_event??'Await an approved event'};},
      async execute({action,expectedVersion,idempotencyKey,payload,project,actor}){
        if(action==='autonomy.start-service'){
          const s=await readAutonomy(project.task_root);if(s.version!==expectedVersion)throw Error('Improvement settings changed');
          if(!s.policy.admission?.enabled)throw Error('Select an approved standing improvement goal');
          const goal=await readNativeGoal(project.task_root,s.policy.admission.goal_id);await assertNativeGoalAuthority(project.task_root,goal,{actor,execution:true});
          if(improvementServices.has(project.task_root))return {state:'running-in-this-host',model_called:false};
          const {createAutonomyWorkflowAdapter}=await import('./workkeel-autonomy-workflow.mjs');const controller=new AbortController(),item={controller,service:null,errors:[],last_step:null};
          item.service=await serveAutonomy(project.task_root,{adapter:createAutonomyWorkflowAdapter(project.task_root),goalAdapter,signal:controller.signal,onStep:r=>{item.last_step={idle:r.idle??null,goal_id:r.goal_id??null,progressed:r.progressed??false,at:new Date().toISOString()};},onError:e=>{item.errors.push(e.message);if(item.errors.length>10)item.errors.shift();}});improvementServices.set(project.task_root,item);return {state:'listening',model_called:false};
        }
        if(action==='autonomy.cancel'){
          const job=(await readAutonomy(project.task_root)).jobs.find(job=>job.id===payload.job_id);
          if(!job?.authority||actor?.agent_id!==job.authority.actor.agent_id||actor?.principal_id!==job.authority.actor.principal_id||payload.task_id!==undefined&&payload.task_id!==job.task_id)throw Error('Cancellation requires the original job operator');
          const {createAutonomyWorkflowAdapter}=await import('./workkeel-autonomy-workflow.mjs');
          return cancelAutonomyJob(project.task_root,{...job.authority,job_id:job.id,operation_id:idempotencyKey,expected_version:expectedVersion},{adapter:createAutonomyWorkflowAdapter(project.task_root)});
        }
        let request;
        if(payload.goal_id){const goal=await readNativeGoal(project.task_root,payload.goal_id);request={task_id:goal.controller.task_id,actor,claim_id:goal.controller.claim_id,contract_sha256:goal.controller.contract_sha256};}
        else ({request}=await authority(project,actor,payload.task_id));
        const {task_id,...fields}=payload;const input={...fields,...request,operation_id:idempotencyKey,expected_version:expectedVersion};
        return mutateAutonomy(project.task_root,action.replace(/^autonomy\./,''),input);}
      ,close:()=>closeServices(improvementServices)
    }
  };
}
