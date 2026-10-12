import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {readTaskFile,readTaskContractInput} from './task-contract.mjs';
import {safeDirectory} from './workkeel-project.mjs';
import {documentId} from './workkeel-monitor-data.mjs';
import {observeFileRead} from './workkeel-read-metrics.mjs';

const states=new Set(['intake','spec','design','build','test','eval','independent_qa','release_gate','done','concluded','blocked','cancelled']);
const terminal=new Set(['done','concluded','cancelled']);
const texts=value=>Array.isArray(value)?value.filter(x=>typeof x==='string').slice(0,128):[];
const validDate=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const docRef=ref=>typeof ref==='string'&&/\.(md|txt)$/i.test(ref)&&!/(^|\/)(?:\.git|\.ssh|\.aws|\.env[^/]*|credentials?|secrets?|auth)(\/|\.|$)/i.test(ref);

export async function readWorkItemProject(root) {
  const {document:pin}=await readTaskContractInput(root,'temple.lock');
  if(pin.schema_version!=='temple.lock/v1'||typeof pin.template?.version!=='string')throw Error('Unsupported Work Item project');
  await safeDirectory(root,'.ai-org/work-items');
  return {name:path.basename(root),version:pin.template.version,record_mode:'work-items',review_separation:null,agents:null,
    observer:{read_only:true,model_calls:0,poll_interval_ms:2000,hidden_page:'paused',service:'foreground',network:'loopback-only'}};
}

// Dedicated bounded journal reader; never follows symlinks or reads raw host logs.
async function events(root) {
  const directory=await safeDirectory(root,'.ai-org/events'),name=path.join(directory,'events.jsonl');
  const file=await fs.open(name,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await file.stat(),limit=8*1024*1024;
    if(!before.isFile()||before.size>limit)throw Error('Work Item journal limit');
    const buffer=Buffer.alloc(Math.min(limit+1,before.size+1));let size=0;
    while(size<buffer.length){const {bytesRead}=await file.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead;}
    const after=await file.stat(),entry=await fs.lstat(name);
    if(size!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||entry.isSymbolicLink()||entry.ino!==before.ino||entry.dev!==before.dev||await fs.realpath(name)!==name)throw Error('Journal changed during read');
    observeFileRead(size);
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size)).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  }finally{await file.close();}
}

async function items(root) {
  const directory=await safeDirectory(root,'.ai-org/work-items'),entries=await fs.readdir(directory,{withFileTypes:true});
  const names=entries.filter(e=>/^WI-[A-Za-z0-9-]+\.json$/.test(e.name));
  if(names.length>1000)throw Error('Work Item inventory exceeds 1000');
  const result=[];
  for(let i=0;i<names.length;i+=8)result.push(...await Promise.all(names.slice(i,i+8).map(async entry=>{
    const id=entry.name.slice(0,-5);
    try{
      const {document:item}=await readTaskContractInput(root,'.ai-org/work-items/'+entry.name);
      if(item.schema_version!=='temple.work-item/v1'||item.id!==id||!states.has(item.state)||typeof item.title!=='string'||!validDate(item.created_at)||!validDate(item.updated_at)||(item.handoffs!=null&&(!Array.isArray(item.handoffs)||item.handoffs.some(h=>!h||typeof h!=='object')))||(item.gate_evidence!=null&&(typeof item.gate_evidence!=='object'||Array.isArray(item.gate_evidence))))throw Error('Invalid Work Item');
      return item;
    }catch{return {id,unavailable:true};}
  })));
  return result;
}
const documents=item=>[...new Set([...texts(item.evidence),...Object.values(item.gate_evidence??{}).flatMap(texts),...(item.handoffs??[]).map(h=>h.artifact)])].filter(docRef).map(ref=>({id:documentId(ref),path:ref,digest:null}));

export async function readWorkItemSnapshot(root) {
  const now=new Date(),project=await readWorkItemProject(root),all=await items(root);
  let history=[],journalError=false;try{history=await events(root);}catch{journalError=true;}
  const grouped=new Map();
  for(const e of history)if(e&&typeof e==='object'&&typeof e.work_item_id==='string'&&validDate(e.timestamp)){
    if(!grouped.has(e.work_item_id))grouped.set(e.work_item_id,[]);
    grouped.get(e.work_item_id).push(e);
  }
  const tasks=all.map(item=>{
    if(item.unavailable)return {id:item.id,title:item.id,task_state:'unknown',read_status:'unavailable',needs_attention:true};
    const timeline=(grouped.get(item.id)??[]).map(e=>({at:e.timestamp,action:e.event_type,state:states.has(e.to_state)?e.to_state:states.has(e.state)?e.state:null})).sort((a,b)=>a.at.localeCompare(b.at));
    // Events without a transition inherit the preceding recorded state, never today's state.
    let state='unknown';for(const e of timeline){if(e.state)state=e.state;else if(e.action==='work_item_created')state=e.state='intake';else e.state=state;}
    const unresolved=texts(item.unresolved),ended=terminal.has(item.state),handoff=item.handoffs?.at(-1);
    return {id:item.id,title:item.title.slice(0,180),goal:item.title,record_mode:'work-items',source_state:item.state,task_state:item.state,
      read_status:'available',created_at:item.created_at,updated_at:item.updated_at,
      scope:{include:texts(item.scope),exclude:[]},acceptance_criteria:texts(item.acceptance_criteria),
      needs_attention:!ended&&(item.state==='blocked'||unresolved.length>0||['test','eval','independent_qa','release_gate'].includes(item.state)&&item.claim?.status!=='active'),attention_reasons:[],unresolved,
      candidate_revision:item.developer_candidate_revision??null,delivery:handoff?{summary:'',revision:handoff.input_revision}:null,
      review:null,quality:{locally_accepted:null,evidence_current:null},observation:{status:'unobserved',value:null},
      evidence:[],documents:documents(item),skills:[],settings:null,runs:[],measurement_errors:[],timeline:timeline.slice(-200),
      timing:{adapter_work_ms:null},usage:{input_tokens:null,output_tokens:null},
      lifecycle:{elapsed_ms:Math.max(0,(ended?Date.parse(item.updated_at):now.getTime())-Date.parse(item.created_at)),ongoing:!ended,coverage:'partial-history',phases:{}},
      claim_active:item.claim?.status==='active',next_action:'Inspect the recorded Work Item stage and linked documents.'};
  });
  tasks.sort((a,b)=>Number(b.needs_attention)-Number(a.needs_attention)||String(b.updated_at??'').localeCompare(String(a.updated_at??'')));
  return {schema_version:'workkeel.monitor/v2',authority:'observation-only',mutation_status:'no-write',read_at:now.toISOString(),
    project,tasks,complete:!journalError&&tasks.every(x=>x.read_status==='available'),measurement_errors:journalError?['journal-unavailable']:[],inventory_reads:all.length,legacy_tasks_excluded:0};
}

export async function readWorkItemDocument(root,id) {
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid document identifier');
  const all=await items(root),doc=all.filter(x=>!x.unavailable).flatMap(documents).find(x=>x.id===id);
  if(!doc)throw Error('Document is not referenced by a Work Item');
  const file=await readTaskFile(root,doc.path);
  if(Buffer.byteLength(file.content)>256*1024)throw Error('Document exceeds 256 KiB');
  return {...doc,content:file.content,digest:file.digest,read_at:new Date().toISOString(),read_only:true};
}
