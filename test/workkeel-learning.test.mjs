import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {captureNativeLearning as capture,reviewNativeLearning as review,recordNativeLearningUse as use,listNativeLearning as list,searchNativeLearning as search,nativeLearningImpact as impact} from '../src/workkeel-learning.mjs';

async function fixture(t,{writable=true}={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'native-learning-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,{agent_id:'reviewer',principal_id:'owner'}],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.writeFile(root+'/docs/approval.md','Authorized bounded fixture.');
  await fs.writeFile(root+'/docs/evidence.md','Independent contract check: field maps to read-only.');
  await fs.writeFile(root+'/docs/check.md','The actual fixture contract check passed.');
  await fs.mkdir(root+'/docs/example');await fs.writeFile(root+'/docs/example/SKILL.md','Existing example only.');
  git('add','.');git('commit','-qm','Fixture');
  const makeTask=async taskId=>{
    const brief={schema_version:'workkeel.task-brief/v1',id:taskId,goal:'Bounded learning reuse',actor,acceptance:['Evidence remains scoped'],
      environment:{cwd:'.',read_paths:['docs'],write_paths:writable?['.ai-org/learning/native']:['docs'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md']}},
      authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
    const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
    await mutateNativeTask(root,taskId,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
    const task=await readNativeTask(root,taskId);
    return {task_id:taskId,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256};
  };
  const auth=await makeTask('WK-learning');let n=0;
  const req=fields=>({...auth,operation_id:`op-${++n}`,...fields});
  const record=(id='LESSON-native')=>({id,kind:'lesson',title:'External wire contracts',summary:'Check deployed schema and map internal values.',applicability:'External request fields for the examined version',exclusions:'No universal guarantee for responses or other services',aliases:['外部介面','外部契約','wire contract'],derived_from:[],evidence:['docs/evidence.md'],skill_refs:[]});
  const confirmed=learning_id=>req({learning_id,result:'confirmed',decision:'Scoped fixture evidence inspected',evidence:['docs/check.md'],adopt:false});
  return {root,auth,req,record,confirmed,makeTask};
}

test('isolated candidates, explicit confirmation, multilingual discovery and unrelated queries',async t=>{
  const f=await fixture(t);assert.deepEqual((await list(f.root)).items,[]);
  const request=f.req({record:f.record()});const first=await capture(f.root,request);
  assert.equal((await capture(f.root,request)).replayed,true);
  await assert.rejects(capture(f.root,{...request,record:{...request.record,title:'Different'}}),/replay conflict/);
  assert.equal((await search(f.root,{query:'wire contract'})).items.length,0);
  await review(f.root,f.confirmed('LESSON-native'));
  for(const query of ['wire contract','外部介面如何檢查','外部契約を確認する'])assert.equal((await search(f.root,{query})).items[0].id,'LESSON-native');
  assert.equal((await search(f.root,{query:'banana gardening'})).items.length,0);
  assert.equal((await readNativeTask(f.root,f.auth.task_id)).version,2);
  assert.equal(await fs.stat(f.root+'/.ai-org/learning/index.json').then(()=>true,()=>false),false);
  assert.equal(first.event.pins[0].path,'docs/evidence.md');
});

test('transitive impact excludes contradicted and stale ancestors and traces linked Skills and use history',async t=>{
  const f=await fixture(t);await capture(f.root,f.req({record:f.record()}));await review(f.root,f.confirmed('LESSON-native'));
  await capture(f.root,f.req({record:{...f.record('PRACTICE-native'),kind:'practice',derived_from:['LESSON-native'],skill_refs:['docs/example/SKILL.md']}}));
  await review(f.root,{...f.confirmed('PRACTICE-native'),adopt:true});
  await capture(f.root,f.req({record:{...f.record('PRACTICE-child'),kind:'practice',derived_from:['PRACTICE-native']}}));
  await review(f.root,{...f.confirmed('PRACTICE-child'),adopt:true});
  assert.equal((await search(f.root,{query:'外部介面'})).items.length,3);
  await review(f.root,{...f.confirmed('LESSON-native'),result:'contradicted'});
  assert.equal((await search(f.root,{query:'外部介面'})).items.length,0);
  let result=await impact(f.root,{source:'docs/evidence.md'});assert.equal(result.items.length,3);assert.equal(result.skills.length,1);assert.equal(result.historical_acceptance_changed,false);
  assert.equal(result.items[2].reasons[0].code,'ancestor-ineligible');
  await review(f.root,f.confirmed('LESSON-native'));await fs.writeFile(f.root+'/docs/evidence.md','Changed contract.');
  result=await list(f.root);assert.equal(result.items[0].effective_state,'review-required');assert.equal((await search(f.root,{query:'wire contract'})).items.length,0);
  await review(f.root,f.confirmed('LESSON-native'));
  assert.equal((await list(f.root)).items[0].eligible,false,'partial evidence does not repin');
  const original=result.items[0].pins[0].sha256;
  await review(f.root,{...f.confirmed('LESSON-native'),evidence:['docs/evidence.md','docs/check.md']});
  result=await list(f.root);assert.equal(result.items[0].eligible,true);assert.equal(result.items[0].pins[0].sha256,original);
  assert.notEqual(result.items[0].current_pins[0].sha256,original);assert.ok(result.items[0].captured_at);
  assert.equal(result.items[1].eligible,false,'descendant source remains stale pending its own review');
  await fs.unlink(f.root+'/docs/evidence.md');assert.equal((await list(f.root)).items[0].reasons[0].code,'unknown-evidence');
});

test('actual use stages and verified outcomes are separate; promotion requires two distinct evidenced tasks',async t=>{
  const f=await fixture(t);await capture(f.root,f.req({record:f.record()}));await review(f.root,f.confirmed('LESSON-native'));
  await capture(f.root,f.req({record:{...f.record('PRACTICE-native'),kind:'practice',derived_from:['LESSON-native']}}));await review(f.root,{...f.confirmed('PRACTICE-native'),adopt:true});
  const fact=(stage,outcome=null)=>f.req({learning_id:'PRACTICE-native',stage,decision:'Explicit fixture action',evidence:['docs/check.md'],outcome});
  await assert.rejects(use(f.root,fact('applied')),/preceding/);
  for(const stage of ['found','read','applied'])await use(f.root,fact(stage));
  assert.equal((await list(f.root)).items[1].promotion.distinct_actual_tasks,0);
  await use(f.root,fact('outcome','verified'));
  assert.equal((await list(f.root)).items[1].promotion.eligible,false);
  await mutateNativeTask(f.root,f.auth.task_id,'release',{operation_id:'release',expected_version:2,actor:f.auth.actor,claim_id:f.auth.claim_id,summary:'Fixture use recorded'});
  await assert.rejects(use(f.root,fact('found')),/matching implementation claim/);
  const other=await f.makeTask('WK-reuse');
  for(const stage of ['found','read','applied','outcome'])await use(f.root,{...fact(stage,stage==='outcome'?'verified':null),...other});
  assert.equal((await list(f.root)).items[1].promotion.eligible,true);
  await use(f.root,{...fact('outcome','failed'),...other});assert.equal((await list(f.root)).items[1].promotion.eligible,false);
});

test('current actor, claim, scope, safe paths, unknown refs, and immutable storage are enforced',async t=>{
  const f=await fixture(t),request=f.req({record:f.record()});
  for(const patch of [{actor:{agent_id:'reviewer',principal_id:'owner'}},{claim_id:'wrong'},{contract_sha256:'0'.repeat(64)}])await assert.rejects(capture(f.root,{...request,...patch}));
  for(const ref of ['../outside','/tmp/outside','docs/../docs/evidence.md'])await assert.rejects(capture(f.root,{...request,record:{...request.record,evidence:[ref]}}));
  await fs.symlink(f.root+'/docs/evidence.md',f.root+'/docs/link.md');await assert.rejects(capture(f.root,{...request,record:{...request.record,evidence:['docs/link.md']}}),/symlink/);
  await assert.rejects(capture(f.root,{...request,record:{...request.record,derived_from:['missing']}}),/unknown or cyclic/);
  await assert.rejects(review(f.root,f.confirmed('missing')),/unknown learning/);
  const denied=await fixture(t,{writable:false});await assert.rejects(capture(denied.root,denied.req({record:denied.record()})),/write scope/);
  await capture(f.root,request);
  const name=f.root+'/.ai-org/learning/native/000001.json';const saved=JSON.parse(await fs.readFile(name,'utf8'));saved.event.request.record.title='Tampered';await fs.writeFile(name,JSON.stringify(saved));
  await assert.rejects(list(f.root),/integrity/);
});
