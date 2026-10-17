import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareClaudeSourceReview,CLAUDE_REVIEW_VERSION} from '../src/workkeel-claude-review.mjs';

const options=()=>({files:{'src/space 測試.mjs':'export const value=1;\n'},version:CLAUDE_REVIEW_VERSION,model:'opus',expected_model:'claude-opus-5-5',reasoning:'high',session_id:'00000000-1111-2222-3333-444444444444'});
const processResult={exit_code:0,timed_out:false,process_exit_confirmed:true,instrument_error:null,execution_started:true,surviving_descendants:false};
const reply=()=>({type:'result',subtype:'success',is_error:false,session_id:options().session_id,result:'Not the structured channel',structured_output:{findings:[]},usage:{input_tokens:11,cache_read_input_tokens:20,cache_creation_input_tokens:30,output_tokens:10,output_tokens_details:{thinking_tokens:7}},modelUsage:{'claude-opus-5-5':{thinkingTokens:7}}});
const parse=(value=reply(),process=processResult)=>prepareClaudeSourceReview(options()).parse(JSON.stringify(value),process);

test('qualified source review builds explicit schema, tool restriction and fresh-session arguments',()=>{
  const p=prepareClaudeSourceReview(options()),value=key=>p.args[p.args.indexOf(key)+1];
  assert.deepEqual(JSON.parse(value('--json-schema')),p.schema);assert.equal(value('--tools'),'');
  assert.deepEqual(JSON.parse(value('--mcp-config')),{mcpServers:{}});assert.equal(value('--permission-mode'),'dontAsk');
  for(const flag of ['--safe-mode','--strict-mcp-config','--no-session-persistence','--disable-slash-commands','--no-chrome'])assert.ok(p.args.includes(flag));
  for(const flag of ['--resume','--continue','--fallback-model','--dangerously-skip-permissions'])assert.ok(!p.args.includes(flag));
  for(const changed of [{version:'2.1.286'},{reasoning:'auto'},{session_id:'old'},{expected_model:'auto'},{model:'--bad'}])assert.throws(()=>prepareClaudeSourceReview({...options(),...changed}));
});

test('native structured channel retains counters once and ignores unrelated prose',()=>{
  const r=parse();assert.equal(r.status,'completed');assert.deepEqual(r.findings,[]);
  assert.deepEqual(r.usage,{input_tokens:61,cached_input_tokens:20,cache_write_input_tokens:30,output_tokens:10,reasoning_output_tokens:7,total_tokens:71});
  assert.equal(r.reported_reasoning,null);
});

test('prose-only JSON and fenced JSON never substitute for structured_output',()=>{
  for(const text of ['{"findings":[]}','```json\n{"findings":[]}\n```']){
    const r=reply();delete r.structured_output;r.result=text;const actual=parse(r);
    assert.equal(actual.status,'invalid-output');assert.equal(actual.findings,null);assert.equal(actual.usage.total_tokens,71);
  }
});

test('strict shape, whitespace, filenames and per-file anchors reject invalid findings',()=>{
  const valid={rule_id:'review',file:'src/space 測試.mjs',line_start:1,line_end:1,scenario:'trigger',actual:'bad',expected:'good',recommendation:'repair'};
  for(const change of [{extra:'x'},{file:'elsewhere.mjs'},{line_start:0},{line_start:2,line_end:1},{line_end:3},{actual:' '},{rule_id:'other'}]){
    const r=reply();r.structured_output.findings=[{...valid,...change}];assert.equal(parse(r).status,'invalid-output');
  }
  const r=reply();r.structured_output.findings=[valid];assert.equal(parse(r).status,'completed');
  r.structured_output.findings=Array(9).fill(valid);assert.equal(parse(r).status,'invalid-output');
  r.structured_output={findings:[],extra:1};assert.equal(parse(r).status,'invalid-output');
});

test('source snapshot cannot change anchors after protocol creation',()=>{
  const o=options(),p=prepareClaudeSourceReview(o);o.files['src/space 測試.mjs']+='\n'.repeat(20);
  const r=reply();r.structured_output.findings=[{rule_id:'review',file:'src/space 測試.mjs',line_start:8,line_end:8,scenario:'x',actual:'x',expected:'x',recommendation:'x'}];
  assert.equal(p.parse(JSON.stringify(r),processResult).status,'invalid-output');
});

test('runtime errors, model/session mismatch and termination retain usage without findings',()=>{
  for(const change of [{is_error:true,subtype:'error_max_structured_output_retries'},{session_id:'other'},{modelUsage:{'claude-other':{}}},{type:'assistant'},{is_error:undefined}]){
    const r=parse({...reply(),...change});assert.notEqual(r.status,'completed');assert.equal(r.findings,null);assert.equal(r.usage.total_tokens,71);
  }
  for(const [change,status] of [[{exit_code:1},'infrastructure-failure'],[{exit_code:null},'infrastructure-failure'],
    [{timed_out:true},'timeout'],[{timed_out:undefined},'infrastructure-failure'],[{process_exit_confirmed:false},'process-cleanup-unconfirmed']]){
    const r=parse(reply(),{...processResult,...change});assert.equal(r.status,status);assert.equal(r.findings,null);assert.equal(r.usage.total_tokens,71);
  }
  assert.equal(parse(reply(),{}).status,'process-cleanup-unconfirmed');
});

test('native partial, zero, conflicting and out-of-range counters stay honest',()=>{
  let r=reply();delete r.usage.cache_creation_input_tokens;assert.equal(parse(r).usage.input_tokens,null);assert.equal(parse(r).usage.total_tokens,null);assert.equal(parse(r).usage_completeness,'partial');
  r=reply();r.usage={input_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:0,output_tokens_details:{thinking_tokens:0}};r.modelUsage['claude-opus-5-5'].thinkingTokens=0;assert.equal(parse(r).usage.total_tokens,0);assert.equal(parse(r).usage.reasoning_output_tokens,0);
  r.is_error=true;assert.equal(parse(r).usage.total_tokens,null);
  r=reply();r.modelUsage['claude-opus-5-5'].thinkingTokens=6;assert.equal(parse(r).usage.reasoning_output_tokens,null);assert.deepEqual(parse(r).usage_warnings,['conflicting-reasoning-counts']);
  r=reply();delete r.usage.output_tokens_details;assert.equal(parse(r).usage.reasoning_output_tokens,7);
  r=reply();r.usage.output_tokens_details.thinking_tokens=11;r.modelUsage['claude-opus-5-5'].thinkingTokens=11;assert.equal(parse(r).usage.reasoning_output_tokens,null);
  r=reply();r.usage.input_tokens=Number.MAX_SAFE_INTEGER;assert.equal(parse(r).usage.input_tokens,null);
});

test('successful command and valid findings cannot override an instrument failure or missing supervision evidence',()=>{
  for(const change of [{instrument_error:'supervisor-exit-mismatch'},{instrument_error:undefined},{execution_started:false},
    {execution_started:undefined},{surviving_descendants:true},{surviving_descendants:undefined}]){
    const r=parse(reply(),{...processResult,...change});
    assert.equal(r.status,'instrument-failure');assert.equal(r.findings,null);assert.equal(r.usage.total_tokens,71);
  }
});
