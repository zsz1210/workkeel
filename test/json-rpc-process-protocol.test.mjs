import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createJsonRpcProcess} from '../src/codex-app-server-provider.mjs';

const fixture=`let buffer='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\\n'))!==-1){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);consume(line);}});
function consume(line){
 const m=JSON.parse(line);
 if(m.method==='pending')return;
 if(m.method==='emit'){process.stdout.write(m.params.frame+'\\n');return;}
 const bytes=Buffer.from(JSON.stringify({id:m.id,result:m.params})+'\\r\\n');
 if(m.method==='split'){
   const split=bytes.indexOf(Buffer.from('雪'))+1;
   process.stdout.write(bytes.subarray(0,split));
   setTimeout(()=>process.stdout.write(bytes.subarray(split,bytes.length-1)),10);
   setTimeout(()=>process.stdout.write(bytes.subarray(bytes.length-1)),150);
 }else process.stdout.write(bytes);
}`;
function rpc(t,errors=[]){
  const c=createJsonRpcProcess(process.execPath,['-e',fixture],{onProtocolError:e=>errors.push(e)});
  t.after(()=>c.close());return c;
}
test('chunked Unicode and delayed CRLF stay one valid JSONL message',async t=>{
  const errors=[],c=rpc(t,errors);
  assert.deepEqual(await c.request('split',{value:'雪'}),{value:'雪'});
  await new Promise(r=>setTimeout(r,180));
  assert.deepEqual(await c.request('next',{ok:true}),{ok:true});assert.deepEqual(errors,[]);
});
test('JSON string line and paragraph separators survive real subprocess framing',async t=>{
  const errors=[],c=rpc(t,errors),value={value:'雪\u2028middle\u2029end'};
  assert.deepEqual(await c.request('split',value),value);
  assert.deepEqual(await c.request('next',{ok:true}),{ok:true});
  assert.deepEqual(errors,[]);
});
test('legal embedded CR whitespace and multiple LF frames remain independent',async t=>{
  const errors=[],c=rpc(t,errors);
  const pending=c.request('pending',{},3000);
  c.notify('emit',{frame:'{\r"id":1,\r"result":"ok"}\n{"method":"notice"}'});
  assert.equal(await pending,'ok');assert.deepEqual(errors,[]);
});
test('malformed unterminated tail is diagnosed before exit',async t=>{
  const errors=[];
  const c=createJsonRpcProcess(process.execPath,['-e',`process.stdin.once('data',()=>{process.stdout.end('{"id":');});`],{onProtocolError:e=>errors.push(e)});
  t.after(()=>c.close());
  await assert.rejects(c.request('test',{},3000));
  assert.equal(errors[0]?.protocolDiagnostic.reason,'invalid-json');
});
test('malformed frame rejects all pending calls promptly and retains only first content-free evidence',async t=>{
  const errors=[],c=rpc(t,errors),raw='{"secret":"PRIVATE-SENTINEL"';
  const one=assert.rejects(c.request('pending',{},3000),/invalid protocol frame/);
  const two=assert.rejects(c.request('emit',{frame:raw+'\nSECOND-PRIVATE-FRAME'},3000),/invalid protocol frame/);
  await Promise.all([one,two]);
  const d=errors[0].protocolDiagnostic;
  assert.equal(errors.length,1);assert.equal(d.reason,'invalid-json');assert.equal(d.frame_class,'json-like');
  assert.equal(d.frame_bytes,Buffer.byteLength(raw));assert.equal(d.frame_sha256,createHash('sha256').update(raw).digest('hex'));
  assert.equal(d.pending_requests,2);assert.equal(d.raw_content_retained,false);
  assert.doesNotMatch(JSON.stringify(errors[0]),/PRIVATE|secret/);
  await assert.rejects(c.request('turn/start'),e=>e===errors[0]);
  assert.throws(()=>c.notify('turn/start'),e=>e===errors[0]);
  assert.deepEqual(await c.request('thread/backgroundTerminals/list',{data:[]}),{data:[]});
  await c.close();assert(c.child.exitCode!==null||c.child.signalCode!==null);
});
for(const [frame,reason]of [['','invalid-json'],['progress PRIVATE-SENTINEL','invalid-json'],['null','invalid-envelope'],['[]','invalid-envelope'],['{}','invalid-envelope'],['{"id":1}','invalid-envelope'],['{"id":null,"result":true}','invalid-envelope'],['{"id":1,"error":{"message":"PRIVATE-SENTINEL"}}','invalid-envelope']]){
  test('invalid frame is contained: '+(frame.slice(0,10)||'empty'),async t=>{
    const errors=[],c=rpc(t,errors);
    await assert.rejects(c.request('emit',{frame},3000),/invalid protocol frame/);
    assert.equal(errors[0].protocolDiagnostic.reason,reason);
    assert.doesNotMatch(JSON.stringify(errors[0]),/PRIVATE-SENTINEL/);
  });
}
