import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {sha256} from '../src/files.mjs';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {captureDeliveryCheck,assessDeliveryChecks} from '../scripts/workkeel-check-evidence.mjs';

const actor={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'};
const criterion='Reject negative quantities';
const inventory={tests:['src/check.test.mjs'],oracles:['docs/requirement.txt'],inputs:['src/total.mjs'],configuration:[],packages:[],environment:['WK_CHECK_FORCE_RED']};
const script=new URL('../scripts/workkeel-delivery.mjs',import.meta.url).pathname;
async function fixture(t,{testSource,readPaths=['.'],writePaths=['src','.ai-org/artifacts/WK-check']}={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'check-evidence-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');
  await fs.writeFile(root+'/docs/approval.md','Approved fixture');await fs.writeFile(root+'/docs/requirement.txt',criterion);
  await fs.writeFile(root+'/docs/impact.json',JSON.stringify({schema_version:'workkeel.review-impact/v1',task_id:'WK-check',approved_by:'owner',irreversible_impact:'none'}));
  await fs.writeFile(root+'/src/total.mjs','export const total=(price,quantity)=>price*quantity;\n');
  await fs.writeFile(root+'/src/check.test.mjs',testSource??"import assert from 'node:assert/strict';import {total} from './total.mjs';assert.equal(total(2,3),6);assert.notEqual(process.env.WK_CHECK_FORCE_RED,'1');\n");
  git('add','.');git('commit','-qm','Baseline');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-check',goal:'Evidence fixture',actor,acceptance:[criterion],
    environment:{cwd:'.',read_paths:readPaths,write_paths:writePaths,tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md','docs/impact.json']}},
    authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
  const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
  await mutateNativeTask(root,'WK-check','claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
  const input=name=>({schema_version:'workkeel.capture-check/v1',task_id:'WK-check',actor,expected_version:2,name,inventory,coverage:[{criterion,extent:'complete'}]});
  const capture=name=>captureDeliveryCheck(root,input(name));
  const pin=async ref=>({path:ref,sha256:sha256(await fs.readFile(root+'/'+ref))});
  const read=()=>readNativeTask(root,'WK-check');
  const handoff=async results=>mutateNativeTask(root,'WK-check','handoff',{operation_id:'handoff',expected_version:2,actor,claim_id:(await read()).claim.id,
    revision:git('rev-parse','HEAD'),summary:'Fixture evidence',evidence:results.flatMap(r=>[r.bundle.path,...(r.log?[r.log.path]:[])]),unresolved:[]});
  const assess=(results,extra={})=>assessDeliveryChecks(root,{schema_version:'workkeel.assess-checks/v1',task_id:'WK-check',inventory,attempts:results.map(r=>r.bundle),impact_ref:'docs/impact.json',...extra});
  const changeBundle=async(result,fn)=>{const file=root+'/'+result.bundle.path,b=JSON.parse(await fs.readFile(file));fn(b);await fs.writeFile(file,JSON.stringify(b));return {...result,bundle:await pin(result.bundle.path)};};
  return {root,git,input,capture,pin,read,handoff,assess,changeBundle};
}
function setEnv(t,key,value) {const old=process.env[key];if(value===undefined)delete process.env[key];else process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});}
async function treeBytes(root,relative='') {
  const result={};
  for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})) {
    const ref=relative?relative+'/'+entry.name:entry.name;
    if(entry.isDirectory())Object.assign(result,await treeBytes(root,ref));
    else result[ref]=entry.isSymbolicLink()?await fs.readlink(path.join(root,ref)):sha256(await fs.readFile(path.join(root,ref)));
  }
  return result;
}

test('real capture retains original context; semantic overclaim awaits independent confirmation and handoff',async t=>{
  setEnv(t,'WK_CHECK_FORCE_RED',undefined);const f=await fixture(t),before=await f.read(),result=await f.capture('green');
  assert.equal(result.status,'pass',JSON.stringify(result));assert.deepEqual(await f.read(),before);
  const bundle=JSON.parse(await fs.readFile(f.root+'/'+result.bundle.path));
  assert.equal(bundle.runtime.version,process.version);assert.equal(bundle.receipt.exit_code,0);assert.equal(bundle.coverage.author.agent_id,'builder');
  assert.deepEqual(bundle.launch_environment,[{name:'WK_CHECK_FORCE_RED',present:false,sha256:null}]);
  // Every .ai-org/ file is administrative, so an unnamed report is no longer a candidate issue.
  assert.ok(!(await f.assess([result])).assessment.reasons.some(r=>r.code==='unlisted-report'));
  await f.handoff([result]);const taskBytes=await fs.readFile(f.root+'/.ai-org/work-items/WK-check.json');
  const allBytes=await treeBytes(f.root),assessment=await f.assess([result]);
  assert.deepEqual(await treeBytes(f.root),allBytes);
  assert.equal(assessment.assessment.measurements[0].reuse,'candidate-for-independent-confirmation',JSON.stringify(assessment));
  assert.equal(assessment.assessment.coverage[0].status,'declared-coverage-awaiting-independent-confirmation');
  assert.equal(assessment.criterion_confirmation[0].status,'unknown');assert.equal(assessment.attempt_inventory,'caller-listed-only');
  const counterexample=spawnSync(process.execPath,['--input-type=module','-e',"import assert from 'node:assert/strict';import {total} from './src/total.mjs';assert.throws(()=>total(2,-1));"],{cwd:f.root,encoding:'utf8'});
  assert.equal(counterexample.status,1);assert.deepEqual(await fs.readFile(f.root+'/.ai-org/work-items/WK-check.json'),taskBytes);
});

test('same command captures actual red and selected environment drift, retaining failure beside green',async t=>{
  setEnv(t,'WK_CHECK_FORCE_RED',undefined);const f=await fixture(t),green=await f.capture('green');
  process.env.WK_CHECK_FORCE_RED='1';const red=await f.capture('red');assert.equal(red.status,'fail',JSON.stringify(red));
  delete process.env.WK_CHECK_FORCE_RED;await f.handoff([green,red]);const a=await f.assess([green,red]);
  assert.equal(a.assessment.route,'blocked');assert.equal(a.attempts[1].recorded_status,'fail');
  assert.ok(a.attempts[1].issues.includes('selected-environment-mismatch'));assert.deepEqual(a.assessment.coverage[0].failed_measurements,['red']);
  const omitted=await f.assess([green]);assert.equal(omitted.attempt_inventory,'caller-listed-only');assert.equal(omitted.assessment.measurements[0].reuse,'candidate-for-independent-confirmation');
});

test('unset differs from empty and stripped Node options never appear as effective launch values',async t=>{
  setEnv(t,'WK_CHECK_FORCE_RED',undefined);setEnv(t,'NODE_OPTIONS','--require /must-not-run.cjs');setEnv(t,'NODE_PATH','/private-unused');
  const f=await fixture(t),input=f.input('stripped');input.inventory={...inventory,environment:['NODE_OPTIONS','NODE_PATH','NODE_TEST_CONTEXT','WK_CHECK_FORCE_RED']};
  const captured=await captureDeliveryCheck(f.root,input);assert.equal(captured.status,'pass');
  const b=JSON.parse(await fs.readFile(f.root+'/'+captured.bundle.path));assert.ok(b.launch_environment.every(e=>e.present===false));
  assert.ok(!JSON.stringify(b).includes('/private-unused'));assert.ok(!JSON.stringify(b).includes('must-not-run'));
  await f.handoff([captured]);process.env.WK_CHECK_FORCE_RED='';
  const a=await f.assess([captured],{inventory:input.inventory});assert.ok(a.attempts[0].issues.includes('selected-environment-mismatch'));assert.equal(a.assessment.measurements[0].reuse,'ineligible');
});

test('reserved, legacy, missing, tampered and incomplete captures never acquire present-day context',async t=>{
  const f=await fixture(t),r=await f.capture('green'),b=JSON.parse(await fs.readFile(f.root+'/'+r.bundle.path));
  await assert.rejects(f.capture('green'),/exist/);
  await fs.writeFile(f.root+'/.ai-org/artifacts/WK-check/legacy.json',JSON.stringify(b.receipt));
  const legacy={bundle:await f.pin('.ai-org/artifacts/WK-check/legacy.json')};
  assert.equal((await f.assess([legacy])).attempts[0].status,'legacy-incomplete');
  const changed=await f.changeBundle(r,b=>{b.receipt.process_exit_confirmed=false;});
  const a=await f.assess([changed]);assert.equal(a.attempts[0].status,'incomplete');assert.equal(a.assessment.route,'blocked');
  assert.equal((await f.assess([r])).attempts[0].status,'unavailable');
  const reserved=await f.changeBundle(changed,b=>{b.state='capturing';b.completed_at=null;b.after=null;b.receipt=null;b.log=null;});
  assert.ok((await f.assess([reserved])).attempts[0].issues.includes('original-snapshot-or-receipt-missing'));
  const missing={bundle:{path:'.ai-org/artifacts/WK-check/missing.json',sha256:'a'.repeat(64)}};
  assert.equal((await f.assess([missing])).attempts[0].status,'unavailable');
});

test('capture rejects unsafe inventory, scope escape, symlinks and conflicting actor before launching',async t=>{
  const f=await fixture(t);
  for(const names of [['HOME'],['OPENAI_API_KEY'],['WK_CHECK_SECRET'],['WK_CHECK_TOKEN']])await assert.rejects(captureDeliveryCheck(f.root,{...f.input('unsafe'),inventory:{...inventory,environment:names}}));
  await assert.rejects(captureDeliveryCheck(f.root,{...f.input('actor'),actor:reviewer}));
  await assert.rejects(captureDeliveryCheck(f.root,{...f.input('criterion'),coverage:[{criterion:'invented',extent:'complete'}]}));
  await fs.symlink(f.root+'/src/check.test.mjs',f.root+'/src/link.mjs');
  await assert.rejects(captureDeliveryCheck(f.root,{...f.input('link'),inventory:{...inventory,tests:['src/link.mjs']}}));
  const g=await fixture(t,{writePaths:['src']});await assert.rejects(g.capture('scope'),/scope/);
  const h=await fixture(t,{readPaths:['src','docs']});await assert.rejects(h.capture('scope'),/scope/);
  await assert.rejects(fs.access(f.root+'/.ai-org/artifacts/WK-check/unsafe.log'));
});

test('dirty inputs, runtime input mutation and interrupted recorder remain incomplete',async t=>{
  const dirty=await fixture(t);await fs.writeFile(dirty.root+'/src/total.mjs','export const total=()=>6;\n');
  const r=await dirty.capture('dirty');assert.equal(r.status,'incomplete');assert.ok(r.issues.some(i=>i.startsWith('original-')));
  const changing=await fixture(t,{testSource:"import fs from 'node:fs';fs.writeFileSync('src/total.mjs','changed');\n"});
  const c=await changing.capture('changing');assert.equal(c.status,'incomplete');assert.ok(c.issues.includes('receipt-context-mismatch'));
  const f=await fixture(t);await fs.mkdir(f.root+'/.ai-org/artifacts/WK-check',{recursive:true});await fs.writeFile(f.root+'/.ai-org/artifacts/WK-check/collision.log','old evidence');
  const failed=await f.capture('collision');assert.equal(failed.status,'incomplete');
  assert.equal(JSON.parse(await fs.readFile(f.root+'/'+failed.bundle.path)).state,'incomplete');assert.equal(await fs.readFile(f.root+'/.ai-org/artifacts/WK-check/collision.log','utf8'),'old evidence');
  const tamper=await fixture(t,{testSource:"import fs from 'node:fs';fs.writeFileSync('.ai-org/artifacts/WK-check/tamper.json','foreign update');\n"});
  await assert.rejects(tamper.capture('tamper'),/reserved bundle changed/);
  assert.equal(await fs.readFile(tamper.root+'/.ai-org/artifacts/WK-check/tamper.json','utf8'),'foreign update');
});

test('confirmation requires exact current distinct native review and pinned supporting evidence',async t=>{
  const f=await fixture(t),r=await f.capture('green');await f.handoff([r]);
  const ref='.ai-org/artifacts/WK-check/confirmation.json',support='.ai-org/artifacts/WK-check/review.md';await fs.writeFile(f.root+'/'+support,'Reviewer checked the positive case only; negative remains missing.');
  const document={schema_version:'workkeel.criterion-confirmation/v1',task_id:'WK-check',candidate_revision:f.git('rev-parse','HEAD'),contract_sha256:(await f.read()).contract_sha256,reviewer,
    criteria:[{criterion,status:'partial',evidence:[await f.pin(support)]}]};
  await fs.writeFile(f.root+'/'+ref,JSON.stringify(document));const confirmation=await f.pin(ref);
  assert.equal((await f.assess([r],{confirmation})).criterion_confirmation[0].status,'unknown');
  await mutateNativeTask(f.root,'WK-check','review',{operation_id:'review',expected_version:3,actor:reviewer,revision:document.candidate_revision,judgment:'pass',summary:'Synthetic review attribution only',evidence:[ref,support]});
  const a=await f.assess([r],{confirmation});assert.equal(a.criterion_confirmation[0].status,'partial',JSON.stringify(a));assert.equal(a.assessment.coverage[0].status,'declared-coverage-awaiting-independent-confirmation');
  await fs.writeFile(f.root+'/'+ref,JSON.stringify({...document,reviewer:actor}));
  assert.equal((await f.assess([r],{confirmation:await f.pin(ref)})).criterion_confirmation[0].status,'unknown');
  await fs.writeFile(f.root+'/'+ref,JSON.stringify({...document,candidate_revision:'a'.repeat(40)}));
  assert.equal((await f.assess([r],{confirmation:await f.pin(ref)})).criterion_confirmation[0].status,'unknown');
  await fs.writeFile(f.root+'/'+ref,JSON.stringify(document));
  const open=fs.open;let supportReads=0,injected=false;
  fs.open=async function(file,...args) {
    const handle=await open.call(this,file,...args);
    // Initial assessor checks twice, confirmation reads once, adapter rechecks
    // once. Change after the next read in the final assessor, beyond that guard.
    if(String(file)===f.root+'/'+support&&++supportReads===5) {
      const close=handle.close.bind(handle);handle.close=async()=>{await close();await fs.writeFile(f.root+'/'+support,'Changed during final assessment');injected=true;};
    }
    return handle;
  };
  try {
    const late=await f.assess([r],{confirmation});assert.equal(injected,true);
    assert.equal(late.assessment.route,'blocked');assert.equal(late.criterion_confirmation[0].status,'unknown');
    assert.ok(late.confirmation_issues.includes('confirmation-withheld-due-to-changing-evidence'));
  } finally {fs.open=open;}
});

test('previously changed authority or candidate cannot retain current criterion confirmation',async t=>{
  const f=await fixture(t),green=await f.capture('green');await f.handoff([green]);
  const ref='.ai-org/artifacts/WK-check/confirmation.json',support='.ai-org/artifacts/WK-check/review.md';
  await fs.writeFile(f.root+'/'+support,'Synthetic review attribution fixture, not a real semantic acceptance.');
  await fs.writeFile(f.root+'/'+ref,JSON.stringify({schema_version:'workkeel.criterion-confirmation/v1',task_id:'WK-check',
    candidate_revision:f.git('rev-parse','HEAD'),contract_sha256:(await f.read()).contract_sha256,reviewer,
    criteria:[{criterion,status:'confirmed',evidence:[await f.pin(support)]}]}));
  await mutateNativeTask(f.root,'WK-check','review',{operation_id:'review',expected_version:3,actor:reviewer,
    revision:f.git('rev-parse','HEAD'),judgment:'pass',summary:'Synthetic review binding fixture',evidence:[ref,support]});
  const confirmation=await f.pin(ref),assess=()=>f.assess([green],{confirmation});
  assert.equal((await assess()).criterion_confirmation[0].status,'confirmed');
  // An edited approval no longer withholds confirmation; drift and a missing approval still do.
  const approval=await fs.readFile(f.root+'/docs/approval.md');
  await fs.writeFile(f.root+'/docs/approval.md','Approval edited after the task was approved');
  assert.equal((await assess()).criterion_confirmation[0].status,'confirmed');
  await fs.writeFile(f.root+'/docs/approval.md',approval);
  for(const [changedRef,replacement,reason] of [
    ['src/total.mjs','export const total=()=>0;\n','product-drift'],
    ['docs/approval.md',null,'authority-unavailable']
  ]) {
    const original=await fs.readFile(f.root+'/'+changedRef);
    if(replacement===null)await fs.unlink(f.root+'/'+changedRef);
    else await fs.writeFile(f.root+'/'+changedRef,replacement);
    const result=await assess();
    assert.equal(result.assessment.route,'blocked');
    assert.equal(result.criterion_confirmation[0].status,'unknown');
    assert.equal(result.confirmation_binding,'unresolved');
    assert.ok(result.confirmation_issues.includes(`confirmation-context:${reason}`),JSON.stringify(result.confirmation_issues));
    await fs.writeFile(f.root+'/'+changedRef,original);
    assert.equal((await assess()).criterion_confirmation[0].status,'confirmed');
  }
});

test('cross-task bundles, duplicate attempts and changed log pins fail conservatively',async t=>{
  const f=await fixture(t),r=await f.capture('green');
  await assert.rejects(f.assess([r,r]),/duplicate|bounded/);
  const cross=await f.changeBundle(r,b=>{b.task_id='WK-other';});assert.equal((await f.assess([cross])).attempts[0].status,'unavailable');
  const restored=await f.changeBundle(cross,b=>{b.task_id='WK-check';});await fs.appendFile(f.root+'/'+r.log.path,'tampered');
  assert.ok((await f.assess([restored])).attempts[0].issues.includes('log-missing-changed-or-inconsistent'));
  await fs.symlink(f.root+'/'+restored.bundle.path,f.root+'/.ai-org/artifacts/WK-check/link.json');
  assert.equal((await f.assess([{bundle:{path:'.ai-org/artifacts/WK-check/link.json',sha256:restored.bundle.sha256}}])).attempts[0].status,'unavailable');
});

test('attributed contradiction stays visible beside actual red and a failed native review',async t=>{
  const f=await fixture(t,{testSource:"import assert from 'node:assert/strict';import {total} from './total.mjs';assert.throws(()=>total(2,-1));\n"});
  const red=await f.capture('red');await f.handoff([red]);
  const ref='.ai-org/artifacts/WK-check/confirmation.json',support='.ai-org/artifacts/WK-check/negative-review.md';
  await fs.writeFile(f.root+'/'+support,'The negative-input criterion is contradicted by the actual test.');
  await fs.writeFile(f.root+'/'+ref,JSON.stringify({schema_version:'workkeel.criterion-confirmation/v1',task_id:'WK-check',candidate_revision:f.git('rev-parse','HEAD'),
    contract_sha256:(await f.read()).contract_sha256,reviewer,criteria:[{criterion,status:'contradicted',evidence:[await f.pin(support)]}]}));
  await mutateNativeTask(f.root,'WK-check','review',{operation_id:'review',expected_version:3,actor:reviewer,revision:f.git('rev-parse','HEAD'),judgment:'fail',summary:'Negative case failed',evidence:[ref,support]});
  const a=await f.assess([red],{confirmation:await f.pin(ref)});
  assert.equal(a.assessment.route,'blocked');assert.equal(a.criterion_confirmation[0].status,'contradicted');assert.equal(a.confirmation_binding,'current-pinned-distinct-review');
});

test('historical red keeps original candidate and cannot poison a repaired current measurement',async t=>{
  const f=await fixture(t,{testSource:"import assert from 'node:assert/strict';import {total} from './total.mjs';assert.throws(()=>total(2,-1));assert.equal(total(2,3),6);\n"});
  const red=await f.capture('old-red'),old=f.git('rev-parse','HEAD');
  await fs.writeFile(f.root+'/src/total.mjs',"export const total=(p,q)=>{if(q<0)throw new RangeError('quantity');return p*q;};\n");f.git('add','src/total.mjs');f.git('commit','-qm','Repair');
  const green=await f.capture('repaired');assert.equal(green.status,'pass',JSON.stringify(green));await f.handoff([red,green]);
  const a=await f.assess([red,green]);assert.equal(a.attempts[0].candidate_status,'historical');assert.equal(a.attempts[0].candidate_revision,old);
  assert.deepEqual(a.assessment.coverage[0].historical_failed_measurements,['old-red']);assert.deepEqual(a.assessment.coverage[0].failed_measurements,[]);
  assert.equal(a.assessment.measurements[1].reuse,'candidate-for-independent-confirmation');
});

test('CLI captures red with nonzero exit, assesses without writes, and rejects oversized input',async t=>{
  const f=await fixture(t,{testSource:"import assert from 'node:assert/strict';assert.equal(1,2);\n"});
  const run=(command,input)=>spawnSync(process.execPath,[script,command,f.root,'-'],{input:JSON.stringify(input),encoding:'utf8'});
  const result=run('capture-check',f.input('cli-red'));assert.equal(result.status,1,result.stderr);const r=JSON.parse(result.stdout);assert.equal(r.status,'fail');
  await f.handoff([r]);const before=await f.read();
  const assessment=run('assess-checks',{schema_version:'workkeel.assess-checks/v1',task_id:'WK-check',inventory,attempts:[r.bundle],impact_ref:'docs/impact.json'});
  assert.equal(assessment.status,0,assessment.stderr);assert.equal(JSON.parse(assessment.stdout).assessment.route,'blocked');assert.deepEqual(await f.read(),before);
  const huge=spawnSync(process.execPath,[script,'capture-check',f.root,'-'],{input:' '.repeat(65537),encoding:'utf8'});assert.equal(huge.status,1);assert.equal(huge.stdout,'');
});
