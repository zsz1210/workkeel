import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask,createNativeTask} from '../src/workkeel-tasks.mjs';
import {captureNativeLearning} from '../src/workkeel-learning.mjs';
import {prepareTaskMaterial,validateTaskMaterial} from '../src/workkeel-material.mjs';
import {codexSkillPolicy,assertCodexSkills} from '../src/workkeel-codex-host.mjs';
import {listNativeSkillLifecycle as list,mutateNativeSkillLifecycle as mutate} from '../src/workkeel-learning-lifecycle.mjs';

async function fixture(t,{writePaths=['.ai-org/learning/skill-lifecycle','.ai-org/learning/native','.agents/skills/workkeel-local']}={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'skill-lifecycle-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const builder={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'},guest={agent_id:'guest',principal_id:'guest-owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner','guest-owner'],agents:[builder,reviewer,guest],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs/proposed/1.0.0/references',{recursive:true});
  for(const [name,content] of Object.entries({approval:'Authorized fixture source and activation work.',source:'Observed task outcomes.',holdout:'An unseen positive request.',negative:'A neighboring request requiring no Skill.',baseline:'Baseline observed output.',candidate:'Candidate observed output.',review:'Independent reviewer accepts the exact comparison.',check:'Recorded bounded check.'}))await fs.writeFile(`${root}/docs/${name}.md`,content);
  const skill='\uFEFF---\nname: wire-contract\ndescription: Check external request schema mapping.\n---\nUse exact project evidence.\n';
  await fs.writeFile(root+'/docs/proposed/1.0.0/SKILL.md',skill);
  await fs.writeFile(root+'/docs/proposed/1.0.0/references/cases.md','授權範圍與完成條件\n');
  git('add','.');git('commit','-qm','Synthetic fixture');
  let current=null,n=0,serial=0;
  const switchActor=async(actor=builder)=>{
    if(current) {
      const task=await readNativeTask(root,current.task_id);
      await mutateNativeTask(root,current.task_id,'release',{operation_id:`release-${++serial}`,expected_version:task.version,actor:current.actor,claim_id:current.claim_id,summary:'Synthetic bounded work ended.'});
    }
    const id=`WK-learning-${++serial}`;
    const brief={schema_version:'workkeel.task-brief/v1',id,goal:'Evidence-backed project Skill fixture',actor,acceptance:['No inferred quality or global installation'],environment:{cwd:'.',read_paths:['docs','.agents/skills/workkeel-local'],write_paths:writePaths,tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
    if(actor.principal_id==='owner') {
      const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
    } else {
      const preview=await previewTaskIntake(root,{...brief,actor:builder});
      await createNativeTask(root,{...preview.contract,actor},preview.request);
    }
    await mutateNativeTask(root,id,'claim',{operation_id:`claim-${serial}`,expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
    const task=await readNativeTask(root,id);current={task_id:id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256};return current;
  };
  await switchActor();
  const req=fields=>({...current,operation_id:`event-${++n}`,...fields});
  const ref={skill_id:'wire-contract',version:'1.0.0'};
  const candidate=(version='1.0.0',risk='standard')=>({...ref,version,skill_dir:`docs/proposed/${version}`,files:[`docs/proposed/${version}/SKILL.md`,`docs/proposed/${version}/references/cases.md`],learning_ids:[],risk_tier:risk,trigger:'External schema mapping requests',non_trigger:'Local UI edits',authority:'Existing task authorization only',dependencies:[],provenance:'Original synthetic test procedure',evidence:['docs/source.md']});
  const outcome=(success,triggered)=>({success,triggered,evidence:[success?'docs/candidate.md':'docs/baseline.md']});
  const evaluation=(version='1.0.0')=>({...ref,version,comparison:'with-without',baseline_version:null,cases:[{id:'positive-holdout',kind:'holdout',input_ref:'docs/holdout.md',baseline:outcome(false,false),candidate:outcome(true,true)},{id:'nearby-negative',kind:'negative-trigger',input_ref:'docs/negative.md',baseline:outcome(true,false),candidate:outcome(true,false)}],evidence:['docs/source.md','docs/check.md']});
  const build=async(version='1.0.0',risk='standard')=>{await mutate(root,'candidate',req(candidate(version,risk)));await mutate(root,'evaluate',req(evaluation(version)));};
  const review=async(version='1.0.0')=>{await switchActor(reviewer);return mutate(root,'review',req({...ref,version,result:'accept',decision:'Exact candidate and comparative evidence inspected independently.',evidence:['docs/review.md']}));};
  const approve=async(version='1.0.0')=>{await switchActor(builder);return mutate(root,'approve',req({...ref,version,decision:'approve',evidence:['docs/approval.md']}));};
  const activate=async(version='1.0.0',action='activate')=>mutate(root,action,req({...ref,version,evidence:['docs/check.md']}));
  return {root,builder,reviewer,guest,req,ref,candidate,evaluation,build,review,approve,activate,switchActor,skill};
}

test('default off, exact comparative review and explicit approval create a local version manifest preserving bytes',async t=>{
  const f=await fixture(t);assert.equal((await list(f.root)).automatic_activation,false);
  await f.build();
  await assert.rejects(f.activate(),/independent review/);
  await assert.rejects(mutate(f.root,'review',f.req({...f.ref,result:'accept',decision:'Author self-review',evidence:['docs/review.md']})),/distinct Agent/);
  await f.review();await assert.rejects(f.activate(),/explicit approval/);
  await f.approve();const result=await f.activate();const view=await list(f.root);
  assert.equal(view.active.length,1);assert.equal(view.quality_verified,false);assert.equal(view.host_discovery,'not-performed');
  const manifest=JSON.parse(await fs.readFile(path.join(f.root,result.event.binding.activation.path),'utf8'));
  assert.equal(manifest.project_scope,'project-only');assert.equal(manifest.files.length,2);
  assert.deepEqual(view.active[0].entrypoint,manifest.files.find(pin=>pin.path===manifest.entrypoint));
  assert.equal(view.version,5);assert.equal(view.event_count,5);
  assert.equal(await fs.readFile(path.join(f.root,manifest.entrypoint),'utf8'),f.skill,'BOM and Unicode bytes survive activation');
  assert.equal(await fs.stat(f.root+'/.agents/skills/wire-contract').then(()=>true,()=>false),false,'no conventional global or unversioned install');
  assert.equal(await fs.stat(f.root+'/.ai-org/learning/index.json').then(()=>true,()=>false),false);
});

test('active project Skill enters a bounded task packet and resource drift invalidates reuse without inferring application',async t=>{
  const f=await fixture(t);await f.build();await f.review();await f.approve();await f.activate();
  const {task_id}=f.req({});const task=await readNativeTask(f.root,task_id);
  const request={kind:'initial',instruction:'Inspect external schema mapping',write_paths:task.contract.environment.write_paths,materials:[],learning_query:'external schema'};
  const packet=await prepareTaskMaterial(f.root,task.contract,request);
  const selected=packet.sources.filter(s=>s.purposes.includes('active-project-skill:wire-contract'));
  assert.equal(selected.length,1);assert.equal(selected[0].use,'reference');assert.deepEqual(task.contract.skills,[]);
  assert.equal((await list(f.root)).uses.length,0,'Discovery does not fabricate found/read/applied receipts');
  const unapproved=f.root+'/.agents/skills/workkeel-local/wire-contract/9.0.0/SKILL.md';await fs.mkdir(path.dirname(unapproved),{recursive:true});await fs.writeFile(unapproved,'Unapproved version');
  const skills=[{path:path.join(f.root,selected[0].path),enabled:true},{path:unapproved,enabled:true}];
  const rpc={request:async()=>({data:[{cwd:f.root,errors:[],skills}]})},hostPolicy=await codexSkillPolicy(rpc,f.root);
  assert.deepEqual(hostPolicy.enabledPaths,[skills[0].path]);assert.deepEqual(hostPolicy.disabledPaths,[unapproved]);
  skills[1].enabled=false;await assertCodexSkills(rpc,f.root,hostPolicy);
  await fs.appendFile(f.root+'/.agents/skills/workkeel-local/wire-contract/1.0.0/references/cases.md','Changed applicability.');
  await assert.rejects(assertCodexSkills(rpc,f.root,hostPolicy),/disabled Skill/);
  await assert.rejects(validateTaskMaterial(f.root,task.contract,packet,request.write_paths),/material changed/i);
  const refreshed=await prepareTaskMaterial(f.root,task.contract,request);
  assert.equal(refreshed.sources.some(s=>s.purposes.includes('active-project-skill:wire-contract')),false);
});

test('negative-trigger and holdout are mandatory and reported failure blocks independent acceptance',async t=>{
  const f=await fixture(t);await mutate(f.root,'candidate',f.req(f.candidate()));
  const evaluation=f.evaluation();
  await assert.rejects(mutate(f.root,'evaluate',f.req({...evaluation,cases:evaluation.cases.slice(0,1)})),/array|holdout/);
  const wrong=structuredClone(evaluation);wrong.cases[1].candidate.triggered=true;
  await mutate(f.root,'evaluate',f.req(wrong));await f.switchActor(f.reviewer);
  await assert.rejects(mutate(f.root,'review',f.req({...f.ref,result:'accept',decision:'Attempt to accept negative false trigger',evidence:['docs/review.md']})),/failed comparison/);
  assert.equal((await list(f.root)).items[0].reasons.some(r=>r.code==='evaluation-failed'),true);
  await mutate(f.root,'review',f.req({...f.ref,result:'reject',decision:'Negative request falsely selects Skill',evidence:['docs/review.md']}));
});

test('equal baseline and candidate results cannot claim a demonstrated improvement',async t=>{
  const f=await fixture(t);await mutate(f.root,'candidate',f.req(f.candidate()));
  const comparison=f.evaluation();comparison.cases[0].baseline=structuredClone(comparison.cases[0].candidate);
  await mutate(f.root,'evaluate',f.req(comparison));await f.switchActor(f.reviewer);
  await assert.rejects(mutate(f.root,'review',f.req({...f.ref,result:'accept',decision:'All cases pass equally',evidence:['docs/review.md']})),/failed comparison/);
  assert.equal((await list(f.root)).items[0].reasons.some(r=>r.code==='evaluation-failed'),true);
});

test('a scoped standing policy is explicit, low-risk only, pinned and revocable',async t=>{
  const f=await fixture(t);await f.build('1.0.0','low');await f.review();await f.switchActor(f.builder);
  await mutate(f.root,'policy',f.req({enabled:true,skill_ids:['wire-contract'],approval_ref:'docs/approval.md',expires_at:null}));
  await f.activate();assert.equal((await list(f.root)).active.length,1);
  await mutate(f.root,'policy',f.req({enabled:false,skill_ids:['wire-contract'],approval_ref:'docs/approval.md',expires_at:null}));
  assert.equal((await list(f.root)).active.length,0);
  const g=await fixture(t);await g.build();await g.review();await g.switchActor(g.builder);
  await mutate(g.root,'policy',g.req({enabled:true,skill_ids:['wire-contract'],approval_ref:'docs/approval.md',expires_at:null}));
  await assert.rejects(g.activate(),/explicit approval/);
  await g.switchActor(g.guest);
  await assert.rejects(mutate(g.root,'policy',g.req({enabled:true,skill_ids:['wire-contract'],approval_ref:'docs/approval.md',expires_at:null})),/approving Principal/);
});

test('use receipts and task retrospective are explicit; failed outcomes suspend until a fresh reviewed revalidation',async t=>{
  const f=await fixture(t);await f.build();await f.review();await f.approve();await f.activate();
  const receipt=(stage,outcome=null)=>f.req({...f.ref,stage,outcome,decision:'Explicit synthetic action receipt',evidence:['docs/check.md']});
  await assert.rejects(mutate(f.root,'use',receipt('applied')),/preceding/);
  for(const stage of ['found','read','applied'])await mutate(f.root,'use',receipt(stage));
  await mutate(f.root,'retrospective',f.req({decision:'no-new-learning',learning_ids:[],skill_versions:[f.ref],summary:'No reusable new lesson from the bounded task.',evidence:['docs/check.md']}));
  await mutate(f.root,'use',receipt('outcome','failed'));assert.equal((await list(f.root)).active.length,0);
  await assert.rejects(f.activate(),/current evaluation/);
  await assert.rejects(f.activate('1.0.0','revalidate'),/fresh comparison/);
  await mutate(f.root,'evaluate',f.req(f.evaluation()));await f.review();await f.approve();await f.activate('1.0.0','revalidate');
  const view=await list(f.root);assert.equal(view.active.length,1);assert.equal(view.retrospectives[0].request.decision,'no-new-learning');assert.equal(view.uses.at(-1).request.outcome,'failed','history retains original failure');
});

test('changed Skill bytes require a new version; changed non-Skill evidence requires complete revalidation',async t=>{
  const f=await fixture(t);await f.build();await f.review();await f.approve();await f.activate();
  await fs.writeFile(f.root+'/docs/source.md','Updated actual outcomes.');assert.equal((await list(f.root)).active.length,0);
  await assert.rejects(mutate(f.root,'evaluate',f.req({...f.evaluation(),evidence:['docs/check.md']})),/every candidate source/);
  await mutate(f.root,'evaluate',f.req(f.evaluation()));await f.review();await f.approve();await f.activate('1.0.0','revalidate');assert.equal((await list(f.root)).active.length,1);
  await fs.appendFile(f.root+'/docs/proposed/1.0.0/SKILL.md','Changed behavior.');
  await assert.rejects(mutate(f.root,'evaluate',f.req(f.evaluation())),/new version/);
  assert.equal((await list(f.root)).active.length,0);
});

test('old-new comparative evaluation and rollback select exact approved prior version without rewriting history',async t=>{
  const f=await fixture(t);await f.build();await f.review();await f.approve();await f.activate();
  await fs.cp(f.root+'/docs/proposed/1.0.0',f.root+'/docs/proposed/2.0.0',{recursive:true});
  await fs.appendFile(f.root+'/docs/proposed/2.0.0/SKILL.md','Narrow updated completion procedure.');
  await mutate(f.root,'candidate',f.req(f.candidate('2.0.0')));
  await mutate(f.root,'evaluate',f.req({...f.evaluation('2.0.0'),comparison:'old-new',baseline_version:'1.0.0'}));
  await f.review('2.0.0');await f.approve('2.0.0');await f.activate('2.0.0');
  assert.equal((await list(f.root)).active[0].version,'2.0.0');
  await f.activate('1.0.0','rollback');assert.equal((await list(f.root)).active[0].version,'1.0.0');
  await mutate(f.root,'suspend',f.req({...f.ref,decision:'Counterexample needs investigation',evidence:['docs/check.md']}));
  assert.equal((await list(f.root)).active.length,0);
  assert.equal((await list(f.root)).items.length,2);
  await fs.writeFile(f.root+'/.agents/skills/workkeel-local/wire-contract/1.0.0/references/cases.md','Old comparator resource drift.');
  const view=await list(f.root);
  assert.equal(view.items.find(i=>i.version==='2.0.0').reasons.some(r=>r.code==='baseline-stale'),true,'new version cannot retain a current comparison when old bytes drift');
});

test('activation scope and preexisting files cannot be bypassed; a captured retrospective references actual same-task learning',async t=>{
  const denied=await fixture(t,{writePaths:['.ai-org/learning/skill-lifecycle','.ai-org/learning/native']});
  await denied.build();await denied.review();await denied.approve();await assert.rejects(denied.activate(),/activation outside approved write scope/);
  const f=await fixture(t);await f.build();await f.review();await f.approve();
  const destination=f.root+'/.agents/skills/workkeel-local/wire-contract/1.0.0';await fs.mkdir(destination,{recursive:true});await fs.writeFile(destination+'/unexpected.txt','Existing owned file.');
  await assert.rejects(f.activate(),/unexpected activation file/);
  assert.equal(await fs.readFile(destination+'/unexpected.txt','utf8'),'Existing owned file.');assert.equal((await list(f.root)).active.length,0);
  await assert.rejects(mutate(f.root,'retrospective',f.req({decision:'captured',learning_ids:['LESSON-missing'],skill_versions:[],summary:'A claimed new learning',evidence:['docs/check.md']})),/captured in this task/);
  await captureNativeLearning(f.root,f.req({record:{id:'LESSON-boundary',kind:'lesson',title:'A bounded observed issue',summary:'One source-backed observation.',applicability:'This exact fixture.',exclusions:'No general quality claim.',aliases:[],derived_from:[],evidence:['docs/source.md'],skill_refs:[]}}));
  await mutate(f.root,'retrospective',f.req({decision:'captured',learning_ids:['LESSON-boundary'],skill_versions:[],summary:'Source-backed lesson captured; quality remains pending.',evidence:['docs/check.md']}));
  assert.equal((await list(f.root)).retrospectives[0].request.learning_ids[0],'LESSON-boundary');
});

test('task authority, sparse arrays, evidence traversal, symlinks, scope and replay fail closed',async t=>{
  const f=await fixture(t),request=f.req({...f.candidate(),expected_version:0});
  for(const patch of [{claim_id:'wrong'},{actor:f.reviewer},{contract_sha256:'0'.repeat(64)}])await assert.rejects(mutate(f.root,'candidate',{...request,...patch}));
  for(const ref of ['../outside','docs/../source.md','/tmp/source.md'])await assert.rejects(mutate(f.root,'candidate',{...request,evidence:[ref]}));
  const sparse=new Array(2);sparse[1]='docs/source.md';await assert.rejects(mutate(f.root,'candidate',{...request,evidence:sparse}),/sparse/);
  await fs.symlink(f.root+'/docs/source.md',f.root+'/docs/link.md');await assert.rejects(mutate(f.root,'candidate',{...request,evidence:['docs/link.md']}),/symlink/);
  const result=await mutate(f.root,'candidate',request);assert.equal((await mutate(f.root,'candidate',request)).replayed,true);
  await assert.rejects(mutate(f.root,'candidate',{...request,operation_id:'fresh-stale-operation'}),/stale expected version/);
  assert.equal((await list(f.root)).version,1);
  await assert.rejects(mutate(f.root,'candidate',{...request,trigger:'Changed trigger'}),/replay conflict/);
  await f.switchActor();await assert.rejects(mutate(f.root,'candidate',request),/matching implementation claim/);
  assert.equal(result.event.sequence,1);
  const denied=await fixture(t,{writePaths:['docs']});await assert.rejects(mutate(denied.root,'candidate',denied.req(denied.candidate())),/write scope/);
});

test('copied resource drift and envelope tampering invalidate selection; cross-process writes retain a contiguous hash chain',async t=>{
  const f=await fixture(t);await f.build();await f.review();await f.approve();await f.activate();
  await fs.writeFile(f.root+'/.agents/skills/workkeel-local/wire-contract/1.0.0/references/cases.md','Drifted activated resource.');
  assert.equal((await list(f.root)).active.length,0);
  const file=f.root+'/.ai-org/learning/skill-lifecycle/000001.json',record=JSON.parse(await fs.readFile(file,'utf8'));
  record.event.request.trigger='Tampered';await fs.writeFile(file,JSON.stringify(record));await assert.rejects(list(f.root),/integrity/);
  const g=await fixture(t),module=fileURLToPath(new URL('../src/workkeel-learning-lifecycle.mjs',import.meta.url));
  const script='const [module,root,request]=process.argv.slice(1); const {mutateNativeSkillLifecycle}=await import(module); await mutateNativeSkillLifecycle(root,"candidate",JSON.parse(request));';
  const exec=promisify(execFile);
  const requests=[];
  for(const i of [0,1]) {
    const dir=`docs/concurrent-${i}`;await fs.mkdir(`${g.root}/${dir}`);
    await fs.writeFile(`${g.root}/${dir}/SKILL.md`,g.skill.replace('name: wire-contract',`name: wire-contract-${i}`));
    requests.push(g.req({...g.candidate(),skill_id:`wire-contract-${i}`,skill_dir:dir,files:[`${dir}/SKILL.md`]}));
  }
  await Promise.all(requests.map(request=>exec(process.execPath,['--input-type=module','-e',script,module,g.root,JSON.stringify(request)])));
  assert.equal((await list(g.root)).items.length,2);
});
