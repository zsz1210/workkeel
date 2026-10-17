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
