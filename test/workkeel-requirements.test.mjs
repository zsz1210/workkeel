import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {createNativeTask, mutateNativeTask, readNativeTask, assertTaskExecutionContext} from '../src/workkeel-tasks.mjs';
import {loadTaskRequirements, assertRequirementAlignment, assertRequirementAssessment} from '../src/workkeel-requirements.mjs';
import {checkEvidenceFile} from '../src/workkeel-evidence-file.mjs';
import {crc32,deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {prepareTaskMaterial} from '../src/workkeel-material.mjs';
import {readTaskFile} from '../src/task-contract.mjs';
import {previewTaskIntake} from '../src/workkeel-intake.mjs';

const actor={agent_id:'builder',principal_id:'owner'}, reviewer={agent_id:'reviewer',principal_id:'owner'};
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function fixture(t,{create=true,visual=false,superseded=false}={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'wk-requirements-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  git(root,'init','-q');git(root,'config','user.name','Fixture');git(root,'config','user.email','fixture@example.invalid');
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer],approvers:['owner'],review_separation:'distinct-agent',requirements_refs:['docs/requirements.json']});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');await fs.mkdir(root+'/.workkeel-private');
  await fs.writeFile(root+'/.gitignore','.workkeel-private/\n');
  await fs.writeFile(root+'/docs/original.md','Synthetic user decision: show the official product mark. Later decision: use a quiet layout.\n');
  await fs.writeFile(root+'/docs/approval.md','Synthetic local task approval only.');
  const source={path:'docs/original.md',sha256:(await readTaskFile(root,'docs/original.md')).bytes_digest,quote:'show the official product mark'};
  const requirement={id:'R-brand',criterion:'Show the official product mark',paths:['src'],sources:[source],superseded_by:null,visual};
  const bundle={schema_version:'workkeel.requirements/v1',id:'product',requirements:[requirement]};
  if(superseded)bundle.requirements.unshift({...requirement,id:'R-old',criterion:'Use the old decorative mark',superseded_by:'R-brand'});
  await fs.writeFile(root+'/docs/requirements.json',JSON.stringify(bundle));await fs.writeFile(root+'/src/ui.mjs','export const official=true;\n');
  const contract={schema_version:'workkeel.task-contract/v2',id:'WK-fidelity',goal:'Preserve approved identity',state:'intake',scope:{include:['UI'],exclude:['Publication']},actor,dependencies:[],acceptance:{criteria:[requirement.criterion],evidence:[]},handoff:null,verification:{risk_tier:'standard',separation:'distinct-agent',implementer:null,reviewer:null,candidate_revision:null},environment:{cwd:'.',read_paths:['.'],write_paths:['src/ui.mjs'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md','docs/requirements.json']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null},skills:[],execution:{runtime:{kind:'host-owned',adapter_id:null,required_features:[]},model_connection:{kind:'native'}}};
  git(root,'add','.');git(root,'commit','-qm','Synthetic requirement fixture');
  const candidate=git(root,'rev-parse','HEAD');
  if(create){await createNativeTask(root,contract,{operation_id:'create',expected_version:0,actor});await mutateNativeTask(root,contract.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:candidate});}
  return {root,contract,candidate,bundle,source};
}
async function proof(f,phase='delivery') {
  const task=await readNativeTask(f.root,f.contract.id),set=await loadTaskRequirements(f.root,task.contract),evidenceRef='.workkeel-private/'+phase+'.txt';
  await fs.writeFile(f.root+'/'+evidenceRef,'Synthetic observed output; not a live UI acceptance.');
  const evidence={path:evidenceRef,sha256:(await readTaskFile(f.root,evidenceRef)).bytes_digest,kind:'observation'};
  const report={schema_version:'workkeel.requirement-outcomes/v1',task_id:task.id,contract_sha256:task.contract_sha256,candidate_revision:f.candidate,requirements_sha256:set.sha256,phase,actor:phase==='review'?reviewer:actor,requirements:set.applicable.map(r=>({id:r.id,status:'pass',observation:'Synthetic fixture matches original decision',sources:r.sources.map(({path,sha256})=>({path,sha256})),evidence:[evidence]})),open_findings:[]};
  const ref='.workkeel-private/'+phase+'.json';await fs.writeFile(f.root+'/'+ref,JSON.stringify(report));
  return {ref,report,evidence};
}
async function handoff(f,p) {const task=await readNativeTask(f.root,f.contract.id);return mutateNativeTask(f.root,task.id,'handoff',{operation_id:'deliver',expected_version:task.version,actor,claim_id:task.claim.id,revision:f.candidate,summary:'Synthetic delivery',evidence:[p.ref],unresolved:[]});}
async function review(f,p,judgment='pass') {const task=await readNativeTask(f.root,f.contract.id);return mutateNativeTask(f.root,task.id,'review',{operation_id:'review-'+judgment,expected_version:task.version,actor:reviewer,revision:f.candidate,judgment,summary:'Actual synthetic reviewer assertion',evidence:[p.ref]});}

test('intake and direct creation reject omitted criterion and complete-bundle omission',async t=>{
  const f=await fixture(t,{create:false});f.contract.acceptance.criteria=['Unrelated green test'];
  await assert.rejects(createNativeTask(f.root,f.contract,{operation_id:'create',expected_version:0,actor}),/approved requirement omitted/);
  const brief={schema_version:'workkeel.task-brief/v1',id:f.contract.id,goal:f.contract.goal,actor,acceptance:f.contract.acceptance.criteria,environment:f.contract.environment,authorization:f.contract.authorization};
  await assert.rejects(previewTaskIntake(f.root,brief),/approved requirement omitted/);
  f.contract.environment.data.policy_refs=['docs/approval.md'];
  await assert.rejects(createNativeTask(f.root,f.contract,{operation_id:'create',expected_version:0,actor}),/Required project decision source omitted/);
});
test('material requires explicit alignment and automatically includes original decisions',async t=>{
  const f=await fixture(t),set=await loadTaskRequirements(f.root,f.contract);
  assert.throws(()=>assertRequirementAlignment(set,[{id:'R-brand',status:'conflict',observation:'Brief forbids the required mark'}]),/conflict/);
  const input={kind:'initial',instruction:'Implement approved UI',write_paths:['src/ui.mjs'],materials:[]};
  await assert.rejects(prepareTaskMaterial(f.root,f.contract,input),/alignment/);
  input.requirements_alignment=[{id:'R-brand',status:'aligned',observation:'Compared original decision with implementation scope'}];
  const packet=await prepareTaskMaterial(f.root,f.contract,input);
  assert.ok(packet.sources.some(s=>s.path==='docs/original.md'&&s.use==='required'));assert.match(packet.prompt,/show the official product mark/);
  await fs.appendFile(f.root+'/docs/original.md','changed');
  const task=await readNativeTask(f.root,f.contract.id);
  await assert.rejects(assertTaskExecutionContext(f.root,task.id,{actor,claim_id:task.claim.id}),/original decision source changed/);
});
test('legitimate supersession preserves history; broken targets and cycles fail',async t=>{
  const f=await fixture(t,{create:false,superseded:true}),set=await loadTaskRequirements(f.root,f.contract);
  assert.deepEqual(set.applicable.map(r=>r.id),['R-brand']);assert.equal(set.requirements.length,2);
  f.bundle.requirements[1].superseded_by='R-old';await fs.writeFile(f.root+'/docs/requirements.json',JSON.stringify(f.bundle));
  await assert.rejects(loadTaskRequirements(f.root,f.contract),/supersession/);
  f.bundle.requirements[1].superseded_by='R-missing';await fs.writeFile(f.root+'/docs/requirements.json',JSON.stringify(f.bundle));
  await assert.rejects(loadTaskRequirements(f.root,f.contract),/supersession/);
});
test('direct handoff cannot use green unrelated tests or partial requirement evidence',async t=>{
  const f=await fixture(t),p=await proof(f);await fs.writeFile(f.root+'/.workkeel-private/checks.txt','All unrelated tests pass');
  await assert.rejects(handoff(f,{ref:'.workkeel-private/checks.txt'}),/outcome report/);
  p.report.requirements[0].status='partial';await fs.writeFile(f.root+'/'+p.ref,JSON.stringify(p.report));
  await assert.rejects(handoff(f,p),/not passing/);
  assert.equal((await readNativeTask(f.root,f.contract.id)).state,'build');
});
test('independent passing review needs its own source-bound observations; failed review remains recordable',async t=>{
  const f=await fixture(t),p=await proof(f);await handoff(f,p);
  await assert.rejects(review(f,p),/review requirement outcome/);
  const r=await proof(f,'review');r.report.actor=actor;await fs.writeFile(f.root+'/'+r.ref,JSON.stringify(r.report));
  await assert.rejects(review(f,r),/actor or candidate/);
  await review(f,p,'fail');assert.equal((await readNativeTask(f.root,f.contract.id)).review.judgment,'fail');
});
test('close rechecks nested evidence; stale screenshots and reports cannot be reused',async t=>{
  const f=await fixture(t),p=await proof(f);await handoff(f,p);const r=await proof(f,'review');await review(f,r);
  await fs.appendFile(f.root+'/'+p.evidence.path,'changed after review');const task=await readNativeTask(f.root,f.contract.id);
  await assert.rejects(mutateNativeTask(f.root,task.id,'close',{operation_id:'close',expected_version:task.version,actor,revision:f.candidate,summary:'Close synthetic task',rollback:'Revert',evidence:[r.ref]}),/digest mismatch/);
  assert.equal((await readNativeTask(f.root,task.id)).state,'release_gate');
});
test('visual criteria require actual screenshot bytes, not an unrelated passing check',async t=>{
  const f=await fixture(t,{visual:true}),p=await proof(f);
  await assert.rejects(handoff(f,p),/visual evidence missing/);
  p.report.requirements[0].evidence[0].kind='screenshot';await fs.writeFile(f.root+'/'+p.ref,JSON.stringify(p.report));
  await assert.rejects(handoff(f,p),/supported PNG/);
});
test('assessment with artifact-only writes retains sources without claiming product fulfillment',async t=>{
  const f=await fixture(t,{create:false});f.contract.environment.write_paths=['.ai-org/artifacts/discovery'];f.contract.acceptance.criteria=['Assess source-pinned findings'];
  const set=await loadTaskRequirements(f.root,f.contract);assert.equal(set.active.length,1);assert.equal(set.applicable.length,0);
  f.contract.environment.write_paths=['src'];await assert.rejects(loadTaskRequirements(f.root,f.contract),/omitted/);
});

test('BOM bundles remain guarded and project-required sources cannot become ordinary prose',async t=>{
  const f=await fixture(t,{create:false});
  await fs.writeFile(f.root+'/docs/requirements.json','\uFEFF'+JSON.stringify(f.bundle));
  assert.equal((await loadTaskRequirements(f.root,f.contract)).applicable.length,1);
  f.contract.acceptance.criteria=[];
  await assert.rejects(loadTaskRequirements(f.root,f.contract),/omitted/);
  f.contract.acceptance.criteria=['Show the official product mark'];
  await createNativeTask(f.root,f.contract,{operation_id:'bom',expected_version:0,actor});
  await fs.writeFile(f.root+'/docs/requirements.json','not a requirement bundle');
  await assert.rejects(loadTaskRequirements(f.root,f.contract,{requiredRefs:['docs/requirements.json']}),/no valid requirement bundle/);
});
test('fresh independent review cannot conceal stale nested delivery evidence',async t=>{
  const f=await fixture(t),p=await proof(f);await handoff(f,p);
  await fs.appendFile(f.root+'/'+p.evidence.path,'different bytes');
  const r=await proof(f,'review');
  await assert.rejects(review(f,r),/digest mismatch/);
  assert.equal((await readNativeTask(f.root,f.contract.id)).state,'test');
});
test('complete source-bound delivery and distinct review can close the exact candidate',async t=>{
  const f=await fixture(t),p=await proof(f);await handoff(f,p);const r=await proof(f,'review');await review(f,r);
  const task=await readNativeTask(f.root,f.contract.id);
  await mutateNativeTask(f.root,task.id,'close',{operation_id:'close',expected_version:task.version,actor,revision:f.candidate,summary:'Synthetic complete coverage',rollback:'Revert fixture',evidence:[r.ref]});
  assert.equal((await readNativeTask(f.root,task.id)).state,'done');
});
test('discovery must assess original decisions and cannot silently discard an unknown finding',async t=>{
  const f=await fixture(t,{create:false});f.contract.environment.write_paths=['.ai-org/artifacts/WK-fidelity/discovery'];f.contract.acceptance.criteria=['Assess'];
  await assert.rejects(assertRequirementAssessment(f.root,f.contract,{proposals:[]}),/every active/);
  const assessment={id:'R-brand',status:'unverified',observation:'Source exists, actual browser evidence unavailable',sources:[{path:f.source.path,sha256:f.source.sha256}],evidence:[],proposal_id:null};
  const report={proposals:[],requirement_assessments:[assessment]};
  await assert.rejects(assertRequirementAssessment(f.root,f.contract,report),/linked proposal/);
  assessment.proposal_id='inspect-brand';report.proposals=[{id:'inspect-brand'}];
  const pins=await assertRequirementAssessment(f.root,f.contract,report);assert.ok(pins.some(p=>p.path===f.source.path));
  assessment.status='observed-satisfied';assessment.proposal_id=null;
  await assert.rejects(assertRequirementAssessment(f.root,f.contract,report),/actual evidence/);
  assessment.status='not-applicable';assessment.observation='Only a documentation appendix is inspected in this bounded discovery.';
  await assertRequirementAssessment(f.root,f.contract,report);
});
test('evidence rejects empty files and corrupt PNGs while allowing a complete RGB screenshot',async t=>{
  const f=await fixture(t),ref='.workkeel-private/image.png';
  const check=async bytes=>{await fs.writeFile(f.root+'/'+ref,bytes);return checkEvidenceFile(f.root,['.'],f.contract.id,{path:ref,sha256:createHash('sha256').update(bytes).digest('hex'),kind:'screenshot'});};
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  const chunk=(type,bytes)=>{const out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);out.write(type,4);bytes.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  const png=Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(5))),chunk('IEND',Buffer.alloc(0))]);
  await assert.rejects(check(Buffer.alloc(0)),/empty/);
  await assert.rejects(check(signature),/supported PNG/);
  await assert.rejects(check(png.subarray(0,-1)),/supported PNG/);
  const corrupt=Buffer.from(png);corrupt[29]^=1;await assert.rejects(check(corrupt),/supported PNG/);
  assert.equal(await check(png),true);
});
