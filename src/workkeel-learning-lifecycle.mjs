import fs from 'node:fs/promises';
import path from 'node:path';
import {exactKeys, executionDigest} from './workkeel-execution-policy.mjs';
import {assertTaskExecutionContext} from './workkeel-tasks.mjs';
import {assertApprover, readTaskProject, safeDirectory} from './workkeel-project.mjs';
import {readTaskFile} from './task-contract.mjs';
import {withProjectMutationLock} from './workkeel-lock.mjs';
import {durableAtomicCreate, formatJson, sha256} from './files.mjs';
import {listNativeLearning} from './workkeel-learning.mjs';

const STORE = '.ai-org/learning/skill-lifecycle';
const ACTIVATIONS = '.agents/skills/workkeel-local';
const MAX_EVENTS = 1000;
const actions = ['candidate','evaluate','review','approve','policy','activate','suspend','rollback','revalidate','use','retrospective'];
const common = ['task_id','actor','claim_id','contract_sha256','operation_id'];
const fields = {
  candidate: ['skill_id','version','skill_dir','files','learning_ids','risk_tier','trigger','non_trigger','authority','dependencies','provenance','evidence'],
  evaluate: ['skill_id','version','comparison','baseline_version','cases','evidence'],
  review: ['skill_id','version','result','decision','evidence'],
  approve: ['skill_id','version','decision','evidence'],
  policy: ['enabled','skill_ids','approval_ref','expires_at'],
  activate: ['skill_id','version','evidence'], revalidate: ['skill_id','version','evidence'], rollback: ['skill_id','version','evidence'],
  suspend: ['skill_id','version','decision','evidence'],
  use: ['skill_id','version','stage','outcome','decision','evidence'],
  retrospective: ['decision','learning_ids','skill_versions','summary','evidence']
};
const fail = message => { throw Error(`Native Skill lifecycle: ${message}`); };
const under = (file, root) => root === '.' || file === root || file.startsWith(`${root}/`);
const key = r => `${r.skill_id}@${r.version}`;
function text(value, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail('invalid bounded text');
}
function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)) fail('invalid identifier'); }
function version(value) { if (typeof value !== 'string' || !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)) fail('invalid version'); }
function array(value, validate, {min = 0, max = 32, unique = true} = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail('invalid bounded array');
  for (let n = 0; n < value.length; n++) { if (!Object.hasOwn(value,n)) fail('sparse arrays are invalid'); validate(value[n]); }
  if (unique && new Set(value.map(x => executionDigest(x))).size !== value.length) fail('duplicate array entry');
}
const refs = (value, min = 1) => array(value, v => text(v,1024), {min});
function shape(action, r) {
  if (!actions.includes(action)) fail('unknown action');
  exactKeys(r, [...common,...fields[action]],['expected_version']);
  if(r.expected_version !== undefined && (!Number.isSafeInteger(r.expected_version) || r.expected_version<0 || r.expected_version>MAX_EVENTS))fail('invalid expected version');
  id(r.task_id); id(r.operation_id); text(r.claim_id,128);
  if (!/^[a-f0-9]{64}$/.test(r.contract_sha256)) fail('contract pin required');
  if (Object.hasOwn(r,'skill_id')) { id(r.skill_id); version(r.version); }
  if (Object.hasOwn(r,'evidence')) refs(r.evidence, action === 'use' && ['found','read'].includes(r.stage) ? 0 : 1);
  if (action === 'candidate') {
    text(r.skill_dir,1024); refs(r.files); array(r.learning_ids,id);
    if (!['low','standard','high','critical'].includes(r.risk_tier)) fail('invalid risk tier');
    for (const f of ['trigger','non_trigger','authority','provenance']) text(r[f]);
    refs(r.dependencies,0);
    if (!r.files.includes(`${r.skill_dir}/SKILL.md`) || r.files.some(f => !f.startsWith(`${r.skill_dir}/`)) || under(r.skill_dir,ACTIVATIONS)) fail('candidate requires an explicit source directory and SKILL.md');
  }
  if (action === 'evaluate') {
    if (!['with-without','old-new'].includes(r.comparison) || (r.comparison === 'with-without' ? r.baseline_version !== null : r.baseline_version === r.version)) fail('invalid comparison');
    if (r.comparison === 'old-new') version(r.baseline_version);
    array(r.cases,c => {
      exactKeys(c,['id','kind','input_ref','baseline','candidate']); id(c.id); text(c.input_ref,1024);
      if (!['training','holdout','negative-trigger'].includes(c.kind)) fail('invalid evaluation case');
      for (const name of ['baseline','candidate']) {
        exactKeys(c[name],['success','triggered','evidence']);
        if (typeof c[name].success !== 'boolean' || typeof c[name].triggered !== 'boolean') fail('evaluation outcomes must be explicit');
        refs(c[name].evidence);
      }
    }, {min:2,max:32});
    if (new Set(r.cases.map(c => c.id)).size !== r.cases.length || new Set(r.cases.map(c=>c.input_ref)).size !== r.cases.length || !r.cases.some(c => c.kind === 'holdout') || !r.cases.some(c => c.kind === 'negative-trigger')) fail('distinct holdout and negative-trigger cases required');
  }
  if (action === 'review' && (!['accept','reject'].includes(r.result))) fail('invalid review result');
  if (['review','approve','suspend','use','retrospective'].includes(action)) text(r.decision);
  if (action === 'approve' && !['approve','reject'].includes(r.decision)) fail('invalid approval decision');
  if (action === 'policy') {
    if (typeof r.enabled !== 'boolean') fail('policy enablement must be explicit');
    array(r.skill_ids,id,{min:1}); text(r.approval_ref,1024);
    if (r.expires_at !== null && (typeof r.expires_at !== 'string' || !Number.isFinite(Date.parse(r.expires_at)))) fail('invalid policy expiry');
  }
  if (action === 'use' && (!['found','read','applied','outcome'].includes(r.stage) || (r.stage === 'outcome' ? !['verified','failed','unknown'].includes(r.outcome) : r.outcome !== null))) fail('invalid use receipt');
  if (action === 'retrospective') {
    if (!['no-new-learning','captured'].includes(r.decision)) fail('invalid retrospective decision');
    text(r.summary); array(r.learning_ids,id); array(r.skill_versions,v => {exactKeys(v,['skill_id','version']);id(v.skill_id);version(v.version);});
    if (r.decision === 'no-new-learning' && r.learning_ids.length || r.decision === 'captured' && !r.learning_ids.length) fail('retrospective learning decision mismatch');
  }
}
function sources(action, r) {
  if (action === 'policy') return [r.approval_ref];
  const all = [...r.evidence];
  if (action === 'candidate') all.push(...r.files);
  if (action === 'evaluate') for (const c of r.cases) all.push(c.input_ref,...c.baseline.evidence,...c.candidate.evidence);
  const unique=[...new Set(all)];
  if(unique.length>256)fail('too many distinct evidence sources');
  return unique;
}
async function pin(target, values, env) {
  const pins = [];
  for (const ref of values) {
    if (under(ref,STORE) || under(ref,'.ai-org/learning/native') || env && !env.read_paths.some(root => under(ref,root))) fail('evidence outside approved read scope or self-referential storage');
    const file = await readTaskFile(target,ref,{preserveBom:true});
    if (!file.content.trim()) fail('empty evidence');
    pins.push({path:ref,sha256:file.bytes_digest});
  }
  return pins;
}
async function problems(target, pins) {
  const reasons = [];
  for (const p of pins) {
    try { if ((await readTaskFile(target,p.path)).bytes_digest !== p.sha256) reasons.push({code:'stale-evidence',path:p.path}); }
    catch { reasons.push({code:'unknown-evidence',path:p.path}); }
  }
  return reasons;
}
async function history(target) {
  let dir;
  try { dir = await safeDirectory(target,STORE); } catch (e) { if(e.code === 'ENOENT') return []; throw e; }
  const names = (await fs.readdir(dir)).sort();
  if (names.length > MAX_EVENTS) fail('event inventory limit');
  const result = [];
  for (const [n,name] of names.entries()) {
    if (name !== `${String(n+1).padStart(6,'0')}.json`) fail('invalid event inventory or sequence gap');
    const envelope = JSON.parse((await readTaskFile(target,`${STORE}/${name}`)).content);
    exactKeys(envelope,['event','sha256']); const e = envelope.event;
    exactKeys(e,['schema_version','sequence','previous_hash','action','request','request_sha256','at','pins','binding']);
    if (e.schema_version !== 'workkeel.skill-learning-event/v1' || e.sequence !== n+1 || e.previous_hash !== (result.at(-1)?.sha256 ?? null) || executionDigest(e) !== envelope.sha256 || executionDigest(e.request) !== e.request_sha256 || !Number.isFinite(Date.parse(e.at))) fail('event integrity failure');
    shape(e.action,e.request);
    array(e.pins,p => {exactKeys(p,['path','sha256']);text(p.path,1024);if(!/^[a-f0-9]{64}$/.test(p.sha256))fail('invalid evidence digest');},{max:256});
    if (executionDigest(sources(e.action,e.request)) !== executionDigest(e.pins.map(p => p.path))) fail('event pin mismatch');
    exactKeys(e.binding,['candidate_sha256','evaluation_sha256','review_sha256','approval_sha256','policy_sha256','baseline_sha256','activation']);
    for (const f of ['candidate_sha256','evaluation_sha256','review_sha256','approval_sha256','policy_sha256','baseline_sha256']) if(e.binding[f] !== null && !/^[a-f0-9]{64}$/.test(e.binding[f]))fail('invalid binding digest');
    if (e.binding.activation !== null) {exactKeys(e.binding.activation,['path','sha256']);text(e.binding.activation.path,1024);if(!/^[a-f0-9]{64}$/.test(e.binding.activation.sha256))fail('invalid activation digest');}
    result.push(envelope);
  }
  return result;
}
function passing(evaluation) {
  const cases=evaluation.request.cases;
  const safe=cases.every(c => c.candidate.success && (c.kind === 'negative-trigger' ? !c.candidate.triggered : c.candidate.triggered));
  const improves=cases.some(c=>c.candidate.success&&!c.baseline.success||c.kind==='negative-trigger'&&c.baseline.triggered&&!c.candidate.triggered);
  return safe&&improves;
}
async function project(target, events) {
  const currentProject=await readTaskProject(target);
  const versions = new Map(), selected = new Map(), uses = [], retrospectives = []; let policy = null;
  for (const {event:e,sha256:digest} of events) {
    const r=e.request, record={...e,event_sha256:digest};
    if (e.action === 'policy') {policy=record;continue;}
    if (e.action === 'retrospective') {retrospectives.push(record);continue;}
    if (e.action === 'candidate') {
      if(versions.has(key(r)))fail('duplicate candidate in history');
      versions.set(key(r),{skill_id:r.skill_id,version:r.version,candidate:record,evaluation:null,review:null,approval:null,activation:null,entrypoint:null,skill_files:[],suspended:false,reasons:[]});continue;
    }
    const item=versions.get(key(r)); if(!item)fail('unknown candidate in history');
    if(e.binding.candidate_sha256 !== item.candidate.event_sha256)fail('candidate binding mismatch');
    if(e.action === 'evaluate') {item.evaluation=record;item.review=null;item.approval=null;}
    if(e.action === 'review') {if(e.binding.evaluation_sha256 !== item.evaluation?.event_sha256)fail('evaluation binding mismatch');item.review=record;item.approval=null;}
    if(e.action === 'approve') {if(e.binding.review_sha256 !== item.review?.event_sha256)fail('review binding mismatch');item.approval=record;}
    if(['activate','rollback','revalidate'].includes(e.action)) {item.activation=record;item.suspended=false;selected.set(r.skill_id,key(r));}
    if(e.action === 'suspend') {item.suspended=true;if(selected.get(r.skill_id) === key(r))selected.delete(r.skill_id);}
    if(e.action === 'use') {uses.push(record);if(r.stage === 'outcome' && r.outcome === 'failed')item.suspended=true;}
  }
  for (const item of versions.values()) {
    // Skill bytes remain immutable. A new comparison can explicitly re-pin the
    // candidate's non-Skill source evidence, never its versioned Skill content.
    const sourcePins=item.candidate.pins.map(p => !item.candidate.request.files.includes(p.path) ? item.evaluation?.pins.find(x => x.path === p.path) ?? p : p);
    item.reasons.push(...await problems(target,sourcePins));
    if(!item.evaluation)item.reasons.push({code:'evaluation-required'});
    else {item.reasons.push(...await problems(target,item.evaluation.pins));if(!passing(item.evaluation))item.reasons.push({code:'evaluation-failed'});}
    if(!item.review || item.review.request.result !== 'accept')item.reasons.push({code:'independent-review-required'});
    else item.reasons.push(...await problems(target,item.review.pins));
    item.review_reasons=[...item.reasons];
    item.reviewed=item.review_reasons.length === 0;
    if(item.approval?.request.decision === 'reject')item.reasons.push({code:'approval-rejected'});
    if(item.approval) {
      item.reasons.push(...await problems(target,item.approval.pins));
      try {assertApprover(currentProject.policy,item.approval.request.actor);}catch {item.reasons.push({code:'approver-unavailable'});}
    }
    if(item.suspended)item.reasons.push({code:'suspended'});
    if(item.activation) {
      const b=item.activation.binding;
      if(b.evaluation_sha256 !== item.evaluation?.event_sha256 || b.review_sha256 !== item.review?.event_sha256 || b.approval_sha256 !== (item.approval?.event_sha256 ?? null))item.reasons.push({code:'revalidation-required'});
      item.reasons.push(...await problems(target,item.activation.pins));
      if(b.activation) {
        item.reasons.push(...await problems(target,[b.activation]));
        // Validate all copied files, including a resource changed after activation.
        try {
          const manifest=JSON.parse((await readTaskFile(target,b.activation.path)).content);item.reasons.push(...await problems(target,manifest.files));
          item.skill_files=manifest.files;
          item.entrypoint=manifest.files.find(pin=>pin.path===manifest.entrypoint)??null;
          if(!item.entrypoint)item.reasons.push({code:'activation-entrypoint-unavailable'});
        }
        catch {item.reasons.push({code:'activation-unavailable'});}
      }
      if(b.policy_sha256) {
        if(!policy?.request.enabled || policy.event_sha256 !== b.policy_sha256 || policy.request.expires_at && Date.parse(policy.request.expires_at) <= Date.now())item.reasons.push({code:'standing-policy-unavailable'});
        else {
          item.reasons.push(...await problems(target,policy.pins));
          try {assertApprover(currentProject.policy,policy.request.actor);}catch {item.reasons.push({code:'policy-approver-unavailable'});}
        }
      }
    }
    item.active=selected.get(item.skill_id) === key(item) && item.activation !== null && item.reasons.length === 0;
    item.effective_state=item.active?'active':item.suspended?'suspended':item.activation?'review-required':item.reviewed?(item.approval?.request.decision === 'approve'?'approved':'reviewed'):'candidate';
  }
  // An old/new comparison keeps the exact prior source and activation manifest
  // pinned, even when that baseline is no longer selected for current use.
  for(const item of versions.values()) if(item.evaluation?.request.comparison==='old-new') {
    const baseline=versions.get(`${item.skill_id}@${item.evaluation.request.baseline_version}`);
    if(!baseline || baseline.candidate.event_sha256!==item.evaluation.binding.baseline_sha256)fail('baseline binding mismatch');
    const priorPins=[...baseline.candidate.pins,...(baseline.activation?.binding.activation?[baseline.activation.binding.activation]:[])];
    if(baseline.activation?.binding.activation) {
      try {priorPins.push(...JSON.parse((await readTaskFile(target,baseline.activation.binding.activation.path)).content).files);}
      catch { /* The pinned manifest itself is reported unavailable below. */ }
    }
    const drift=await problems(target,priorPins);
    if(drift.length) {item.reasons.push({code:'baseline-stale',sources:drift});item.review_reasons.push({code:'baseline-stale'});item.reviewed=false;item.active=false;item.effective_state='review-required';}
  }
  for(const receipt of [...uses,...retrospectives])receipt.reasons=await problems(target,receipt.pins);
  const policyReasons=policy?await problems(target,policy.pins):[];
  if(policy)try {assertApprover(currentProject.policy,policy.request.actor);}catch {policyReasons.push({code:'policy-approver-unavailable'});}
  if(policy?.request.expires_at && Date.parse(policy.request.expires_at)<=Date.now())policyReasons.push({code:'policy-expired'});
  if(policy)policy={...policy,reasons:policyReasons,available:policy.request.enabled && !policyReasons.length};
  return {schema_version:'workkeel.skill-learning-view/v1',version:events.length,event_count:events.length,authority:'observation-only',mutation_status:'no-write',project_scope:'project-only',automatic_activation:policy?.available === true,policy,items:[...versions.values()],active:[...versions.values()].filter(i=>i.active),uses,retrospectives,provider_contact:false,host_discovery:'not-performed',quality_verified:false,
    limitations:['Comparisons and use outcomes are evidence-backed attributed reports; mechanics do not run models or prove unbiased routing.','Activation selects a project-local immutable manifest; host integration must explicitly load it.','Unsigned hash chains detect edits, not malicious rewriting of all history.']};
}
export async function listNativeSkillLifecycle(target) {return project(target,await history(target));}

async function activationFiles(target,item,env) {
  const destination=`${ACTIVATIONS}/${item.skill_id}/${item.version}`;
  if(!env.write_paths.some(root=>under(destination,root)))fail('activation outside approved write scope');
  const expected=new Set([...item.candidate.request.files.map(f=>`${destination}/${f.slice(item.candidate.request.skill_dir.length+1)}`),`${destination}/manifest.json`]);
  async function inventory(relative) {
    let dir;try {dir=await safeDirectory(target,relative);}catch(e){if(e.code==='ENOENT')return;throw e;}
    const names=await fs.readdir(dir);if(names.length>64)fail('activation inventory exceeds bound');
    for(const name of names) {
      const ref=`${relative}/${name}`,stat=await fs.lstat(path.join(dir,name));
      if(stat.isSymbolicLink())fail('activation contains symlink');
      if(stat.isDirectory()) {if(![...expected].some(f=>f.startsWith(`${ref}/`)))fail('unexpected activation directory');await inventory(ref);}
      else if(!stat.isFile() || !expected.has(ref))fail('unexpected activation file');
    }
  }
  await inventory(destination);
  const files=[];
  for(const original of item.candidate.request.files) {
    const source=await readTaskFile(target,original,{preserveBom:true});
    if(source.bytes_digest !== item.candidate.pins.find(p=>p.path===original)?.sha256)fail('Skill content changed; create a new version');
    const relative=original.slice(item.candidate.request.skill_dir.length+1), ref=`${destination}/${relative}`;
    // safeDirectory and readTaskFile enforce normalized paths and no symlinks.
    const dir=await safeDirectory(target,path.posix.dirname(ref),{create:true});
    try {await durableAtomicCreate(path.join(dir,path.posix.basename(ref)),source.content);}
    catch(e) {if(e.code!=='EEXIST' || (await readTaskFile(target,ref)).bytes_digest!==source.bytes_digest)throw e;}
    files.push({path:ref,sha256:source.bytes_digest});
  }
  const manifest={schema_version:'workkeel.local-skill-manifest/v1',project_scope:'project-only',skill_id:item.skill_id,version:item.version,candidate_sha256:item.candidate.event_sha256,entrypoint:`${destination}/SKILL.md`,files,host_discovery:'not-performed'};
  const manifestPath=`${destination}/manifest.json`, content=formatJson(manifest);
  const dir=await safeDirectory(target,destination,{create:true});
  try {await durableAtomicCreate(path.join(dir,'manifest.json'),content);}
  catch(e) {if(e.code!=='EEXIST' || (await readTaskFile(target,manifestPath)).bytes_digest!==sha256(content))throw e;}
  return {path:manifestPath,sha256:sha256(content)};
}

/** Every write is task-bound, serialized and append-only. Identity attribution is
 * checked against native policy; the embedding runtime supplies authentication. */
export async function mutateNativeSkillLifecycle(target,action,request) {
  shape(action,request);
  return withProjectMutationLock(target,async()=>{
    const task=await assertTaskExecutionContext(target,request.task_id,request),env=task.contract.environment;
    if(!task.contract.authorization.operations.includes('write') || !env.write_paths.some(root=>under(STORE,root)))fail('learning storage outside approved write scope');
    const events=await history(target), digest=executionDigest(request);
    const replay=events.find(e=>e.event.request.task_id===request.task_id && e.event.request.operation_id===request.operation_id);
    if(replay) {if(replay.event.action!==action || replay.event.request_sha256!==digest)fail('operation replay conflict');return {...replay,replayed:true,mutation_status:'already-applied'};}
    if(request.expected_version !== undefined && request.expected_version !== events.length)fail('stale expected version; inspect the latest lifecycle');
    if(events.length >= MAX_EVENTS)fail('event inventory limit');
    const view=await project(target,events),r=request,item=view.items.find(i=>key(i)===key(r));
    const b={candidate_sha256:item?.candidate.event_sha256??null,evaluation_sha256:item?.evaluation?.event_sha256??null,review_sha256:item?.review?.event_sha256??null,approval_sha256:item?.approval?.event_sha256??null,policy_sha256:null,baseline_sha256:null,activation:null};
    const policy=await readTaskProject(target);
    if(['policy','approve'].includes(action))assertApprover(policy.policy,r.actor);
    if(action==='policy' && r.expires_at && Date.parse(r.expires_at)<=Date.now())fail('policy already expired');
    if(!['candidate','policy','retrospective'].includes(action) && !item)fail('unknown Skill candidate');
    if(action==='candidate') {
      if(item)fail('Skill version already exists');
      const learning=await listNativeLearning(target);
      if(r.learning_ids.some(id=>!learning.items.some(i=>i.id===id && i.eligible)))fail('unknown or ineligible source learning');
      const skill=(await readTaskFile(target,`${r.skill_dir}/SKILL.md`,{preserveBom:true})).content;
      const frontmatter=skill.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
      if(!frontmatter || !new RegExp(`(?:^|\\n)name: ${r.skill_id}(?:\\r?\\n|$)`).test(frontmatter) || !/(?:^|\n)description: \S/.test(frontmatter))fail('Skill entrypoint requires matching name and nonempty routing description');
      if(r.files.some(f=>f.slice(r.skill_dir.length+1)==='manifest.json'))fail('manifest.json is reserved');
    }
    if(action==='evaluate') {
      if((await problems(target,item.candidate.pins.filter(p=>item.candidate.request.files.includes(p.path)))).length)fail('Skill content changed; create a new version');
      if(!item.candidate.request.evidence.every(ref=>r.evidence.includes(ref)))fail('comparison must explicitly re-pin every candidate source');
      if(r.comparison==='old-new') {
        const baseline=view.items.find(i=>i.skill_id===r.skill_id && i.version===r.baseline_version);
        if(!baseline?.activation || baseline.reasons.length)fail('baseline version unavailable or stale');
        b.baseline_sha256=baseline.candidate.event_sha256;
      }
    }
    if(action==='review') {
      if(!item.evaluation || (await problems(target,[...item.candidate.pins.filter(p=>item.candidate.request.files.includes(p.path)),...item.evaluation.pins])).length)fail('current comparison required');
      if(r.actor.agent_id===item.candidate.request.actor.agent_id || r.actor.agent_id===item.evaluation.request.actor.agent_id || policy.policy.review_separation==='distinct-principal' && [item.candidate.request.actor.principal_id,item.evaluation.request.actor.principal_id].includes(r.actor.principal_id))fail('independent review requires a distinct Agent and policy separation');
      if(r.result==='accept' && !passing(item.evaluation))fail('failed comparison cannot be accepted');
    }
    if(action==='approve' && r.decision==='approve' && (!item.reviewed || item.review?.request.result!=='accept'))fail('current independent accepted review required');
    if(['activate','revalidate','rollback'].includes(action)) {
      // Revalidation deliberately clears suspension after fresh comparison,
      // distinct review and approval. Ordinary activation cannot clear failure.
      const reasons=action==='revalidate'?item.review_reasons:item.reasons;
      if(reasons.length)fail('candidate requires current evaluation, independent review and evidence');
      if(action==='revalidate' && !item.activation || action==='rollback' && !item.activation)fail('previous activation required');
      if(action==='revalidate' && item.activation.binding.evaluation_sha256===item.evaluation.event_sha256)fail('fresh comparison required for revalidation');
      if(item.approval?.request.decision==='approve') {
        assertApprover(policy.policy,item.approval.request.actor);
        if((await problems(target,item.approval.pins)).length)fail('approval evidence is stale');
      }
      if(item.approval?.request.decision==='reject')fail('approval rejected');
      if(item.approval?.request.decision!=='approve') {
        const standing=view.policy;
        if(!standing?.available || item.candidate.request.risk_tier!=='low' || !standing.request.skill_ids.includes(r.skill_id) || standing.request.expires_at && Date.parse(standing.request.expires_at)<=Date.now() || !env.data.policy_refs.includes(standing.request.approval_ref) || (await problems(target,standing.pins)).length)fail('explicit approval required; standing policy is off or out of scope');
        b.policy_sha256=standing.event_sha256;
      }
    }
    if(action==='suspend' && !item.activation)fail('cannot suspend an unactivated version');
    if(action==='use') {
      if(r.stage!=='outcome' && !item.active)fail('only an active current Skill can be used');
      const preceding={read:'found',applied:'read',outcome:'applied'}[r.stage];
      if(preceding && !view.uses.some(e=>e.request.task_id===r.task_id && key(e.request)===key(r) && e.request.stage===preceding))fail('missing preceding use receipt');
      b.activation=item.activation?.binding.activation??null;
    }
    if(action==='retrospective') {
      const learning=await listNativeLearning(target);
      if(r.learning_ids.some(id=>!learning.items.some(i=>i.id===id && i.source_task===r.task_id)))fail('retrospective learning must be captured in this task');
      if(r.skill_versions.some(v=>!view.uses.some(e=>e.request.task_id===r.task_id && key(e.request)===key(v) && e.request.stage==='applied')))fail('retrospective Skill use requires an application receipt');
    }
    const pins=await pin(target,sources(action,r),env);
    if(['activate','revalidate','rollback'].includes(action))b.activation=await activationFiles(target,item,env);
    const event={schema_version:'workkeel.skill-learning-event/v1',sequence:events.length+1,previous_hash:events.at(-1)?.sha256??null,action,request:structuredClone(r),request_sha256:digest,at:new Date().toISOString(),pins,binding:b};
    const envelope={event,sha256:executionDigest(event)},content=formatJson(envelope);
    if(Buffer.byteLength(content)>1024*1024)fail('event exceeds bounded size');
    const dir=await safeDirectory(target,STORE,{create:true});
    await durableAtomicCreate(path.join(dir,`${String(event.sequence).padStart(6,'0')}.json`),content);
    return {...envelope,replayed:false,mutation_status:'applied'};
  });
}
