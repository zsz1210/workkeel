import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readNativeTask} from './workkeel-tasks.mjs';
import {readNativeGit} from './workkeel-project.mjs';

/** Evidence coverage is not semantic correctness or independent acceptance. */
export async function checkCompletionEvidence(target,taskId,report){
  const root=await fs.realpath(target),task=await readNativeTask(root,taskId),head=(await readNativeGit(root,['rev-parse','HEAD'])).trim(),issues=[],seen=new Set();
  const issue=(code,criterion=null)=>issues.push({code,criterion});
  if(!report||report.schema_version!=='workkeel.completion-evidence/v1'||!['not-applicable','code-first','preview-first','design-led'].includes(report.ui_mode))throw Error('Invalid completion evidence report');
  if(report.candidate_revision!==head)issue('candidate-mismatch');
  const tracked=(await readNativeGit(root,['diff','--name-only','HEAD','--'])).trim(),untracked=(await readNativeGit(root,['ls-files','--others','--exclude-standard'])).trim();
  // Lifecycle records can legitimately advance after a candidate commit.
  const productChanges=[tracked,untracked].flatMap(list=>list.split('\n')).filter(file=>file&&!file.startsWith('.ai-org/')&&!file.startsWith('.workkeel-private/'));
  if(productChanges.length)issue('candidate-working-tree-drift');
  if(!Array.isArray(report.requirements)||report.requirements.length>64||!Array.isArray(report.self_reviews)||report.self_reviews.length>16||!Array.isArray(report.open_findings)||report.open_findings.length>64)throw Error('Completion evidence exceeds its bounded contract');
  const criteria=task.contract.acceptance.criteria,covered=new Set(),visual=report.ui_mode!=='not-applicable';
  async function evidence(ref){
    if(!ref||typeof ref.path!=='string'||!ref.path||path.isAbsolute(ref.path)||ref.path.split(/[\\/]/).some(part=>!part||part==='.'||part==='..')||!/^[a-f0-9]{64}$/.test(ref.sha256??''))throw Error('Invalid evidence path or digest');
    if(![...task.contract.environment.read_paths,'.ai-org/artifacts/'+taskId].some(base=>base==='.'||ref.path===base||ref.path.startsWith(base+'/')))throw Error('Evidence is outside task read authority');
    const file=path.join(root,ref.path),resolved=await fs.realpath(file);if(!resolved.startsWith(root+path.sep)||resolved!==file)throw Error('Evidence must be a literal file within the task workspace');
    const entry=await fs.lstat(file);if(!entry.isFile())throw Error('Evidence must be a regular file');
    const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let bytes;
    try{const before=await handle.stat(),opened=await fs.lstat(file);if(!before.isFile()||before.size>10*1024*1024||before.dev!==entry.dev||before.ino!==entry.ino||before.dev!==opened.dev||before.ino!==opened.ino||await fs.realpath(file)!==file)throw Error('Evidence must be a bounded unchanged regular file');const buffer=Buffer.alloc(before.size+1);let offset=0;while(offset<buffer.length){const result=await handle.read(buffer,offset,buffer.length-offset,offset);if(!result.bytesRead)break;offset+=result.bytesRead;}bytes=buffer.subarray(0,offset);const after=await handle.stat(),current=await fs.lstat(file);if(offset!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||before.dev!==current.dev||before.ino!==current.ino||await fs.realpath(file)!==file)throw Error('Evidence changed while reading');}finally{await handle.close();}
    if(createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw Error('Evidence digest differs from actual bytes');
    if(ref.kind==='screenshot'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Screenshot evidence must contain actual PNG bytes');
    seen.add(ref.path);return ref.kind==='screenshot';
  }
  for(const requirement of report.requirements){
    if(!requirement||typeof requirement.criterion!=='string'||typeof requirement.observation!=='string'||!requirement.observation.trim()||!Array.isArray(requirement.evidence)||requirement.evidence.length>32)throw Error('Invalid requirement observation');
    if(!criteria.includes(requirement.criterion))issue('unapproved-criterion',requirement.criterion);
    if(covered.has(requirement.criterion))issue('duplicate-criterion',requirement.criterion);covered.add(requirement.criterion);
    if(requirement.status!=='pass')issue('requirement-not-passing',requirement.criterion);
    if(!requirement.evidence.length)issue('requirement-evidence-missing',requirement.criterion);
    for(const ref of requirement.evidence)try{await evidence(ref);}catch(error){issue('requirement-evidence-invalid',requirement.criterion);}
  }
  for(const criterion of criteria)if(!covered.has(criterion))issue('approved-criterion-uncovered',criterion);
  if(visual&&report.self_reviews.length<2)issue('repeated-visual-review-missing');
  let visualRounds=0;
  for(const review of report.self_reviews){
    if(!review||typeof review.id!=='string'||typeof review.observation!=='string'||!review.observation.trim()||!Array.isArray(review.evidence)||review.evidence.length>32)throw Error('Invalid self-review observation');
    if(review.candidate_revision!==head)issue('self-review-candidate-mismatch');
    let screenshot=false;for(const ref of review.evidence)try{screenshot=(await evidence(ref))||screenshot;}catch(error){issue('self-review-evidence-invalid');}
    if(visual&&!screenshot)issue('visual-review-screenshot-missing');else if(screenshot)visualRounds++;
  }
  if(new Set(report.self_reviews.map(review=>review.id)).size!==report.self_reviews.length)issue('duplicate-self-review');
  if(report.open_findings.length)issue('unresolved-findings');
  return {schema_version:'workkeel.completion-evidence-check/v1',task_id:taskId,candidate_revision:head,approved_criteria:criteria.length,covered_criteria:criteria.filter(criterion=>covered.has(criterion)).length,evidence_files:seen.size,visual_review_rounds:visualRounds,coverage_consistent:issues.length===0,issues,semantic_correctness:'requires-review',independent_acceptance:'not-evaluated',model_calls:0,mutation_status:'no-write'};
}
