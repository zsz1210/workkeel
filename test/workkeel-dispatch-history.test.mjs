import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {prepareDispatchTicket,readDispatchTicket,bindDispatchTicket} from '../src/workkeel-dispatch.mjs';
import {reportHostUsage,closeHostUsage,readHostMeasurements} from '../src/workkeel-host-usage.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';

async function fixture(t) {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-claim-proof-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 const actor={agent_id:'builder',principal_id:'owner'};
 await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,{agent_id:'reviewer',principal_id:'owner'}],approvers:['owner'],review_separation:'distinct-agent'});
 await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');await fs.writeFile(root+'/docs/approval.md','Approved offline history fixture.');
 const policy={schema_version:'workkeel.dispatch-policy/v1',models:[{alias:'local',provider:'local',model:'fixture',reasoning:null,data_classes:['internal']}],default_alias:'local',conservative_alias:'local',parallelism:2};
 await fs.writeFile(root+'/docs/dispatch.json',JSON.stringify(policy));git('add','.');git('commit','-qm','Fixture');
 const brief={schema_version:'workkeel.task-brief/v1',id:'WK-history',goal:'History fixture',actor,acceptance:['Bound historical proof'],environment:{cwd:'.',read_paths:['src','docs'],write_paths:['src'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'approved-connection',policy_refs:['docs/approval.md','docs/dispatch.json']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
 const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
 await mutateNativeTask(root,brief.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
 const snapshot=await readNativeTask(root,brief.id);
 const ticket=await prepareDispatchTicket(root,{operation_id:'dispatch',task_id:snapshot.id,actor,claim_id:snapshot.claim.id,contract_sha256:snapshot.contract_sha256,policy_ref:'docs/dispatch.json',node:{id:'work',activity_kind:'implementation',depends_on:[],read_paths:['src'],write_paths:['src']},capabilities:{host:'fixture',models:[{provider:'local',model:'fixture',reasoning:[null]}]}});
 await bindDispatchTicket(root,{execution_id:ticket.execution_id,source:{kind:'host-report',thread_id:'fixture-thread',turn_id:'fixture-turn'},sample_kind:'fixture'});
 await reportHostUsage(root,{binding_id:ticket.execution_id,report_id:'done',actor,claim_id:snapshot.claim.id,contract_sha256:snapshot.contract_sha256,status:'completed',usage:{input_tokens:8,output_tokens:3,total_tokens:11,cost_usd:null},tool:'fixture',provider:'local',model:'fixture',observed_at:new Date().toISOString()});
 await closeHostUsage(root,{binding_id:ticket.execution_id,actor});
 await mutateNativeTask(root,snapshot.id,'cancel',{operation_id:'cancel',expected_version:2,actor,summary:'End synthetic task',evidence:['docs/approval.md']});
 const dir=root+'/.ai-org/artifacts/'+snapshot.id;await fs.mkdir(dir,{recursive:true});
 const proof=dir+'/dispatch-claim-'+ticket.task_hash+'.json';
 return {root,snapshot,ticket,proof};
}

test('exact retained claim restores existing usage without reviving execution or changing canonical history',async t=>{
 const f=await fixture(t),file=f.root+'/.ai-org/work-items/'+f.snapshot.id+'.json',before=await fs.readFile(file,'utf8');
 await assert.rejects(readDispatchTicket(f.root,f.ticket.execution_id),/historical claim mismatch/);
 assert.equal((await readHostMeasurements(f.root)).errors.length,1);
 await fs.writeFile(f.proof,JSON.stringify(f.snapshot));
 assert.deepEqual(await readDispatchTicket(f.root,f.ticket.execution_id),f.ticket);
 const m=await readHostMeasurements(f.root);assert.equal(m.errors.length,0);assert.equal(m.byTask.get(f.snapshot.id)[0].operations[0].usage.total_tokens,11);
 await assert.rejects(bindDispatchTicket(f.root,{execution_id:f.ticket.execution_id,source:{kind:'host-report',thread_id:'new-thread',turn_id:'new-turn'}}),/claim|state|build/i);
 assert.equal(await fs.readFile(file,'utf8'),before);
});

test('claim proof rejects forged bodies and internally rehashed histories against the current chain',async t=>{
 const f=await fixture(t);
 for(const change of [s=>s.claim.id='claim-forged',s=>s.contract.goal='forged',s=>s.claim.actor.agent_id='reviewer',s=>s.id='WK-other',s=>s.version=1]) {
  const s=structuredClone(f.snapshot);change(s);await fs.writeFile(f.proof,JSON.stringify(s));await assert.rejects(readDispatchTicket(f.root,f.ticket.execution_id));
 }
 const rehashed=structuredClone(f.snapshot);rehashed.claim.id='claim-forged';
 rehashed.history.at(-1).record_sha256=executionDigest(Object.fromEntries(Object.entries(rehashed).filter(([k])=>k!=='history')));
 const {hash,...body}=rehashed.history.at(-1);rehashed.history.at(-1).hash=executionDigest(body);
 await fs.writeFile(f.proof,JSON.stringify(rehashed));await assert.rejects(readDispatchTicket(f.root,f.ticket.execution_id),/snapshot mismatch/);
 assert.equal((await readHostMeasurements(f.root)).errors.length,1);
});

test('claim proof reads are bounded and reject symlinks and malformed content',async t=>{
 const f=await fixture(t),target=f.root+'/proof.json';await fs.writeFile(target,JSON.stringify(f.snapshot));await fs.symlink(target,f.proof);
 await assert.rejects(readDispatchTicket(f.root,f.ticket.execution_id));await fs.unlink(f.proof);
 for(const bytes of ['{bad',' '.repeat(1024*1024+1)]) {await fs.writeFile(f.proof,bytes);await assert.rejects(readDispatchTicket(f.root,f.ticket.execution_id));}
});
