import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const sha=b=>createHash('sha256').update(b).digest('hex');
const digest=/^[a-f0-9]{64}$/;
const relative=p=>typeof p==='string'&&p.length<1000&&!path.isAbsolute(p)&&!p.includes('\\')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..')&&!p.startsWith('.git/');
const within=(file,root)=>file===root||file.startsWith(root+'/');
const stable=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function regular(root,ref){
 if(!relative(ref))throw Error('Unsafe retention path');
 let current=root;
 for(const [i,part] of ref.split('/').entries()) {current=path.join(current,part);const stat=await fs.lstat(current);
  if(stat.isSymbolicLink()||(i===ref.split('/').length-1?!stat.isFile():!stat.isDirectory()))throw Error('Retention path is not regular');}
 if(await fs.realpath(current)!==current)throw Error('Retention path changed');
 return {file:current,stat:await fs.lstat(current)};
}
async function hashFile(root,ref){
 const {file,stat}=await regular(root,ref),handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW),hash=createHash('sha256');
 try {const opened=await handle.stat();if(!stable(stat,opened))throw Error('Retention file changed');
  const buffer=Buffer.alloc(1024*1024);let bytes=0;
  for(;;){const r=await handle.read(buffer,0,buffer.length,null);if(!r.bytesRead)break;hash.update(buffer.subarray(0,r.bytesRead));bytes+=r.bytesRead;}
  if(bytes!==stat.size||!stable(stat,await handle.stat())||!stable(stat,(await regular(root,ref)).stat))throw Error('Retention file changed');
  return {path:ref,bytes,sha256:hash.digest('hex')};
 }finally{await handle.close();}
}
async function json(root,ref){const {file,stat}=await regular(root,ref);if(stat.size>1024*1024)throw Error('Retention metadata too large');return JSON.parse(await fs.readFile(file,'utf8'));}
function validatePolicy(p){
 if(p.schema_version!=='workkeel.media-policy/v1'||!Array.isArray(p.roots)||!p.roots.length||p.roots.length>32||p.roots.some(v=>!relative(v))||!Array.isArray(p.protected)||!p.protected.length||p.protected.length>1000||p.protected.some(v=>!relative(v))||!Array.isArray(p.retire)||p.retire.length>100000||new Set(p.retire).size!==p.retire.length||p.retire.some(v=>!relative(v)||!p.roots.some(root=>within(v,root))))throw Error('Invalid explicit media inventory');
 if(!Number.isSafeInteger(p.max_retained_bytes)||p.max_retained_bytes<0||!p.replacement||!relative(p.replacement.path)||!digest.test(p.replacement.sha256)||!relative(p.replacement.validation_ref)||typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>2000)throw Error('Invalid media retention policy');
 if(p.retire.some(v=>p.protected.some(root=>within(v,root))||v===p.replacement.path||v===p.replacement.validation_ref||!/\.(jpe?g|png|wav|pcm|mp4|mov)$/i.test(v)))throw Error('Protected or non-media file cannot be retired');
}
/** Explicit file inventory only: never recursively guess which evidence is old. */
export async function planRetention(root,policy){
 root=await fs.realpath(root);validatePolicy(policy);
 const replacement=await hashFile(root,policy.replacement.path);if(replacement.sha256!==policy.replacement.sha256)throw Error('Replacement digest mismatch');
 const validation=await json(root,policy.replacement.validation_ref);
 if(validation.schema_version!=='workkeel.media-validation/v1'||validation.status!=='pass'||validation.check!=='full-decode'||validation.replacement_sha256!==replacement.sha256||typeof validation.command!=='string'||!validation.command.trim())throw Error('Replacement requires retained full-decode evidence');
 const validation_pin=await hashFile(root,policy.replacement.validation_ref),files=[];
 for(const ref of policy.retire)files.push(await hashFile(root,ref));
 let protected_bytes=0;const protected_files=[];
 for(const ref of policy.protected){const entry=await hashFile(root,ref);protected_bytes+=entry.bytes;protected_files.push(entry);}
 const retained_bytes=protected_bytes+(policy.protected.includes(replacement.path)?0:replacement.bytes);
 const body={schema_version:'workkeel.media-plan/v1',root,policy,files,replacement,validation_pin,protected_files,retire_bytes:files.reduce((n,f)=>n+f.bytes,0),retained_bytes,budget_exceeded:retained_bytes>policy.max_retained_bytes,coverage:'explicit-inventory-only',media_deleted:false};
 return {...body,plan_sha256:sha(JSON.stringify(body))};
}
/** Destructive use is explicit and bound to the exact preview digest.
 * A receipt is opened exclusively; interrupted receipts stay incomplete. */
export async function retireMedia(root,plan,{confirm_sha256,journal_ref}={}){
 root=await fs.realpath(root);
 const {plan_sha256,...body}=plan;if(!digest.test(plan_sha256)||confirm_sha256!==plan_sha256||sha(JSON.stringify(body))!==plan_sha256||plan.root!==root)throw Error('Exact retention plan confirmation required');
 if(!relative(journal_ref)||!journal_ref.endsWith('.jsonl')||!journal_ref.startsWith('Evidence/'))throw Error('Receipt must be a new Evidence JSONL file');
 const refreshed=await planRetention(root,plan.policy);if(refreshed.plan_sha256!==plan_sha256)throw Error('Retention inventory changed; preview again');
 if(refreshed.budget_exceeded)throw Error('Protected retained inventory exceeds budget; revise the plan without deleting required evidence');
 const parent=path.dirname(journal_ref),parentPath=path.join(root,parent);if(await fs.realpath(parentPath)!==parentPath)throw Error('Unsafe receipt directory');
 // Check every receipt parent, not just its final realpath.
 let dir=root;for(const part of parent.split('/')){dir=path.join(dir,part);const st=await fs.lstat(dir);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Unsafe receipt parent');}
 const handle=await fs.open(path.join(root,journal_ref),'wx',0o600);let count=0,bytes=0;
 const append=async record=>{await handle.write(JSON.stringify(record)+'\n');await handle.sync();};
 try {
  await append({kind:'authorization',schema_version:'workkeel.media-retirement/v1',at:new Date().toISOString(),plan_sha256,plannedFiles:plan.files.length,plannedBytes:plan.retire_bytes,reason:plan.policy.reason,replacement:plan.replacement,validation:plan.validation_pin});
  for(const file of plan.files){
   const fresh=await hashFile(root,file.path);if(fresh.sha256!==file.sha256||fresh.bytes!==file.bytes)throw Error('Media changed before retirement');
   await append({kind:'intent',...file});
   await fs.unlink((await regular(root,file.path)).file);
   await append({kind:'retire',...file});count++;bytes+=file.bytes;
  }
  await append({kind:'complete',at:new Date().toISOString(),files:count,bytes});
 }finally{await handle.close();}
 return {schema_version:'workkeel.media-retirement-result/v1',files:count,bytes,journal_ref,plan_sha256,original_replay_available:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [mode,root,file,confirm,journal]=process.argv.slice(2);if(!['plan','retire'].includes(mode)||!root||!file)throw Error('Usage: workkeel-media-retention.mjs plan PROJECT POLICY | retire PROJECT PLAN DIGEST JOURNAL');
 const data=JSON.parse(await fs.readFile(file,'utf8'));console.log(JSON.stringify(mode==='plan'?await planRetention(root,data):await retireMedia(root,data,{confirm_sha256:confirm,journal_ref:journal}),null,2));
 }catch(error){console.error(JSON.stringify({message:error.message}));process.exitCode=1;}
}
