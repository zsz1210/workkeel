import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createMonitorFixture} from '../scripts/workkeel-monitor-fixture.mjs';
import {readNativeTask} from '../src/workkeel-tasks.mjs';
import {readNativeGit} from '../src/workkeel-project.mjs';
import {checkCompletionEvidence} from '../src/workkeel-completion-evidence.mjs';

async function fixture(t){
  const root=await fs.realpath(await createMonitorFixture({extended:true}));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const task=await readNativeTask(root,'WK-working'),candidate=(await readNativeGit(root,['rev-parse','HEAD'])).trim(),dir='.ai-org/artifacts/WK-working';await fs.mkdir(root+'/'+dir,{recursive:true});
  const text=Buffer.from('Synthetic observed UI record; fixture evidence is not actual visual acceptance.\n'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fSAAAAAASUVORK5CYII=','base64');
  await fs.writeFile(root+'/'+dir+'/observation.txt',text);await fs.writeFile(root+'/'+dir+'/screenshot.png',png);
  const ref=(name,bytes,kind)=>({path:dir+'/'+name,sha256:createHash('sha256').update(bytes).digest('hex'),kind}),record=ref('observation.txt',text,'observation'),screen=ref('screenshot.png',png,'screenshot');
  const report={schema_version:'workkeel.completion-evidence/v1',candidate_revision:candidate,ui_mode:'code-first',requirements:task.contract.acceptance.criteria.map(criterion=>({criterion,status:'pass',observation:'Synthetic requirement mapping for format/provenance test only',evidence:[record,screen]})),self_reviews:['hierarchy','interaction'].map(id=>({id,candidate_revision:candidate,observation:'Synthetic review attribution; not a real model or visual judgment',evidence:[screen]})),open_findings:[]};
  return {root,report,record,screen};
}
test('complete coverage checks artifact consistency but never grants semantic or independent acceptance',async t=>{
  const {root,report}=await fixture(t),result=await checkCompletionEvidence(root,'WK-working',report);
  assert.equal(result.coverage_consistent,true);assert.equal(result.approved_criteria,result.covered_criteria);assert.equal(result.visual_review_rounds,2);assert.equal(result.semantic_correctness,'requires-review');assert.equal(result.independent_acceptance,'not-evaluated');assert.equal(result.model_calls,0);assert.equal(result.mutation_status,'no-write');
});
test('completion evidence rejects an unborn repository with baseline guidance and no raw Git error',async t=>{
  const {root,report}=await fixture(t);
  assert.equal((await checkCompletionEvidence(root,'WK-working',report)).coverage_consistent,true);
  await fs.rm(root+'/.git',{recursive:true,force:true});
  execFileSync('git',['-C',root,'init','-q']);
  const ref='.ai-org/artifacts/WK-working/completion.json',canonical=root+'/.ai-org/work-items/WK-working.json';
  await fs.writeFile(root+'/'+ref,JSON.stringify(report));
  const before=await fs.readFile(canonical),message='This repository has no commits. Make a baseline commit first (git add -A && git commit -m baseline), then retry.';
  await assert.rejects(checkCompletionEvidence(root,'WK-working',report),error=>{
    assert.equal(error.message,message);
    assert.doesNotMatch(String(error),/fatal:|ambiguous argument|Command failed/);
    return true;
  });
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/workkeel.mjs',import.meta.url)),'task','evidence-check',root,'--id','WK-working','--request',ref],{encoding:'utf8'});
  assert.equal(run.status,1);
  const error=JSON.parse(run.stdout+run.stderr);assert.equal(error.schema_version,'workkeel.operation-error/v1');assert.equal(error.message,message);
  assert.doesNotMatch(run.stdout+run.stderr,/fatal:|ambiguous argument|Command failed/);
  assert.deepEqual(await fs.readFile(canonical),before);
});
test('green test evidence cannot cover an omitted requirement or missing visual review',async t=>{
  const {root,report}=await fixture(t);report.requirements=[];report.self_reviews=[];
  const result=await checkCompletionEvidence(root,'WK-working',report);assert.equal(result.coverage_consistent,false);assert.ok(result.issues.some(issue=>issue.code==='approved-criterion-uncovered'));assert.ok(result.issues.some(issue=>issue.code==='repeated-visual-review-missing'));
});
test('installed native CLI exposes coverage checking and returns failure without lifecycle writes',async t=>{
  const {root,report}=await fixture(t),ref='.ai-org/artifacts/WK-working/completion.json',canonical=root+'/.ai-org/work-items/WK-working.json';
  assert.match(await fs.readFile(root+'/WORKKEEL.md','utf8'),/task evidence-check/,'new consumer projects receive the completion-review guidance');
  const before=await fs.readFile(canonical);await fs.writeFile(root+'/'+ref,JSON.stringify(report));
  const run=()=>spawnSync(process.execPath,[fileURLToPath(new URL('../bin/workkeel.mjs',import.meta.url)),'task','evidence-check',root,'--id','WK-working','--request',ref],{encoding:'utf8'});
  const complete=run();assert.equal(complete.status,0,complete.stderr);assert.equal(JSON.parse(complete.stdout).coverage_consistent,true);
  report.requirements=[];await fs.writeFile(root+'/'+ref,JSON.stringify(report));const incomplete=run();assert.equal(incomplete.status,1);assert.equal(JSON.parse(incomplete.stdout).coverage_consistent,false);
  assert.deepEqual(await fs.readFile(canonical),before);
});
test('stale candidate, nonpassing observations and unresolved findings remain blockers',async t=>{
  const {root,report}=await fixture(t);report.candidate_revision='a'.repeat(40);report.requirements[0].status='unverified';report.open_findings=['Missing flow visualization'];
  const result=await checkCompletionEvidence(root,'WK-working',report);assert.equal(result.coverage_consistent,false);for(const code of ['candidate-mismatch','requirement-not-passing','unresolved-findings'])assert.ok(result.issues.some(issue=>issue.code===code));
});
test('changed or symlinked proof and dirty product code cannot pass an exact-candidate check',async t=>{
  const {root,report,record}=await fixture(t);await fs.appendFile(root+'/'+record.path,'changed');await fs.writeFile(root+'/src/unreviewed.mjs','export const unreviewed=true;\n');
  const result=await checkCompletionEvidence(root,'WK-working',report);assert.equal(result.coverage_consistent,false);assert.ok(result.issues.some(issue=>issue.code==='requirement-evidence-invalid'));assert.ok(result.issues.some(issue=>issue.code==='candidate-working-tree-drift'));
  await fs.rm(root+'/'+record.path);await fs.symlink(root+'/src/unreviewed.mjs',root+'/'+record.path);const linked=await checkCompletionEvidence(root,'WK-working',report);assert.ok(linked.issues.some(issue=>issue.code==='requirement-evidence-invalid'));
});
