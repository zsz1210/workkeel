import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask,inspectTaskCandidate} from '../src/workkeel-tasks.mjs';
import {bindHostUsage,reportHostUsage} from '../src/workkeel-host-usage.mjs';
import {readDeliveryPreflight,renderDeliveryReport} from '../scripts/workkeel-delivery-preflight.mjs';
import {documentationLanguageIssue} from '../scripts/documentation-policy.mjs';

async function fixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'delivery-preflight-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,{agent_id:'reviewer',principal_id:'owner'}],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');await fs.writeFile(root+'/docs/approval.md','Approved offline fixture.');
  await fs.writeFile(root+'/docs/evidence.md','PASS is a quoted observation, not a performed gate.');
  git('add','.');git('commit','-qm','Fixture');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-preflight',goal:'Private task prose must not appear in the generated report',actor,acceptance:['Preserve exact evidence and unknown measurements'],
    environment:{cwd:'.',read_paths:['src','docs'],write_paths:['src'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'approved-connection',policy_refs:['docs/approval.md']}},
    authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
  const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
  await mutateNativeTask(root,brief.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
  const task=await readNativeTask(root,brief.id),identity={actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256};
  const request={task_id:task.id,expected:[{label:'worker',activity_kind:'implementation',binding:null}],candidate_revision:git('rev-parse','HEAD'),evidence:['docs/evidence.md']};
  async function report(id,usage,active=null,model='fixture-model') {
    await bindHostUsage(root,{...identity,task_id:task.id,binding_id:id,source:{kind:'host-report',thread_id:id,turn_id:'turn'}});
    const at=new Date().toISOString();
    await reportHostUsage(root,{...identity,binding_id:id,report_id:'final',status:'completed',tool:'fixture',model,usage,observed_at:at,activity_kind:'implementation',
      ...(active===null?{}:{execution_duration_ms:active,execution_intervals:[{started_at:at,completed_at:new Date(Date.parse(at)+active).toISOString()}]})});
    return {label:id,activity_kind:'implementation',binding:{kind:'host',id}};
  }
  return {root,git,request,report};
}

async function candidateRequest(f) {
  const task=await readNativeTask(f.root,'WK-preflight');
  return {operation_id:'handoff-files',expected_version:task.version,actor:task.contract.actor,
    claim_id:task.claim.id,revision:f.git('rev-parse','HEAD'),summary:'Fixture delivery',
    evidence:['docs/evidence.md'],unresolved:[]};
}

test('candidate diagnostics identify a stray report before handoff and exact new evidence resolves it',async t=>{
  const f=await fixture(t),request=await candidateRequest(f),ref='.ai-org/artifacts/WK-preflight/snapshot.json';
  await fs.mkdir(path.dirname(f.root+'/'+ref),{recursive:true});await fs.writeFile(f.root+'/'+ref,'{"observed":true}');
  const before=await fs.readFile(f.root+'/.ai-org/work-items/WK-preflight.json','utf8');
  const blocked=await inspectTaskCandidate(f.root,'WK-preflight',{action:'handoff',request});
  assert.equal(blocked.candidate_files_passed,false);
  assert.deepEqual(blocked.issues.map(x=>[x.path,x.code]),[[ref,'unlisted-report']]);
  await assert.rejects(mutateNativeTask(f.root,'WK-preflight','handoff',request),/including untracked files.*snapshot/);
  assert.equal(await fs.readFile(f.root+'/.ai-org/work-items/WK-preflight.json','utf8'),before);
  const exact={...request,evidence:[...request.evidence,ref]};
  const ready=await inspectTaskCandidate(f.root,'WK-preflight',{action:'handoff',request:exact});
  assert.equal(ready.candidate_files_passed,true);assert.equal(ready.lifecycle_validation,'not-performed');
  assert.equal(ready.execution_authorized,false);assert.ok(ready.administrative_paths.includes(ref));
  const result=await mutateNativeTask(f.root,'WK-preflight','handoff',exact);assert.equal(result.state,'test');
});

test('candidate diagnostics never exempt executable artifacts or modified tracked evidence',async t=>{
  const f=await fixture(t),script='.ai-org/artifacts/WK-preflight/report.mjs',tracked='.ai-org/artifacts/WK-preflight/frozen.md';
  await fs.mkdir(path.dirname(f.root+'/'+tracked),{recursive:true});await fs.writeFile(f.root+'/'+tracked,'Frozen report');
  f.git('add',tracked);f.git('commit','-qm','Evidence candidate');
  const request=await candidateRequest(f);request.evidence.push(tracked,script);
  await fs.writeFile(f.root+'/'+tracked,'Changed report');await fs.writeFile(f.root+'/'+script,'throw Error("not metadata")');
  const result=await inspectTaskCandidate(f.root,'WK-preflight',{action:'handoff',request});
  assert.equal(result.candidate_files_passed,false);
  assert.ok(result.issues.some(i=>i.path===tracked&&i.code==='tracked-artifact-changed'));
  assert.ok(result.issues.some(i=>i.path===script&&i.code==='product-drift'));
  await assert.rejects(mutateNativeTask(f.root,'WK-preflight','handoff',request),/tracked candidate artifact changed|including untracked/);
});

test('candidate diagnostics use exact paths, reject stale requests and do not mutate via the CLI',async t=>{
  const f=await fixture(t),request=await candidateRequest(f),ref='src/odd\nname.txt';
  await fs.writeFile(f.root+'/'+ref,'Uncommitted product');
  const result=await inspectTaskCandidate(f.root,'WK-preflight',{action:'handoff',request});
  assert.equal(result.issues[0].path,ref);assert.equal(result.issues[0].code,'product-drift');
  const before=f.git('status','--porcelain=v1');
  const tmp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'candidate-input-')));t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
  await fs.writeFile(tmp+'/request.json',JSON.stringify({task_id:'WK-preflight',action:'handoff',request}));
  const cli=spawnSync(process.execPath,['scripts/workkeel-delivery-preflight.mjs','candidate',f.root,tmp+'/request.json'],{encoding:'utf8'});
  assert.equal(cli.status,1);assert.equal(JSON.parse(cli.stdout).issues[0].path,ref);assert.equal(f.git('status','--porcelain=v1'),before);
  await assert.rejects(inspectTaskCandidate(f.root,'WK-preflight',{action:'handoff',request:{...request,expected_version:1}}),/Stale/);
  await assert.rejects(inspectTaskCandidate(f.root,'WK-preflight',{action:'handoff',request:{...request,revision:'HEAD'}}),/immutable/);
  await assert.rejects(inspectTaskCandidate(f.root,'WK-preflight',{action:'close',request:{operation_id:'close',expected_version:2,actor:request.actor,revision:request.revision,evidence:request.evidence}}),/delivered/);
});

test('out of scope committed changes fail diagnostics and the actual handoff',async t=>{
  const f=await fixture(t);await fs.writeFile(f.root+'/outside.txt','Outside approved write roots');
  f.git('add','outside.txt');f.git('commit','-qm','Outside fixture');const request=await candidateRequest(f);
  const result=await inspectTaskCandidate(f.root,'WK-preflight',{action:'handoff',request});
  assert.ok(result.issues.some(i=>i.path==='outside.txt'&&i.code==='outside-write-scope'));
  await assert.rejects(mutateNativeTask(f.root,'WK-preflight','handoff',request),/outside approved write roots.*outside.txt/);
});

test('zero, unknown and partial measurements remain distinct; preflight does not execute gates or write',async t=>{
  const f=await fixture(t);
  const first=await f.report('zero',{input_tokens:0,output_tokens:0},0);
  const second=await f.report('partial',{input_tokens:5,cached_input_tokens:3},null);
  const before=await fs.readFile(f.root+'/.ai-org/work-items/WK-preflight.json','utf8');
  const request={...f.request,expected:[first,second,{label:'absent',activity_kind:'review',binding:null}]};
  const result=await readDeliveryPreflight(f.root,request);
  assert.equal(result.evidence_preflight_passed,true);
  assert.deepEqual(result.totals.active_duration_ms,{value:0,known:1,expected:3,coverage:'partial'});
  assert.deepEqual(result.totals.input_tokens,{value:5,known:2,expected:3,coverage:'partial'});
  assert.deepEqual(result.totals.total_tokens,{value:null,known:0,expected:3,coverage:'unknown'});
  assert.equal(result.totals.cached_input_tokens.value,3);assert.equal(result.elapsed_ms,null);
  assert.equal(result.full_verification,'not-run');assert.equal(result.actual_review,'not-performed');
  assert.equal(result.task_coverage_complete,false);
  assert.equal(result.reports.declared_reports_complete,false);
  assert.equal(result.reports.collection.status,'unavailable');
  assert.equal(result.reports.collection.counts.completed,2);assert.equal(result.reports.collection.counts.missing,1);
  const report=renderDeliveryReport(result);
  assert.ok(!report.includes('Private task prose'));assert.match(report,/0 \| 1 \/ 3/);
  assert.match(report,/Native task state: `build`\. Locally accepted: no/);
  assert.match(report,/Declared source collection: `unavailable`\. Required reports complete: no/);
  assert.match(report,/Usage observed at \| Activity ended at \| Collected at/);
  assert.match(report,/`report-known-metrics-or-record-gap`/);assert.match(report,/`resolve-missing-binding`/);
  assert.ok(!report.includes(f.root));
  assert.equal(await fs.readFile(f.root+'/.ai-org/work-items/WK-preflight.json','utf8'),before);
  assert.deepEqual(await readDeliveryPreflight(f.root,request),result);
});

test('evidence mismatches, missing and untracked files, stale candidate and recorded warnings fail explicitly',async t=>{
  const f=await fixture(t);
  await fs.writeFile(f.root+'/docs/evidence.md','Changed');
  let result=await readDeliveryPreflight(f.root,f.request);
  assert.equal(result.evidence_preflight_passed,false);assert.ok(result.evidence[0].issues.includes('candidate-bytes-mismatch'));
  await fs.unlink(f.root+'/docs/evidence.md');result=await readDeliveryPreflight(f.root,f.request);
  assert.ok(result.evidence[0].issues.includes('evidence-unavailable-or-unsafe'));
  await fs.writeFile(f.root+'/docs/untracked.md','Untracked');
  result=await readDeliveryPreflight(f.root,{...f.request,evidence:['docs/untracked.md']});
  assert.ok(result.evidence[0].issues.includes('candidate-file-not-tracked-regular'));
  await fs.writeFile(f.root+'/docs/evidence.md','PASS is a quoted observation, not a performed gate.');
  f.git('add','docs/untracked.md');f.git('commit','-qm','Next');
  result=await readDeliveryPreflight(f.root,f.request);assert.ok(result.candidate_issues.includes('candidate-not-head'));
  await fs.writeFile(f.root+'/docs/approval.md','Changed approval');
  result=await readDeliveryPreflight(f.root,{...f.request,candidate_revision:f.git('rev-parse','HEAD')});
  assert.equal(result.evidence_preflight_passed,false);assert.ok(result.context_evidence.some(row=>row.status==='changed'));
});

test('leaf and parent symlinks, escape paths, oversized files and non-commit candidates are refused',async t=>{
  const f=await fixture(t);
  await fs.symlink('evidence.md',f.root+'/docs/link.md');
  await fs.symlink('docs',f.root+'/linked');
  await fs.writeFile(f.root+'/docs/large.txt',Buffer.alloc(1024*1024+1));
  for(const file of ['docs/link.md','linked/evidence.md','docs/large.txt']) {
    const result=await readDeliveryPreflight(f.root,{...f.request,evidence:[file]});
    assert.equal(result.evidence_preflight_passed,false);assert.ok(result.evidence[0].issues.includes('evidence-unavailable-or-unsafe'));
  }
  for(const file of ['../private','/private','docs/../docs/evidence.md','docs\\evidence.md'])await assert.rejects(readDeliveryPreflight(f.root,{...f.request,evidence:[file]}));
  await assert.rejects(readDeliveryPreflight(f.root,{...f.request,candidate_revision:'HEAD'}));
  const blob=f.git('rev-parse','HEAD:docs/evidence.md');
  const result=await readDeliveryPreflight(f.root,{...f.request,candidate_revision:blob});assert.ok(result.candidate_issues.includes('candidate-not-commit'));
});

test('shared documentation policy rejects new CJK Markdown while retaining the exact historic exception',async t=>{
  const f=await fixture(t),exception='.ai-org/artifacts/WK-observer-followup/audit.md';
  await fs.mkdir(path.dirname(f.root+'/'+exception),{recursive:true});
  await fs.writeFile(f.root+'/'+exception,'中文報告');await fs.writeFile(f.root+'/docs/new.md','中文報告');
  f.git('add',exception,'docs/new.md');f.git('commit','-qm','Language fixtures');
  const request={...f.request,candidate_revision:f.git('rev-parse','HEAD')};
  assert.equal(documentationLanguageIssue(exception,'中文報告'),null);
  assert.ok(documentationLanguageIssue('docs/new.md','中文報告'));
  const passed=await readDeliveryPreflight(f.root,{...request,evidence:[exception]});assert.equal(passed.evidence_preflight_passed,true);
  const failed=await readDeliveryPreflight(f.root,{...request,evidence:['docs/new.md']});assert.ok(failed.evidence[0].issues.includes('documentation-language-policy'));
});

test('parent replacement between traversal and open is rejected before outside bytes are read',async t=>{
  const f=await fixture(t),parent=f.root+'/docs',outside=f.root+'/outside';
  await fs.mkdir(outside);await fs.writeFile(outside+'/evidence.md','Private replacement');
  const originalOpen=fs.open;let swapped=false,reads=0;
  fs.open=async(filename,...args)=>{
    if(filename===parent+'/evidence.md'&&!swapped) {
      swapped=true;await fs.rename(parent,f.root+'/original');await fs.symlink(outside,parent);
      const handle=await originalOpen(filename,...args),read=handle.read.bind(handle);
      handle.read=(...values)=>{reads++;return read(...values);};return handle;
    }
    return originalOpen(filename,...args);
  };
  try {
    const result=await readDeliveryPreflight(f.root,f.request);
    assert.equal(swapped,true);assert.equal(reads,0);
    assert.equal(result.evidence_preflight_passed,false);
    assert.equal(result.evidence[0].current_sha256,null);
    assert.ok(result.evidence[0].issues.includes('evidence-unavailable-or-unsafe'));
  } finally {
    fs.open=originalOpen;
    if(swapped){await fs.unlink(parent);await fs.rename(f.root+'/original',parent);}
  }
});

test('report escapes Markdown, retains operation and inventory warnings, and protects sum overflow',async t=>{
  const f=await fixture(t);
  const entry=await f.report('worker',{input_tokens:1,output_tokens:0},0,'模型 | <tag> ` title');
  const request={...f.request,expected:[entry]};
  let result=await readDeliveryPreflight(f.root,request);
  const report=renderDeliveryReport(result);
  assert.ok(!report.includes('<tag>'));assert.ok(report.includes('&#124;'));
  assert.equal(documentationLanguageIssue('docs/report.md',report),null);
  await f.report('unlisted',{input_tokens:0},null);
  result=await readDeliveryPreflight(f.root,request);assert.equal(result.reports.unlisted_binding_count,1);
  await fs.writeFile(f.root+'/.ai-org/host-usage/worker/measurement.json','{}');
  result=await readDeliveryPreflight(f.root,request);assert.equal(result.reports.inventory_errors.length,1);
  assert.match(renderDeliveryReport(result),/Inventory:/);
  const g=await fixture(t),a=await g.report('a',{input_tokens:Number.MAX_SAFE_INTEGER},null),b=await g.report('b',{input_tokens:1},null);
  const overflow=await readDeliveryPreflight(g.root,{...g.request,expected:[a,b]});
  assert.deepEqual(overflow.totals.input_tokens,{value:null,known:2,expected:2,coverage:'overflow'});
});

test('CLI failure is redacted on stdout, supports Markdown and reports evidence failure with nonzero status',async t=>{
  const f=await fixture(t),script=new URL('../scripts/workkeel-delivery-preflight.mjs',import.meta.url).pathname;
  const input=f.root+'/request.json',run=(command='check',file=input)=>spawnSync(process.execPath,[script,command,f.root,file],{encoding:'utf8'});
  await fs.writeFile(input,JSON.stringify(f.request));
  assert.equal(run().status,0);assert.match(run('report').stdout,/# Delivery evidence preflight/);
  await fs.writeFile(f.root+'/docs/evidence.md','Dirty');
  const failure=run();assert.equal(failure.status,1);assert.equal(JSON.parse(failure.stdout).evidence_preflight_passed,false);assert.equal(failure.stderr,'');
  const failedReport=run('report');assert.equal(failedReport.status,1);assert.match(failedReport.stdout,/Evidence preflight passed: no/);
  await fs.writeFile(input,' '.repeat(65537));
  const oversized=run();assert.equal(oversized.status,1);assert.ok(!oversized.stdout.includes(f.root));assert.equal(oversized.stderr,'');
  await fs.symlink('request.json',f.root+'/link.json');assert.equal(run('check',f.root+'/link.json').status,1);
  const absent=run('check',f.root+'/secret-private.json');assert.equal(absent.status,1);assert.ok(!absent.stdout.includes('secret-private'));
});
