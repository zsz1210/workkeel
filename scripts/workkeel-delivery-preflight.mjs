import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {exactKeys} from '../src/workkeel-execution-policy.mjs';
import {readDeliveryContext,checkDeliveryReports} from './workkeel-delivery.mjs';
import {inspectTaskCandidate} from '../src/workkeel-tasks.mjs';
import {documentationLanguageIssue} from './documentation-policy.mjs';

const LIMIT=1024*1024;
const METRICS=['active_duration_ms','input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=async(root,...args)=>(await promisify(execFile)('git',['-C',root,...args],{encoding:'buffer',maxBuffer:LIMIT+1024,timeout:5000})).stdout;

// Revalidate traversal identities around the descriptor read. This detects
// concurrent replacements; it is an observation guard, not a filesystem sandbox.
async function boundedFile(filename,limit) {
  const absolute=path.resolve(filename),parts=absolute.split(path.sep).filter(Boolean);
  const entries=[];
  let current=path.parse(absolute).root;
  for(const part of parts) {
    current=path.join(current,part);
    const stat=await fs.lstat(current);
    if(stat.isSymbolicLink())throw Error('symlink');
    if(current!==absolute&&!stat.isDirectory())throw Error('parent');
    entries.push({name:current,stat});
  }
  const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode;
  const stable=async()=>{
    for(const entry of entries)if(!same(entry.stat,await fs.lstat(entry.name)))throw Error('path replaced');
    if(await fs.realpath(absolute)!==absolute)throw Error('path redirected');
  };
  const handle=await fs.open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat();
    if(!same(before,entries.at(-1).stat))throw Error('opened file replaced');
    if(!before.isFile()||before.size>limit)throw Error('bounded regular file required');
    await stable();
    const bytes=Buffer.alloc(limit+1);let size=0;
    while(size<bytes.length) {
      const result=await handle.read(bytes,size,bytes.length-size,null);
      if(!result.bytesRead)break;size+=result.bytesRead;
    }
    const after=await handle.stat();
    if(size>limit||size!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('changed while reading');
    await stable();
    return bytes.subarray(0,size);
  } finally {await handle.close();}
}

function aggregate(rows,key) {
  const values=rows.map(row=>key==='active_duration_ms'?row.receipt?.[key]:row.receipt?.usage?.[key]);
  const known=values.filter(value=>Number.isSafeInteger(value)&&value>=0);
  const sum=known.reduce((total,value)=>total+BigInt(value),0n),overflow=sum>BigInt(Number.MAX_SAFE_INTEGER);
  return {value:known.length&&!overflow?Number(sum):null,known:known.length,expected:rows.length,
    coverage:overflow?'overflow':known.length===0?'unknown':known.length===rows.length?'complete':'partial'};
}

/** Observations for explicit evidence and declared operations only; no gate is executed. */
export async function readDeliveryPreflight(target,request) {
  exactKeys(request,['task_id','expected','candidate_revision','evidence']);
  if(typeof request.candidate_revision!=='string'||! /^[a-f0-9]{40}$/.test(request.candidate_revision))throw Error('exact candidate required');
  if(!Array.isArray(request.evidence)||request.evidence.length===0||request.evidence.length>64||new Set(request.evidence).size!==request.evidence.length)throw Error('explicit evidence required');
  for(const file of request.evidence)if(typeof file!=='string'||file.length>1024||path.isAbsolute(file)||file.includes('\\')||file.split('/').some(part=>!part||part==='.'||part==='..')||/[\x00-\x1f\x7f]/.test(file))throw Error('relative evidence required');
  const root=await fs.realpath(target);
  const context=await readDeliveryContext(root,request.task_id);
  const reports=await checkDeliveryReports(root,{task_id:request.task_id,expected:request.expected});
  const candidateIssues=[];
  try {
    const type=(await git(root,'cat-file','-t',request.candidate_revision)).toString().trim();
    if(type!=='commit')candidateIssues.push('candidate-not-commit');
    if((await git(root,'rev-parse','HEAD')).toString().trim()!==request.candidate_revision)candidateIssues.push('candidate-not-head');
  } catch {candidateIssues.push('candidate-unavailable');}
  const evidence=[];
  for(const file of request.evidence) {
    const row={path:file,status:'unavailable',current_sha256:null,candidate_sha256:null,issues:[]};
    try {
      const bytes=await boundedFile(path.join(root,file),LIMIT);
      row.current_sha256=hash(bytes);
      if(file.endsWith('.md')) {
        const issue=documentationLanguageIssue(file,new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        if(issue)row.issues.push('documentation-language-policy');
      }
      const tree=(await git(root,'ls-tree','-z',request.candidate_revision,'--',`:(literal)${file}`)).toString();
      const match=/^(100644|100755) blob ([a-f0-9]{40})\t/.exec(tree);
      if(!match)row.issues.push('candidate-file-not-tracked-regular');
      else {
        const blob=await git(root,'cat-file','blob',match[2]);
        row.candidate_sha256=hash(blob);
        if(row.current_sha256!==row.candidate_sha256)row.issues.push('candidate-bytes-mismatch');
      }
      row.status=row.issues.length?'failed':'matched';
    } catch {row.issues.push('evidence-unavailable-or-unsafe');}
    evidence.push(row);
  }
  // Recheck HEAD after reads so candidate movement during inspection is visible.
  try {if((await git(root,'rev-parse','HEAD')).toString().trim()!==request.candidate_revision&&!candidateIssues.includes('candidate-not-head'))candidateIssues.push('candidate-not-head');}
  catch {if(!candidateIssues.includes('candidate-unavailable'))candidateIssues.push('candidate-unavailable');}
  const contextWarnings=context.evidence.filter(item=>item.status!=='verified');
  return {schema_version:'workkeel.delivery-preflight/v1',authority:'observation-only',mutation_status:'no-write',execution_authorized:false,
    task_id:context.task_id,candidate_revision:request.candidate_revision,candidate_issues:candidateIssues,
    evidence_preflight_passed:candidateIssues.length===0&&evidence.every(row=>row.status==='matched')&&contextWarnings.length===0,
    full_verification:'not-run',actual_review:'not-performed',task_coverage_complete:false,coverage:'declared-operations-only',
    evidence,context_evidence:context.evidence,context_attention_reasons:context.attention_reasons,
    reports,totals:Object.fromEntries(METRICS.map(key=>[key,aggregate(reports.expected_operations,key)])),elapsed_ms:null,
    limitations:['Evidence matches are observations, not proof of verification, review or acceptance.',
      'Operation time is additive and may overlap; elapsed time is unknown.',
      'Cached input is a subset of input and is never added to input. Total tokens are reported values, not inferred.',
      ...reports.limitations]};
}

// Inline literals avoid Markdown injection while preserving non-English identifiers.
const literal=value=>'`'+String(value??'unknown').replace(/[`|<>\r\n\x00-\x1f\x7f]/g,char=>'&#'+char.charCodeAt(0)+';')+'`';
const number=value=>Number.isSafeInteger(value)&&value>=0?String(value):'unknown';
export function renderDeliveryReport(result) {
  const lines=['# Delivery evidence preflight','',`Task: ${literal(result.task_id)}`,`Candidate: ${literal(result.candidate_revision)}`,'',
    `Evidence preflight passed: ${result.evidence_preflight_passed===true?'yes':'no'}`,
    'Full verification: not-run. Actual review: not-performed.','',
    `Native task state: ${literal(result.reports.task_state)}. Locally accepted: ${result.reports.task_locally_accepted?'yes':'no'}.`,
    `Declared source collection: ${literal(result.reports.collection.status)}. Required reports complete: ${result.reports.declared_reports_complete?'yes':'no'}.`,'',
    'Observations only. Coverage is limited to declared operations; whole-task coverage is not established.','',
    '| Operation | Kind | Status | Model | Active ms | Input | Cached input | Output | Total |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |'];
  for(const row of result.reports.expected_operations)lines.push(`| ${literal(row.label)} | ${literal(row.activity_kind)} | ${literal(row.status)} | ${literal(row.receipt?.model)} | ${number(row.receipt?.active_duration_ms)} | ${number(row.receipt?.usage?.input_tokens)} | ${number(row.receipt?.usage?.cached_input_tokens)} | ${number(row.receipt?.usage?.output_tokens)} | ${number(row.receipt?.usage?.total_tokens)} |`);
  lines.push('','## Collection and recording cutoffs','',
    '| Operation | Collection | Usage observed at | Activity ended at | Collected at | Usage observed later |',
    '| --- | --- | --- | --- | --- | --- |');
  for(const row of result.reports.expected_operations) {
    const receipt=row.receipt,cutoffs=receipt?.cutoffs;
    lines.push(`| ${literal(row.label)} | ${literal(row.collection_status)} | ${literal(cutoffs?.usage_observed_at)} | ${literal(cutoffs?.activity_ended_at)} | ${literal(cutoffs?.collected_at)} | ${cutoffs?.usage_observed_after_activity===null||cutoffs?.usage_observed_after_activity===undefined?'unknown':cutoffs.usage_observed_after_activity?'yes':'no'} |`);
  }
  lines.push('','Timestamps are recording cutoffs, not matching work boundaries. Later usage does not extend activity time or establish tokens per second.','',
    '## Follow-up','');
  for(const item of result.reports.collection.follow_up)lines.push(`- ${literal(item.label)}: ${item.actions.map(literal).join(', ')}.`);
  if(!result.reports.collection.follow_up.length)lines.push('No operation follow-up identified. Check inventory warnings separately.');
  lines.push('','| Metric | Known sum | Known / expected | Coverage |','| --- | ---: | ---: | --- |');
  for(const key of METRICS) {
    const total=result.totals[key];lines.push(`| ${literal(key)} | ${number(total.value)} | ${total.known} / ${total.expected} | ${literal(total.coverage)} |`);
  }
  lines.push('','Operation time can overlap; elapsed time is unknown. Cached input is included in input.','',
    '## Evidence','');
  for(const row of result.evidence)lines.push(`- ${literal(row.path)}: ${literal(row.status)}; current SHA-256 ${literal(row.current_sha256)}; candidate SHA-256 ${literal(row.candidate_sha256)}; issues: ${row.issues.map(literal).join(', ')||'none'}.`);
  lines.push('','## Warnings','',`- Unlisted bindings: ${result.reports.unlisted_binding_count}.`);
  for(const issue of result.candidate_issues)lines.push(`- Candidate: ${literal(issue)}.`);
  for(const issue of result.context_attention_reasons)lines.push(`- Context: ${literal(issue)}.`);
  for(const row of result.context_evidence.filter(item=>item.status!=='verified'))lines.push(`- Recorded evidence: ${literal(row.path??row.ref??'unknown')}, ${literal(row.status)}.`);
  for(const issue of result.reports.inventory_errors)lines.push(`- Inventory: ${literal(JSON.stringify(issue))}.`);
  for(const row of result.reports.expected_operations)for(const issue of row.issues)lines.push(`- ${literal(row.label)}: ${literal(issue)}.`);
  lines.push('','No verification, review, acceptance, source collection or lifecycle mutation was performed.','');
  return lines.join('\n');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)try {
  const [command,target,input,...extra]=process.argv.slice(2);
  if(extra.length||!target||!input||!['check','report','candidate'].includes(command))throw Error('invalid command');
  const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedFile(input,64*1024)));
  if(command==='candidate') {
    exactKeys(request,['task_id','action','request']);
    const result=await inspectTaskCandidate(target,request.task_id,{action:request.action,request:request.request});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(!result.candidate_files_passed)process.exitCode=1;
  } else {
    const result=await readDeliveryPreflight(target,request);
    process.stdout.write(command==='report'?renderDeliveryReport(result):JSON.stringify(result,null,2)+'\n');
    if(!result.evidence_preflight_passed)process.exitCode=1;
  }
} catch {
  process.stdout.write(JSON.stringify({error:'delivery-preflight-request-failed',authority:'observation-only',mutation_status:'no-write',full_verification:'not-run',actual_review:'not-performed'})+'\n');
  process.exitCode=1;
}
