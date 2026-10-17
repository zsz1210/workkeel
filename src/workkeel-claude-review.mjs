// Opt-in protocol preparation only. The caller owns authorization, process
// isolation, timeout, raw capture and descendant cleanup; this module launches nothing.
import Ajv from 'ajv/dist/2020.js';

export const CLAUDE_REVIEW_VERSION = '2.1.287';
const fields=['rule_id','file','line_start','line_end','scenario','actual','expected','recommendation'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const sum=(...values)=>values.every(v=>v!==null)&&Number.isSafeInteger(values.reduce((a,b)=>a+b,0))?values.reduce((a,b)=>a+b,0):null;
const unknownUsage=()=>({input_tokens:null,cached_input_tokens:null,cache_write_input_tokens:null,output_tokens:null,reasoning_output_tokens:null,total_tokens:null});

function nativeUsage(raw) {
  const u=object(raw.usage)?raw.usage:{},usage=unknownUsage(),warnings=[];
  // Claude's input_tokens excludes cache creation/read. Both are included once.
  usage.cached_input_tokens=count(u.cache_read_input_tokens);
  usage.cache_write_input_tokens=count(u.cache_creation_input_tokens);
  usage.input_tokens=sum(count(u.input_tokens),usage.cached_input_tokens,usage.cache_write_input_tokens);
  usage.output_tokens=count(u.output_tokens);
  const models=object(raw.modelUsage)?Object.values(raw.modelUsage):[];
  const primary=u.output_tokens_details?.thinking_tokens;
  const fallback=models.length===1?models[0]?.thinkingTokens:undefined;
  let thinking=count(primary===undefined?fallback:primary);
  if(primary!==undefined&&fallback!==undefined&&count(primary)!==count(fallback)){
    thinking=null;warnings.push('conflicting-reasoning-counts');
  }
  if(thinking!==null&&(usage.output_tokens===null||thinking>usage.output_tokens)){
    thinking=null;warnings.push('reasoning-count-out-of-range');
  }
  usage.reasoning_output_tokens=thinking;
  usage.total_tokens=sum(usage.input_tokens,usage.output_tokens);
  // All-zero counters on an error do not establish that inference was free.
  if(raw.is_error===true&&usage.total_tokens===0)return {usage:unknownUsage(),warnings:['unconfirmed-zero-error-usage']};
  return {usage,warnings};
}

/** Build one fresh, supplied-source-only review invocation for the qualified CLI. */
export function prepareClaudeSourceReview({files,version,model,expected_model,reasoning,session_id}) {
  if(version!==CLAUDE_REVIEW_VERSION)throw Error('Claude source review requires the qualified CLI version');
  if(typeof model!=='string'||!model.trim()||model.startsWith('-')||/[\s\x00-\x1f]/.test(model)||
     typeof expected_model!=='string'||!/^claude-[a-z0-9-]+$/.test(expected_model))throw Error('Explicit approved Claude model identities required');
  if(!['low','medium','high','xhigh','max'].includes(reasoning))throw Error('Explicit supported reasoning required');
  if(typeof session_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(session_id))throw Error('Fresh session UUID required');
  if(!object(files)||!Object.keys(files).length||Object.keys(files).length>32)throw Error('Bounded source files required');
  const sources=structuredClone(files),lines=Object.create(null);let bytes=0;
  for(const [file,source] of Object.entries(sources)){
    if(!file||file.startsWith('/')||file.includes('\\')||/^[A-Za-z]:/.test(file)||/[\x00-\x1f]/.test(file)||file.split('/').some(p=>!p||p==='.'||p==='..')||typeof source!=='string')throw Error('Invalid supplied source file');
    bytes+=Buffer.byteLength(source);lines[file]=source.split('\n').length;
  }
  if(bytes>512*1024)throw Error('Source packet exceeds byte bound');
  const text={type:'string',minLength:1,maxLength:6000};
  const schema={type:'object',additionalProperties:false,required:['findings'],properties:{findings:{type:'array',maxItems:8,items:{
    type:'object',additionalProperties:false,required:fields,properties:{rule_id:{type:'string',enum:['review']},file:{type:'string',enum:Object.keys(sources)},
      line_start:{type:'integer',minimum:1},line_end:{type:'integer',minimum:1},scenario:text,actual:text,expected:text,recommendation:text}
  }}}};
  const validate=new Ajv({allErrors:false,strict:true}).compile(schema);
  const args=Object.freeze(['--print','--model',model,'--effort',reasoning,'--safe-mode','--session-id',session_id,'--no-session-persistence',
    '--output-format','json','--json-schema',JSON.stringify(schema),'--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
    '--permission-mode','dontAsk','--disable-slash-commands','--no-chrome']);

  function parse(stdout,processResult) {
    const result={status:'invalid-output',findings:null,usage:unknownUsage(),usage_completeness:'unknown',usage_warnings:[],model:null,
      reported_reasoning:null,reported_cost_usd:null,error:null};
    let raw;
    try {
      if(typeof stdout!=='string'||Buffer.byteLength(stdout)>2*1024*1024)throw Error('Terminal output exceeds bound');
      raw=JSON.parse(stdout);if(!object(raw))throw Error('Terminal result must be an object');
    } catch(error){return {...result,error:error.message};}
    const native=nativeUsage(raw);result.usage=native.usage;result.usage_warnings=native.warnings;
    result.usage_completeness=result.usage.total_tokens!==null?'complete':Object.values(result.usage).some(v=>v!==null)?'partial':'unknown';
    const models=object(raw.modelUsage)?Object.keys(raw.modelUsage):[];
    result.model=models.length===1?models[0]:null;
    if(Number.isFinite(raw.total_cost_usd)&&raw.total_cost_usd>=0)result.reported_cost_usd=raw.total_cost_usd;
    const fail=(status,error)=>({...result,status,error});
    if(processResult?.process_exit_confirmed!==true)return fail('process-cleanup-unconfirmed','Owned process group exit was not confirmed');
    if(processResult.timed_out===true)return fail('timeout','Review deadline exceeded');
    if(processResult.instrument_error!==null||processResult.execution_started!==true||processResult.surviving_descendants!==false)
      return fail('instrument-failure','Review startup, instrumentation or descendant cleanup was not confirmed');
    if(processResult.timed_out!==false||processResult.exit_code!==0)return fail('infrastructure-failure','Review process did not exit successfully');
    if(raw.type!=='result'||raw.subtype!=='success'||raw.is_error!==false)return fail('runtime-error','Claude terminal result was not successful');
    if(raw.session_id!==session_id)return fail('session-mismatch','Claude returned a different or missing session');
    if(result.model!==expected_model)return fail('model-mismatch','Approved runtime model was not confirmed');
    // Never scrape .result prose, strip Markdown, or repair fields to produce success.
    if(!Object.hasOwn(raw,'structured_output')||!validate(raw.structured_output))return fail('invalid-output','Missing or invalid structured_output');
    for(const finding of raw.structured_output.findings){
      if(!Number.isSafeInteger(finding.line_start)||!Number.isSafeInteger(finding.line_end)||finding.line_end<finding.line_start||
         finding.line_end>lines[finding.file]||fields.filter(k=>!k.startsWith('line_')).some(k=>!finding[k].trim()))return fail('invalid-output','Finding text or source anchor is invalid');
    }
    return {...result,status:'completed',findings:structuredClone(raw.structured_output.findings)};
  }
  return Object.freeze({args,schema:structuredClone(schema),parse});
}
