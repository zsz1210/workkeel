import test from 'node:test';
import assert from 'node:assert/strict';
import {runSupervisedCommand} from '../src/delivery-check.mjs';

const run=source=>runSupervisedCommand({executable:process.execPath,args:['-e',source],cwd:process.cwd(),env:process.env},{timeout_ms:5000,output_limit_bytes:4096});

test('supervised command retains genuine successful and unsuccessful exit codes',async()=>{
  for(const code of [0,7]){
    const result=await run(`process.exit(${code})`);
    assert.equal(result.execution_started,true);assert.equal(result.exit_code,code);
    assert.equal(result.instrument_error,null);assert.equal(result.process_exit_confirmed,true);
  }
});

test('signal termination is not converted to an assertion failure exit code',async()=>{
  const result=await run("process.kill(process.pid,'SIGTERM')");
  assert.equal(result.execution_started,true);assert.equal(result.exit_code,null);
  assert.equal(result.instrument_error,'command-terminated-SIGTERM');assert.equal(result.process_exit_confirmed,true);
});

const descendant=delay=>`const {spawn}=require('node:child_process');
 const child=spawn(process.execPath,['-e',${JSON.stringify("process.send('ready');process.disconnect();setTimeout(()=>process.exit(0),"+delay+")")}],{stdio:['ignore','ignore','ignore','ipc']});
 child.once('message',()=>{process.stdout.write('child-ready\\n');process.exit(0);});`;

test('successful command allows bounded natural descendant drain before classifying survivors',async()=>{
  const result=await run(descendant(150));
  assert.equal(result.execution_started,true);assert.equal(result.exit_code,0);
  assert.equal(result.instrument_error,null);assert.equal(result.process_exit_confirmed,true);
  assert.equal(result.surviving_descendants,false);
  assert.match(result.stdout,/child-ready/);
  assert.deepEqual(result.termination_signal_errors,[]);
});

test('a lingering descendant still fails cleanup and is killed within a bounded interval',async()=>{
  const start=Date.now(),result=await run(descendant(10000));
  assert.equal(result.exit_code,0);assert.equal(result.surviving_descendants,true);
  assert.match(result.stdout,/child-ready/);
  assert.equal(result.process_exit_confirmed,true);assert.ok(Date.now()-start<4000);
});

test('a failed cleanup signal remains an instrument error even when subsequent cleanup succeeds',async()=>{
  const original=process.kill;let injected=false;
  try {
    const result=await runSupervisedCommand({executable:process.execPath,args:['-e',descendant(10000)],cwd:process.cwd(),env:process.env},{timeout_ms:5000,output_limit_bytes:4096,hooks:{started({process_group_id}){
      process.kill=function(pid,signal){if(pid===-process_group_id&&signal==='SIGKILL'&&!injected){injected=true;throw Object.assign(new Error('Injected owned-group permission failure'),{code:'EPERM'});}return original.call(process,pid,signal);};
    }}});
    assert.equal(injected,true);assert.equal(result.instrument_error,'process-group-signal-failed');
    assert.deepEqual(result.termination_signal_errors,['EPERM']);assert.equal(result.surviving_descendants,true);assert.equal(result.process_exit_confirmed,true);
  } finally {process.kill=original;}
});
