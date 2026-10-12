import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {safeDirectory} from '../src/workkeel-project.mjs';

const fail=message=>{throw new Error('Evidence availability: '+message);};
const digest=b=>createHash('sha256').update(b).digest('hex');
function keys(v,allowed){
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('invalid fields');
}
function ref(v){
  if(typeof v!=='string'||v.length>1024||!v||v!==v.trim()||/[\\\x00-\x1f\x7f:]/.test(v)||path.posix.isAbsolute(v)||v.split('/').some(p=>!p||p==='.'||p==='..'))fail('invalid repository path');
  return v;
}
function metadata(v){
  if(v.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(v.sha256))fail('invalid digest');
  if(v.bytes!==undefined&&(!Number.isSafeInteger(v.bytes)||v.bytes<0))fail('invalid size');
}
async function location(root,p){return path.join(await safeDirectory(root,path.posix.dirname(ref(p))),path.posix.basename(p));}
async function read(root,p,max){
  const h=await fs.open(await location(root,p),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=await h.stat();if(!s.isFile()||s.size>max)fail('file bound');
    const b=Buffer.alloc(s.size+1),r=await h.read(b,0,b.length,0),after=await h.stat();
    if(r.bytesRead!==s.size||after.size!==s.size||after.mtimeMs!==s.mtimeMs)fail('file changed');
    return b.subarray(0,r.bytesRead);
  }finally{await h.close();}
}
async function presence(root,p){
  try{
    const s=await fs.lstat(await location(root,p));
    return s.isFile()&&!s.isSymbolicLink()?{state:'present',bytes:s.size}:{state:'unsafe'};
  }catch(e){return {state:e.code==='ENOENT'?'missing':'unavailable'};}
}

// Opt-in adapter for Slime's existing append-only cleanup receipts. A receipt
// describes an earlier action; it never grants permission to delete anything.
async function retirement(root,p,format){
  const bytes=await read(root,p,32*1024*1024),rows=bytes.toString('utf8').trimEnd().split('\n');
  if(rows.length<2||rows.length>(format==='workkeel-retirement-jsonl/v1'?200002:100002)||rows.some(r=>Buffer.byteLength(r)>64*1024))fail('retirement bound');
  const data=rows.map(r=>JSON.parse(r)),first=data[0],last=data.at(-1),entries=new Map();let total=0;
  if(first.kind!=='authorization'||last.kind!=='complete')fail('retirement incomplete');
  let intent=null;
  for(const r of data.slice(1,-1)){
    if(format==='workkeel-retirement-jsonl/v1'&&r.kind==='intent'){
      if(intent)fail('duplicate intent');ref(r.path);metadata(r);intent=r;continue;
    }
    if(r.kind!=='retire')fail('retirement row');
    if(format==='workkeel-retirement-jsonl/v1'){
      if(!intent||intent.path!==r.path||intent.sha256!==r.sha256||intent.bytes!==r.bytes)fail('unmatched intent');intent=null;
    }
    ref(r.path);metadata(r);
    if(r.bytes===undefined||r.sha256===undefined||entries.has(r.path))fail('retirement identity');
    entries.set(r.path,r);total+=r.bytes;if(!Number.isSafeInteger(total))fail('retirement overflow');
  }
  if(intent||last.files!==entries.size||last.bytes!==total||first.plannedFiles!==entries.size||first.plannedBytes!==total)fail('retirement totals');
  return {entries,summary:{path:p,sha256:digest(bytes),files:entries.size,bytes:total,status:'complete-record'}};
}

/** Read-only stat inventory. Does not read media bodies, replay tests or accept tasks. */
export async function inspectEvidenceAvailability(rootInput,request){
  keys(request,['files','retirement_journals']);
  if(!Array.isArray(request.files)||request.files.length>10000||!Array.isArray(request.retirement_journals??[])||(request.retirement_journals??[]).length>16)fail('inventory bound');
  const root=await fs.realpath(rootInput),seen=new Set();
  for(const f of request.files){
    keys(f,['path','bytes','sha256','archive_path']);ref(f.path);metadata(f);if(f.archive_path!==undefined)ref(f.archive_path);
    if(seen.has(f.path))fail('duplicate file');seen.add(f.path);
  }
  const retired=new Map(),journals=[],warnings=[];
  for(const source of request.retirement_journals??[]){
    keys(source,['path','format']);ref(source.path);
    if(!['slime-retirement-jsonl/v1','workkeel-retirement-jsonl/v1'].includes(source.format))fail('unsupported retirement format');
    try{
      const out=await retirement(root,source.path,source.format);journals.push(out.summary);
      for(const [p,r] of out.entries)if(seen.has(p)){
        const old=retired.get(p);
        if(old&&(old.conflict||old.bytes!==r.bytes||old.sha256!==r.sha256))retired.set(p,{conflict:true});
        else retired.set(p,{...r,journal:source.path});
      }
    }catch{warnings.push({path:source.path,code:'retirement-unavailable-or-incomplete'});}
  }
  const files=[];
  for(const f of request.files){
    const local=await presence(root,f.path),r=retired.get(f.path),archive=f.archive_path?await presence(root,f.archive_path):null;
    const matches=r&&!r.conflict&&(f.bytes===undefined||f.bytes===r.bytes)&&(f.sha256===undefined||f.sha256===r.sha256);
    const state=local.state==='present'?(f.bytes!==undefined&&f.bytes!==local.bytes?'size-mismatch':'present'):
      local.state!=='missing'?local.state:matches?'retired-recorded':archive?.state==='present'?'archive-present-unverified':'missing-unexplained';
    files.push({path:f.path,state,declared_bytes:f.bytes??null,declared_sha256:f.sha256??null,
      observed_bytes:local.bytes??null,content_integrity:'not-checked',replay_verification:'not-performed',
      retirement_ref:matches?r.journal:null,retirement_conflict:Boolean(r&&!matches),
      archive:f.archive_path?{path:f.archive_path,...archive,content_integrity:'not-checked'}:null});
  }
  return {schema_version:'workkeel.evidence-availability/v1',read_at:new Date().toISOString(),
    authority:'observation-only',mutation_status:'no-write',media_bytes_read:0,
    counts:files.reduce((out,f)=>(out[f.state]=(out[f.state]??0)+1,out),{}),files,journals,warnings,
    limitations:['File presence and size are not content integrity or visual acceptance.',
      'Retirement receipts describe recorded cleanup; missing files without a matching receipt have an unknown cause.',
      'An archive path is a retrieval lead only; its contents have not been inspected.',
      'Existing test outcomes and task acceptance are not changed. No AI time or tokens are inferred from media.']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)try{
  const [root,input,...extra]=process.argv.slice(2);if(!root||!input||extra.length)fail('usage: project request.json');
  const request=JSON.parse(await read(path.dirname(path.resolve(input)),path.basename(input),4*1024*1024));
  process.stdout.write(JSON.stringify(await inspectEvidenceAvailability(root,request),null,2)+'\n');
}catch{process.stderr.write('Evidence availability request failed; check explicit paths, metadata and bounds.\n');process.exitCode=1;}
