import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {readTaskProject, readNativeGit} from './workkeel-project.mjs';
import {readMonitorSnapshot} from './workkeel-monitor.mjs';
import {readTaskFile} from './task-contract.mjs';
import {readTaskSummary} from './workkeel-task-summary.mjs';
import {readNativeTask} from './workkeel-tasks.mjs';
import {readAutonomy} from './workkeel-autonomy.mjs';
import {listNativeGoals} from './workkeel-goals.mjs';
import {operationRows, aggregateRows, executionSummary, executionBreakdown} from './workkeel-monitor-analytics.mjs';

export const WORKSPACE_SCHEMA = 'workkeel.workspace-registry/v1';
export const defaultWorkspaceDirectory = () => path.join(os.homedir(), '.local', 'state', 'workkeel', 'workspace');
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value);
const text = (value, max=240) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const revision = value => typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);
function fail(message, code='INVALID_WORKSPACE') { const error = Error(message); error.code=code; throw error; }
function keys(value, required, optional=[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(k=>!Object.hasOwn(value,k)) || Object.keys(value).some(k=>![...required,...optional].includes(k))) fail('Invalid workspace fields');
}
function scopePath(scope) {
  if (typeof scope !== 'string' || scope.length > 500 || scope !== '.' && (!scope || scope.includes('\\') || path.isAbsolute(scope) || scope.split('/').some(v=>!v || v==='.' || v==='..'))) fail('Repository scope must be a relative directory');
  return scope;
}
function observerLink(value) {
  if (value === null || value === undefined) return null;
  let url; try { url=new URL(value); } catch { fail('Invalid observer link'); }
  if (url.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || !/^#[a-f0-9]{64}$/.test(url.hash)) fail('Observer link must be a private loopback capability URL');
  return url.href;
}
export function validateWorkspace(value) {
  keys(value,['schema_version','id','name','version','projects']);
  if (value.schema_version!==WORKSPACE_SCHEMA || !identifier(value.id) || !text(value.name) || !Number.isSafeInteger(value.version) || value.version<1 || !Array.isArray(value.projects) || value.projects.length>200) fail('Invalid workspace registry');
  const ids=new Set();
  for (const project of value.projects) {
    keys(project,['id','name','task_root','repositories','observer_url']);
    if (!identifier(project.id) || ids.has(project.id) || !text(project.name) || !path.isAbsolute(project.task_root??'') || !Array.isArray(project.repositories) || !project.repositories.length || project.repositories.length>64) fail('Invalid project registration');
    ids.add(project.id); observerLink(project.observer_url);
    const repos=new Set();
    for (const repo of project.repositories) {
      keys(repo,['id','path','scope']);
      if (!identifier(repo.id) || repos.has(repo.id) || !path.isAbsolute(repo.path??'')) fail('Invalid repository registration');
      repos.add(repo.id); scopePath(repo.scope);
    }
  }
  return value;
}
async function privateDirectory(input, {create=false}={}) {
  if (typeof input!=='string' || !path.isAbsolute(input)) fail('Workspace state requires an explicit absolute private directory');
  const directory=path.resolve(input);
  // Every component is checked; replacing a parent with a symlink is rejected on
  // each call. Do not store maintainer state anywhere in this source tree.
  const source=await fs.realpath(new URL('..',import.meta.url).pathname);
  if (within(directory,source)) fail('Workspace state must be outside framework source');
  let current=path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    if (create) await fs.mkdir(current,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    const stat=await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Workspace state directories must not be symlinks');
  }
  return directory;
}
async function registryAt(directory) {
  const file=await fs.open(path.join(directory,'workspace.json'), constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await file.stat();
    if (!before.isFile() || before.size>1024*1024) fail('Workspace registry exceeds its limit');
    const buffer=Buffer.alloc(before.size+1); let size=0;
    while(size<buffer.length) {const chunk=await file.read(buffer,size,buffer.length-size,null); if(!chunk.bytesRead)break;size+=chunk.bytesRead;}
    const after=await file.stat(),entry=await fs.lstat(path.join(directory,'workspace.json'));
    if (size!==before.size || before.mtimeMs!==after.mtimeMs || before.ctimeMs!==after.ctimeMs || entry.ino!==before.ino || entry.dev!==before.dev || entry.isSymbolicLink()) fail('Workspace registry changed during read');
    return validateWorkspace(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size))));
  } finally {await file.close();}
}
async function mutate(directoryInput, expectedVersion, operation) {
  const directory=await privateDirectory(directoryInput),lock=path.join(directory,'.workspace-lock');
  await fs.mkdir(lock,{mode:0o700}).catch(error=>{if(error.code==='EEXIST')fail('Workspace is busy; refresh before retrying','WORKSPACE_BUSY');throw error;});
  const temporary=path.join(directory,'.workspace-'+randomUUID()+'.tmp');
  try {
    const value=await registryAt(directory);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion!==value.version) fail('Workspace version changed; refresh before editing','WORKSPACE_CONFLICT');
    const next=validateWorkspace(await operation(structuredClone(value)));next.version=value.version+1;
    await fs.writeFile(temporary,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600});
    const handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
    await fs.rename(temporary,path.join(directory,'workspace.json'));
    return next;
  } finally {await fs.rm(temporary,{force:true});await fs.rmdir(lock);}
}
export async function createWorkspace(stateDir,{id='workspace',name='My workspace'}={}) {
  const directory=await privateDirectory(stateDir,{create:true});
  const value=validateWorkspace({schema_version:WORKSPACE_SCHEMA,id,name,version:1,projects:[]});
  await fs.writeFile(path.join(directory,'workspace.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  return value;
}
export async function readWorkspace(stateDir) {return registryAt(await privateDirectory(stateDir));}
export async function registerWorkspaceProject(stateDir, input, {expectedVersion}={}) {
  keys(input,['id','name','task_root','repositories'],['observer_url']);
  const taskRoot=await fs.realpath(input.task_root);await readTaskProject(taskRoot);
  if (!Array.isArray(input.repositories) || !input.repositories.length || input.repositories.length>64) fail('A project requires explicitly selected repositories');
  const repositories=[];
  for (const repo of input.repositories) {
    keys(repo,['id','path'],['scope']);const root=await fs.realpath(repo.path),scope=scopePath(repo.scope??'.');
    const gitRoot=await fs.realpath((await readNativeGit(root,['rev-parse','--show-toplevel'])).trim());
    if (gitRoot!==root) fail('Repository path must be its Git root; use scope for monorepo directories');
    const scoped=await fs.realpath(path.join(root,scope));
    if (!within(scoped,root) || scoped!==path.join(root,scope) || !(await fs.stat(scoped)).isDirectory()) fail('Repository scope escapes its root or uses a symlink');
    repositories.push({id:repo.id,path:root,scope});
  }
  const directory=await privateDirectory(stateDir);
  if ([taskRoot,...repositories.map(r=>r.path)].some(root=>within(directory,root))) fail('Workspace state must be outside registered repositories');
  const project={id:input.id,name:input.name,task_root:taskRoot,repositories,observer_url:observerLink(input.observer_url)};
  return mutate(directory,expectedVersion,value=>{if(value.projects.some(p=>p.id===project.id))fail('Project ID already registered');value.projects.push(project);return value;});
}
export async function removeWorkspaceProject(stateDir,id,{expectedVersion}={}) {
  if(!identifier(id))fail('Invalid project ID');
  return mutate(stateDir,expectedVersion,value=>{if(!value.projects.some(p=>p.id===id))fail('Project not found');value.projects=value.projects.filter(p=>p.id!==id);return value;});
}
export const workspaceTaskKey=(projectId,taskId)=>{if(!identifier(projectId)||!identifier(taskId))fail('Invalid task reference');return projectId+':'+taskId;};
export function workspaceAutonomySummary(value) {
  const jobs=(value.jobs??[]).filter(job=>job.origin==='improvement');
  const times=[...jobs.map(job=>job.updated_at),...(value.discovery_runs??[]).map(run=>run.at),...(value.proposals??[]).map(proposal=>proposal.created_at)].filter(at=>Number.isFinite(Date.parse(at))).sort();
  const state=!value.policy.enabled?'off':value.paused?'paused':jobs.some(job=>job.status==='recovery-required')?'needs-reconciliation':jobs.some(job=>job.status==='running')?'execution-recorded':jobs.some(job=>job.status==='queued')?'queued':jobs.some(job=>job.status==='awaiting-acceptance')?'awaiting-acceptance':jobs.some(job=>job.status==='failed')?'failure-recorded':'idle';
  return {enabled:value.policy.enabled,state,last_updated:times.at(-1)??null,read_status:'available',live_activity:'unconfirmed'};
}

const reportedText=value=>typeof value==='string'&&value.trim()?value:null;
const actorReport=value=>value&&reportedText(value.agent_id)&&reportedText(value.principal_id)?{agent_id:value.agent_id,principal_id:value.principal_id}:null;
const settingValue=value=>typeof value==='string'?value:value&&typeof value==='object'?value.value??value.mode??null:null;
export function workspaceExecutionRows(tasks,goals=[]) {
  const result=[];
  for(const task of tasks) {
    const sources=new Map();
    for(const run of task.runs??[])for(const operation of run.operations??[]) {const key=JSON.stringify([run.run_id,operation.operation_id]);if(!sources.has(key))sources.set(key,{run,operation});}
    for(const row of executionBreakdown({...task,id:task.key??task.id}).rows) {
      const {run,operation}=sources.get(JSON.stringify([row.run_id,row.operation_id]));
      const snapshot=operation.model_snapshot??operation.selection_snapshot??null;
      const actor=actorReport(operation.actor)??actorReport(run.actor);
      const intervalMs=executionSummary({id:task.key??task.id,runs:[{...run,operations:[operation]}]}).execution_ms;
      result.push({key:row.key,task_key:task.key??task.id,task_title:task.title,project_id:task.project_id,operation_id:row.operation_id,execution_id:row.execution_id??run.dispatch_execution_id??null,run_id:row.run_id,node:row.node??null,display_label:reportedText(row.display_label),
        activity_kind:reportedText(row.activity_kind),state:reportedText(row.state),actor,actor_source:actorReport(operation.actor)?'operation-report':actorReport(run.actor)?'run-report':'unreported',
        requested:{model:settingValue(snapshot?.requested?.model)??operation.requested_model??null,reasoning:settingValue(snapshot?.requested?.reasoning)??settingValue(operation.requested_reasoning),service:settingValue(snapshot?.requested?.service)??settingValue(operation.requested_service)},
        selected:{model:reportedText(operation.selected_model)??reportedText(snapshot?.selected?.model),model_alias:reportedText(row.model_id)??reportedText(snapshot?.selected?.id),reasoning:settingValue(operation.selected_reasoning)??settingValue(snapshot?.selected?.reasoning),service:settingValue(operation.selected_service)??settingValue(snapshot?.selected?.service)},
        reported:{model:reportedText(operation.observed_model)??reportedText(operation.runtime_model),reasoning:reportedText(operation.reported_reasoning),service:reportedText(operation.reported_service)},model:row.model,model_basis:row.model_basis,tool:row.tool,provider:row.provider??null,
        reported_ms:row.ms,interval_ms:intervalMs,tokens:row.tokens,tokens_complete:row.tokens_complete,time_complete:row.time_complete,token_breakdown:row.token_breakdown,journal_complete:row.journal_complete,start_at:row.start_at,end_at:row.end_at,last_observed_at:row.last_observed_at??null,result_recorded:row.result_recorded,overlapping_with:row.overlapping_with,read_status:task.read_status,
        usage_source:row.usage_source??null,selection_reason:row.selection_reason??null,identity_semantics:'recorded-accountability-only',service_report_source:operation.service_report_source??'unreported',host_request_model:operation.requested_model??null});
      if(result.length>50000)fail('Workspace operation projection exceeds its limit');
    }
  }
  const identity=row=>JSON.stringify([row.task_key,row.operation_id]),existing=new Set(result.map(identity));
  for(const goal of goals)for(const row of goal.operations??[])if(!existing.has(identity(row))){result.push(row);existing.add(identity(row));if(result.length>50000)fail('Workspace operation projection exceeds its limit');}
  return result;
}
/** Only the recorded mandatory set defines a whole goal. Workspace registration
 * bounds observation; a stored historical completion never overrides fresh pins. */
const rootReference=(root,id)=>'repo-'+createHash('sha256').update(JSON.stringify([root,id])).digest('hex');
const rootedKey=(project,root,id)=>root===project.task_root?workspaceTaskKey(project.id,id):project.id+':repo:'+createHash('sha256').update(root).digest('hex')+':'+id;
function componentRegistration(registry,component){
  const candidates=registry.projects.flatMap(project=>project.repositories.filter(repo=>repo.path===component.root&&repo.id===component.repo_id).map(repo=>({project,repo})));
  const preferred=candidates.filter(item=>item.project.id===component.project_id),matches=preferred.length?preferred:candidates;
  return matches.length===1?{...matches[0],status:'registered'}:{project:null,repo:null,status:matches.length?'scope-ambiguous':'unregistered'};
}
export function projectWorkspaceGoals(entries,registry,ownerId,{goalRoot=null,snapshotTasks=[]}={}) {
  if(!Array.isArray(entries)||entries.length>200)fail('Workspace goal projection limit reached');
  const ownerProject=registry.projects.find(p=>p.id===ownerId);if(!ownerProject)fail('Goal owner project is not registered');goalRoot??=ownerProject.task_root;
  return entries.map(goal=>{
    const key=rootedKey(ownerProject,goalRoot,goal.id),reference_id=goalRoot===ownerProject.task_root?goal.id:rootReference(goalRoot,goal.id),manifest=goal.manifest;
    const sourceRepos=ownerProject.repositories.filter(r=>r.path===goalRoot),sourceIds=new Set((goal.mandatory_components??[]).filter(c=>c.root===goalRoot).map(c=>c.repo_id));
    const preferredSource=sourceRepos.filter(r=>sourceIds.has(r.id)),sourceMatches=preferredSource.length?preferredSource:sourceRepos;
    const repo_id=sourceMatches.length===1?sourceMatches[0].id:null,sourceRegistered=goalRoot===ownerProject.task_root||sourceMatches.length===1;
    const components=(goal.mandatory_components??[]).map(c=>{
      const {project:owner,repo,status:registration}=componentRegistration(registry,c);
      const paths=c.scope_paths;
      const scope=repo&&(repo.scope==='.'||Array.isArray(paths)&&paths.length>0&&paths.every(p=>within(path.join(c.root,p),path.join(repo.path,repo.scope))));
      const taskKey=owner?rootedKey(owner,c.root,c.task_id):null,task_view_available=!!owner&&owner.task_root===c.root&&snapshotTasks.some(t=>t.key===taskKey&&t.task_root===c.root);
      return {id:c.id,task_id:c.task_id,project_id:owner?.id??null,repo_id:c.repo_id,root:c.root,key:taskKey,task_view_available,scope_status:registration!=='registered'?registration:scope?'registered':'scope-unconfirmed',read_status:c.read_status,state:c.state??null,accepted:c.accepted===true,candidate_revision:c.candidate_revision??null,review_judgment:c.read_status==='available'&&c.review?.revision===c.candidate_revision?c.review?.judgment??null:null,reviews:c.read_status==='available'?c.reviews??[]:[],depends_on:c.depends_on??[],phase:c.progress?.phase??null,reason:c.reason??c.progress?.last_error??null,interfaces:c.fact?.interface_pins??[],task_version:c.task_version??null};
    });
    const visible=sourceRegistered&&components.length>0&&components.every(c=>c.scope_status==='registered'&&c.read_status==='available');
    const acceptance=goal.accepted===true&&goal.whole_acceptance==='accepted'&&!!goal.integration&&visible&&components.every(c=>c.accepted)&&goal.authority_status==='current'?'accepted':goal.whole_acceptance==='stale'||goal.integration&&!goal.accepted?'stale':visible?'not-accepted':'unavailable';
    if(!Array.isArray(goal.operations??[])||(goal.operations??[]).length>1000)fail('Workspace goal operation limit reached');
    const operations=(goal.operations??[]).map(op=>{
      const input=op.input??{},reported=op.result??{},component=components.find(c=>c.id===input.component_id),usage=reported.usage??{};
      const inputTokens=Number.isSafeInteger(usage.input_tokens)&&usage.input_tokens>=0?usage.input_tokens:null,outputTokens=Number.isSafeInteger(usage.output_tokens)&&usage.output_tokens>=0?usage.output_tokens:null;
      const tokensComplete=inputTokens!==null&&outputTokens!==null;
      const timing=op.timing?.execution,ms=Number.isFinite(timing?.duration_ms)&&timing.duration_ms>=0?timing.duration_ms:Number.isFinite(usage.duration_ms)&&usage.duration_ms>=0?usage.duration_ms:null;
      const selected=input.model??{},actual=reported.runtime_selection??{},nativeEvent=reported.native?.task?.history?.find(event=>event.operation_id===input.request?.operation_id),actor=actorReport(reported.actor)??actorReport(nativeEvent?.actor),review=op.kind==='runtime'&&input.phase==='review'?component?.reviews.find(event=>event.operation_id===op.id&&event.revision===input.candidate):null;
      return {key:key+':'+op.id,task_key:component?.key??key,task_title:manifest?.title??goal.id,project_id:ownerId,goal_key:key,goal_id:goal.id,component_id:input.component_id,operation_id:op.id,execution_id:reported.thread_id??null,run_id:goal.id,node:input.phase,display_label:null,review_judgment:review?.judgment??null,review_revision:review?.revision??null,activity_kind:op.kind==='native'?'coordination':input.phase==='review'?'independent-review':input.phase,state:op.status,actor,actor_source:actor?(op.kind==='native'?'native-event':'runtime-result'):'unreported',requested_actor:actorReport(input.actor)??actorReport(input.request?.actor),requested:{model:selected.model??null,reasoning:selected.reasoning??null,service:selected.service??null},selected:{model:selected.model??null,model_alias:null,reasoning:selected.reasoning??null,service:selected.service??null},reported:{model:actual.model??null,reasoning:actual.reasoning??null,service:actual.service??null},model:actual.model??'unreported',model_basis:actual.model?'runtime-result':'unreported',tool:reportedText(reported.tool)??(op.kind==='native'?'native-task':'unreported'),requested_provider:selected.provider??null,provider:actual.provider??selected.provider??null,reported_ms:ms,interval_ms:Number.isFinite(timing?.duration_ms)&&timing.duration_ms>=0?timing.duration_ms:null,tokens:tokensComplete?inputTokens+outputTokens:inputTokens??outputTokens,tokens_complete:tokensComplete,time_complete:ms!==null,token_breakdown:{input:inputTokens,output:outputTokens,cached_input:Number.isSafeInteger(usage.cached_input_tokens)?usage.cached_input_tokens:null,uncached_input:null,total:tokensComplete?inputTokens+outputTokens:null},journal_complete:true,start_at:timing?.started_at??op.at??null,end_at:timing?.ended_at??null,last_observed_at:null,result_recorded:op.result!==null,overlapping_with:[],read_status:visible?'available':'partial',time_source:timing?.basis??(ms!==null?'runtime-usage-report':'unreported'),usage_source:op.result?'runtime-result':'unreported',selection_reason:null,identity_semantics:'recorded-accountability-only',service_report_source:actual.service?'runtime-result':'unreported',host_request_model:selected.model??null,model_called:reported.model_called??null};
    });
    const state=goal.status??goal.state??'unknown',reason=goal.reason??goal.last_error??components.find(c=>c.reason&&!c.accepted)?.reason??null;
    const requires_recovery=acceptance!=='accepted'&&!['paused','cancelled'].includes(state)&&(!!reason||['blocked','recovery-required','review-required'].includes(state));
    return {id:goal.id,reference_id,key,project_id:ownerId,root:goalRoot,repo_id,source_scope_status:sourceRegistered?'registered':sourceMatches.length?'scope-ambiguous':'unregistered',title:manifest?.title??goal.id,version:goal.version??null,state,requires_recovery,read_status:goal.read_status==='unavailable'||!manifest?'unavailable':visible?'available':'partial',reason,authority_status:goal.authority_status??'unknown',acceptance,accepted:acceptance==='accepted',historically_accepted:!!goal.integration,component_set_sha256:goal.component_set_sha256??null,mandatory_components:components,integration:goal.integration?{candidate_set_sha256:goal.integration.candidate_set_sha256,revision:goal.integration.revision??goal.integration.integration_candidate??null,pins:goal.integration.pins??[]}:null,integration_component_id:manifest?.integration?.component_id??null,criteria:manifest?.integration?.criteria??[],roles:manifest?.roles??{},limits:manifest?.limits??null,derived_from:manifest?.derived_from??null,operations,execution:workspaceRecordedSummary(operations),created_at:goal.created_at??null,published:goal.published??'not-performed',deployed:goal.deployed??'not-performed'};
  });
}
function queryPage(rows,{limit=30,offset=0}={}) {
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>50000)fail('Invalid execution page');
  return {items:rows.slice(offset,offset+limit),total:rows.length,offset,limit,next_offset:offset+limit<rows.length?offset+limit:null};
}
export function workspaceRecordedSummary(rows){
  const intervals=rows.filter(row=>Number.isFinite(row.interval_ms)).map(row=>[Date.parse(row.start_at),Date.parse(row.end_at)]).filter(([start,end])=>Number.isFinite(start)&&Number.isFinite(end)&&end>=start).sort((a,b)=>a[0]-b[0]);
  let total=0,start=null,end=null;for(const interval of intervals){if(start===null){[start,end]=interval;}else if(interval[0]<=end)end=Math.max(end,interval[1]);else{total+=end-start;[start,end]=interval;}}if(start!==null)total+=end-start;
  const known=rows.filter(row=>Number.isFinite(row.tokens)),times=rows.filter(row=>Number.isFinite(row.reported_ms));
  return {execution_ms:intervals.length?total:null,execution_complete:rows.length>0&&intervals.length===rows.length,time_basis:'recorded-wall-interval-union',tokens:known.length?known.reduce((sum,row)=>sum+row.tokens,0):null,tokens_complete:rows.length>0&&rows.every(row=>row.tokens_complete),reported_ms:times.length?times.reduce((sum,row)=>sum+row.reported_ms,0):null,operation_count:rows.length};
}
export function projectWorkspaceExecution(snapshot,{project_id,task_id,limit=30,offset=0}={}) {
  const key=workspaceTaskKey(project_id,task_id),task=snapshot.tasks.find(t=>t.key===key);
  if(!task)return {available:false,read_status:'unavailable',task_key:key,operations:{items:[],total:null,next_offset:null},summary:null};
  const rows=workspaceExecutionRows([task],(snapshot.goals??[]).map(goal=>({...goal,operations:goal.operations.filter(row=>row.task_key===key)})));
  return {available:true,authority:'observation-only',task_key:key,lifecycle_state:task.task_state,read_status:task.read_status,operations:queryPage(rows,{limit,offset}),summary:{...executionSummary({...task,id:key}),...workspaceRecordedSummary(rows)},activity_kinds:[...new Set(rows.map(row=>row.activity_kind??'unreported'))],reported_actor_count:new Set(rows.filter(row=>row.actor).map(row=>JSON.stringify(row.actor))).size,identity_coverage:{reported:rows.filter(row=>row.actor).length,total:rows.length},read_at:snapshot.read_at};
}
export function projectWorkspaceAnalysis(snapshot,{project='all',activity='all',tool='all',model='all',group='activity_kind',limit=30,offset=0}={}) {
  if(!['activity_kind','tool','model'].includes(group))fail('Invalid analysis grouping');
  for(const value of [project,activity,tool,model])if(typeof value!=='string'||value.length>240)fail('Invalid analysis filter');
  const all=workspaceExecutionRows(snapshot.tasks,snapshot.goals??[]),rows=all.filter(row=>(project==='all'||row.project_id===project)&&(activity==='all'||(row.activity_kind??'unreported')===activity)&&(tool==='all'||row.tool===tool)&&(model==='all'||row.model===model));
  const grouped=aggregateRows(rows.map(row=>({...row,task_id:row.task_key,ms:row.reported_ms,turn_ms:null,turn_complete:false})),group).sort((a,b)=>b.rows-a.rows||a.id.localeCompare(b.id));
  return {authority:'observation-only',read_at:snapshot.read_at,filters:{project,activity,tool,model,group},groups:queryPage(grouped,{limit,offset}),operations:queryPage(rows,{limit,offset}),dimensions:{projects:snapshot.projects.map(p=>({id:p.id,name:p.name})),activity:[...new Set(all.map(row=>row.activity_kind??'unreported'))].sort(),tool:[...new Set(all.map(row=>row.tool))].sort(),model:[...new Set(all.map(row=>row.model))].sort()},
    totals:aggregateRows(rows.map(row=>({...row,task_id:row.task_key,ms:row.reported_ms,total:'all'})),'total')[0]??null,coverage:{selected_operations:rows.length,recorded_operations:all.length,measured_tokens:rows.filter(row=>row.tokens_complete).length,measured_time:rows.filter(row=>row.time_complete).length,unavailable_projects:snapshot.projects.filter(p=>p.read_status!=='available').map(p=>p.id),stale_operations:rows.filter(row=>row.read_status==='stale').length,scope:'recorded-operations-only',unobserved_host_conversation:'not-measured'}};
}

/** An attention summary never promotes automatic review/wait into a human ask. */
export function projectWorkspaceAttention(tasks,projects,goals=[]) {
  const groups=new Map();
  const add=(key,issue)=>{if(!groups.has(key))groups.set(key,{...issue,tasks:[]});groups.get(key).tasks.push(...(issue.tasks??[]));};
  for(const project of projects)if(project.read_status!=='available')add('source:'+project.id,{id:'source:'+project.id,project_id:project.id,kind:'source-unavailable',title:'Latest project state cannot be confirmed',next_action:'Reconnect the project and check its last confirmed state.',tasks:[]});
  for(const project of projects)if(project.autonomy?.read_status==='unavailable')add('autonomy:'+project.id,{id:'autonomy:'+project.id,project_id:project.id,kind:'autonomy-unavailable',title:'Autonomous improvement state cannot be confirmed',next_action:'Inspect the project improvement settings and restore its saved control state.',tasks:[]});
  for(const goal of goals)if(goal.requires_recovery){
    const key=goal.project_id+':goal-recovery:'+digest(goal.reason??goal.state),existing=groups.get(key);
    const reference={id:goal.reference_id??goal.id,key:goal.key,title:goal.title};
    if(existing)existing.goals.push(reference);
    else add(key,{id:key,project_id:goal.project_id,kind:'goal-blocked',title:'Delivery needs recovery',next_action:'Open the goal, restore its required model or authority, then reconcile and recover.',reason:goal.reason,goals:[reference],tasks:[]});
  }
  const humanReasons=new Set(['approval-expired','policy-changed','evidence-unavailable','awaiting-acceptance']);
  for(const task of tasks) {
    if(task.read_status==='stale')continue;
    const reasons=(task.attention_reasons??[]).filter(r=>humanReasons.has(r));
    if(task.human_attention?.required===true)reasons.push(task.human_attention.reason??'decision-required');
    for(const reason of new Set(reasons))add(task.project_id+':'+reason,{id:task.project_id+':'+reason,project_id:task.project_id,kind:reason,title:{'approval-expired':'Renew task authority','policy-changed':'Resolve the project policy change','evidence-unavailable':'Restore changed or missing evidence','awaiting-acceptance':'Review the delivered result'}[reason]??task.human_attention?.title??'A decision is required',next_action:task.human_attention?.next_action??task.next_action,tasks:[task.key]});
  }
  return [...groups.values()].map(group=>({...group,affected_count:new Set(group.tasks).size,affected_goals:group.goals?.length??0}));
}

/** Canonical sources are read fresh; projection failure remains scoped. No model
 * is called and no canonical task record is copied into workspace state. */
export async function readWorkspaceSnapshot(stateDir,{snapshotReader=readMonitorSnapshot,autonomyReader=readAutonomy,goalReader=listNativeGoals,now=new Date()}={}) {
  const registry=await readWorkspace(stateDir),projects=[],tasks=[],goals=[];
  for(const registered of registry.projects) {
    try {
      if(await fs.realpath(registered.task_root)!==registered.task_root)fail('Task root identity changed');
      for(const repo of registered.repositories)if(await fs.realpath(repo.path)!==repo.path || !within(await fs.realpath(path.join(repo.path,repo.scope)),repo.path))fail('Repository identity changed');
      const snapshot=await snapshotReader(registered.task_root,{maxTasks:2000});
      if(!snapshot || !Array.isArray(snapshot.tasks) || snapshot.tasks.length>2000 || tasks.length+snapshot.tasks.length>10000)fail('Workspace task projection limit reached');
      const ids=new Set();
      for(const item of snapshot.tasks) {
        const id=item.id??item.task_id;if(ids.has(id))fail('Duplicate canonical task ID');ids.add(id);
        const key=workspaceTaskKey(registered.id,id);
        let dependencyRefs=item.dependencies??[],dependencyPins=item.dependency_pins??null;
        if(snapshotReader===readMonitorSnapshot&&item.read_status==='available') {
          const source=await readNativeTask(registered.task_root,id);
          if(source.version!==item.version)fail('Canonical task changed while projecting its dependencies');
          dependencyRefs=source.contract.dependencies;dependencyPins=source.dependency_pins;
        }
        tasks.push({...item,id,key,project_id:registered.id,task_root:registered.task_root,dependencies:dependencyRefs.map(ref=>workspaceTaskKey(registered.id,ref)),dependency_pins:dependencyPins,execution:executionSummary(item)});
      }
      const scoped=tasks.filter(task=>task.project_id===registered.id),active=scoped.filter(task=>!['done','cancelled'].includes(task.task_state));
      let autonomy;try{autonomy=workspaceAutonomySummary(await autonomyReader(registered.task_root));}catch{autonomy={enabled:null,state:'unknown',last_updated:null,read_status:'unavailable',live_activity:'unconfirmed'};}
      projects.push({...registered,read_status:'available',complete:snapshot.complete===true&&autonomy.read_status==='available',autonomy,last_confirmed_at:snapshot.read_at??now.toISOString(),task_count:scoped.length,active_count:active.length,goal:active[0]?.goal??active[0]?.title??null,legacy_tasks_excluded:snapshot.legacy_tasks_excluded??0,source:snapshot.project??null});
    }catch {for(let i=tasks.length-1;i>=0;i--)if(tasks[i].project_id===registered.id)tasks.splice(i,1);projects.push({...registered,read_status:'unavailable',complete:false,last_confirmed_at:null,task_count:null,active_count:null,goal:null});}
    const projected=projects.at(-1),projectGoals=[],goalRoots=[];
    for(const goalRoot of new Set([registered.task_root,...registered.repositories.map(r=>r.path)])){
      try{
        if(await fs.realpath(goalRoot)!==goalRoot)fail('Goal root identity changed');
        const entries=await goalReader(goalRoot);
        if(goalReader===listNativeGoals)for(const goal of entries)for(const c of goal.mandatory_components??[])if(componentRegistration(registry,c).status==='registered'){try{const task=await readNativeTask(c.root,c.task_id);c.scope_paths=[...task.contract.environment.read_paths,...task.contract.environment.write_paths];}catch{c.scope_paths=null;}}
        const items=projectWorkspaceGoals(entries,registry,registered.id,{goalRoot,snapshotTasks:tasks});projectGoals.push(...items);goalRoots.push({root:goalRoot,read_status:items.some(g=>g.read_status!=='available')?'partial':'available',goal_count:items.length});
      }catch(error){goalRoots.push({root:goalRoot,read_status:'unavailable',goal_count:null,reason:error.message});}
    }
    const references=new Map();for(const goal of projectGoals){const prior=references.get(goal.reference_id);if(prior){for(const conflicting of [prior,goal])Object.assign(conflicting,{read_status:'unavailable',accepted:false,acceptance:'unavailable',reason:'Goal route reference is ambiguous'});}references.set(goal.reference_id,goal);}
    goals.push(...projectGoals);const activeGoal=projectGoals.find(g=>!['done','cancelled'].includes(g.state)),derived=projectGoals.filter(g=>g.derived_from);
    const goalReadStatus=goalRoots.every(r=>r.read_status==='available')&&projectGoals.every(g=>g.read_status==='available')?'available':goalRoots.every(r=>r.read_status==='unavailable')?'unavailable':'partial';
    Object.assign(projected,{complete:projected.complete&&goalReadStatus==='available',goal_read_status:goalReadStatus,goal_roots:goalRoots,goal_count:projectGoals.length,goal_summary:activeGoal?{key:activeGoal.key,state:activeGoal.state,requires_recovery:activeGoal.requires_recovery,reason:activeGoal.reason,read_status:activeGoal.read_status,acceptance:activeGoal.acceptance,authority_status:activeGoal.authority_status}:null,goal:activeGoal?.title??projected.goal});
    if(projected.autonomy?.enabled&&derived.length)projected.autonomy={...projected.autonomy,state:derived.some(g=>g.state==='cancel-requested'||g.authority_status!=='current'||g.read_status!=='available')?'needs-reconciliation':derived.some(g=>g.state==='running')?'execution-recorded':derived.some(g=>g.state==='paused')?'paused':derived.some(g=>!g.accepted&&g.state!=='cancelled')?'awaiting-acceptance':projected.autonomy.state,last_updated:derived.map(g=>g.created_at).filter(Boolean).sort().at(-1)??projected.autonomy.last_updated};
  }
  const sharing=[];
  for(let p=0;p<projects.length;p++)for(let q=p+1;q<projects.length;q++)for(const a of projects[p].repositories)for(const b of projects[q].repositories) {
    const first=path.join(a.path,a.scope),second=path.join(b.path,b.scope);
    if(within(first,second)||within(second,first))sharing.push({project_ids:[projects[p].id,projects[q].id],repo_ids:[a.id,b.id],path:first,kind:'shared-write-scope',permission:'not-granted-by-registration'});
  }
  for(const goal of goals)for(const component of goal.mandatory_components)component.task_view_available=tasks.some(task=>task.key===component.key&&task.task_root===component.root);
  for(const task of tasks){task.goals=goals.filter(g=>g.mandatory_components.some(c=>c.key===task.key)).map(g=>({key:g.key,id:g.id,reference_id:g.reference_id,project_id:g.project_id,title:g.title,acceptance:g.acceptance}));const relevant=goals.map(g=>({...g,operations:g.operations.filter(row=>row.task_key===task.key)}));task.execution={...task.execution,...workspaceRecordedSummary(workspaceExecutionRows([task],relevant))};}
  const rows=workspaceExecutionRows(tasks,goals).map(row=>({...row,task_id:row.task_key,ms:row.reported_ms})),attention=projectWorkspaceAttention(tasks,projects,goals);
  return {schema_version:'workkeel.workspace-snapshot/v1',authority:'observation-only',model_calls:0,read_at:now.toISOString(),registry_version:registry.version,id:registry.id,name:registry.name,complete:projects.every(p=>p.complete),projects,tasks,attention,shared_scopes:sharing,
    goals,recent_deliveries:tasks.filter(t=>t.delivery).sort((a,b)=>String(b.updated_at??'').localeCompare(String(a.updated_at??''))).slice(0,12).map(t=>({key:t.key,project_id:t.project_id,title:t.title,candidate_revision:t.candidate_revision,accepted:t.quality?.locally_accepted===true,merged:'unreported',published:'unreported',deployed:'unreported',updated_at:t.updated_at})),
    usage:aggregateRows(rows.map(row=>({...row,total:'all'})),'total')[0]??null,usage_coverage:{recorded_operations:rows.length,total_tasks:tasks.length,tasks_with_operations:new Set(rows.map(row=>row.task_id)).size,scope:'recorded-operations-only',unobserved_host_conversation:'not-measured'}};
}

/** Integration evidence is pinned to the full exact candidate set. A caller's
 * verdict cannot substitute for reading its evidence bytes in a registered repo. */
export async function inspectWorkspaceIntegration(snapshot,{components,evidence=null}={}) {
  if(!Array.isArray(components)||!components.length||components.length>64)fail('Invalid integration component list');
  const seen=new Set(),results=[];
  for(const item of components) {
    keys(item,['project_id','task_id','repo_id','candidate_revision']);
    const key=workspaceTaskKey(item.project_id,item.task_id),identity=JSON.stringify([key,item.repo_id]);
    if(seen.has(identity)||!identifier(item.repo_id)||!revision(item.candidate_revision))fail('Invalid or duplicate integration component');seen.add(identity);
    const project=snapshot.projects.find(p=>p.id===item.project_id),task=snapshot.tasks.find(t=>t.key===key),repo=project?.repositories.find(r=>r.id===item.repo_id);
    let status=!project||!repo?'scope-unregistered':project.read_status!=='available'||!task||task.read_status!=='available'?'unavailable':task.candidate_revision!==item.candidate_revision?'candidate-changed':task.quality?.evidence_current!==true?'evidence-unverified':task.quality?.locally_accepted!==true?'not-accepted':'accepted';
    if(status==='accepted')try{
      const current=await readTaskSummary(project.task_root,item.task_id);
      if(current.candidate_revision!==item.candidate_revision)status='candidate-changed';
      else if(current.quality.evidence_current!==true)status='evidence-unverified';
      else if(current.quality.locally_accepted!==true)status='not-accepted';
      else if((await readNativeGit(repo.path,['rev-parse','--verify',item.candidate_revision+'^{commit}'])).trim()!==item.candidate_revision)status='candidate-unavailable';
    }catch{status='candidate-unavailable';}
    results.push({...item,key,status});
  }
  const exact=components.map(c=>({...c})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),candidateSetDigest=digest(exact);
  let evidenceStatus='unreported';
  if(evidence) {
    keys(evidence,['project_id','path','sha256']);
    const project=snapshot.projects.find(p=>p.id===evidence.project_id);
    if(!project||!/^[a-f0-9]{64}$/.test(evidence.sha256))fail('Invalid integration evidence reference');
    try {
      const file=await readTaskFile(project.task_root,evidence.path);
      const record=JSON.parse(file.content);
      evidenceStatus=file.digest!==evidence.sha256?'changed':record.schema_version!=='workkeel.integration-evidence/v1'||record.candidate_set_digest!==candidateSetDigest?'candidate-mismatch':record.judgment!=='pass'?'failed':!Array.isArray(record.checks)||!record.checks.length||record.checks.some(check=>check.status!=='pass')?'checks-incomplete':'verified';
    }catch {evidenceStatus='unavailable';}
  }
  return {schema_version:'workkeel.integration-projection/v1',authority:'observation-only',candidate_set_digest:candidateSetDigest,components:results,evidence_status:evidenceStatus,status:results.every(r=>r.status==='accepted')&&evidenceStatus==='verified'?'integration-verified':'incomplete',acceptance_granted:false,merged:'unreported',deployed:'unreported'};
}
