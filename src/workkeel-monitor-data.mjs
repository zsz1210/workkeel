import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readTaskFile, readTaskContractInput} from './task-contract.mjs';
import {readNativeTask, listTaskItems} from './workkeel-tasks.mjs';
import {safeDirectory, existsEntry, readTaskProject} from './workkeel-project.mjs';
import {validateLearningIndex, validateSkillProposal} from './learning.mjs';
import {validateExecutionPolicy} from './workkeel-execution-policy.mjs';
import {listNativeLearning} from './workkeel-learning.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_ENTRIES = 256, MAX_TEXT = 256 * 1024;
const text = (value, limit=2000) => typeof value === 'string' ? value.slice(0,limit) : null;
const docPath = ref => typeof ref === 'string' && /\.(md|txt)$/i.test(ref) &&
  !/(^|\/)(?:\.git|\.ssh|\.aws|\.env[^/]*|credentials?|secrets?|auth)(\/|\.|$)/i.test(ref);
export const documentId = ref => hash('document:' + ref);

/** Cache only derived search entries. Every lookup still revalidates paths and bytes.
 * No file-stat shortcut is used to certify task authority or evidence. */
export function createLibraryCache() { return {entries:new Map(), hits:0, misses:0, reads:0, bytes:0}; }
async function readSource(root,ref,cache) {
  const file=await readTaskFile(root,ref);cache.reads++;cache.bytes+=Buffer.byteLength(file.content);
  if(Buffer.byteLength(file.content)>MAX_TEXT)throw Error('Observer document exceeds 256 KiB');
  return file;
}
function indexed(cache,ref,file,build) {
  const key=ref+':'+file.digest;
  if(cache.entries.has(key)){cache.hits++;return cache.entries.get(key);}
  cache.misses++;
  const value=build();cache.entries.set(key,value);
  while(cache.entries.size>MAX_ENTRIES)cache.entries.delete(cache.entries.keys().next().value);
  return value;
}
function frontmatter(content,key) {
  const head=content.replace(/^\uFEFF/,'').replaceAll('\r\n','\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  if(!head)return null;
  const lines=head.split('\n'),index=lines.findIndex(line=>line.startsWith(key+':'));
  if(index<0)return null;
  let value=lines[index].slice(key.length+1).trim();
  // Display only scalar metadata. Fold indented block text into a bounded summary;
  // never evaluate YAML tags, aliases or executable content.
  if(/^[>|][+-]?(?:\s+#.*)?$/.test(value)){
    const body=[];
    for(const line of lines.slice(index+1)){if(line&&!/^\s/.test(line))break;body.push(line.trim());}
    value=body.join(' ').replace(/\s+/g,' ').trim();
  }
  return value.replace(/^["']|["']$/g,'').slice(0,500)||null;
}
async function skillPaths(root,refs=[]) {
  const found=new Set(refs.filter(ref=>typeof ref==='string'&&ref.endsWith('/SKILL.md')));
  const base='.agents/skills';
  if(await existsEntry(root,base)) {
    const dir=await safeDirectory(root,base),names=await fs.readdir(dir,{withFileTypes:true});
    if(names.length>MAX_ENTRIES)throw Error('Skill inventory limit exceeded');
    for(const entry of names)if(entry.isDirectory()&&!entry.isSymbolicLink()&&/^[A-Za-z0-9._-]+$/.test(entry.name)) {
      const ref=`${base}/${entry.name}/SKILL.md`;
      if(await existsEntry(root,ref))found.add(ref);
    }
  }
  if(found.size>MAX_ENTRIES)throw Error('Skill inventory limit exceeded');
  return [...found].sort();
}
async function builtinDigest(ref) {
  if(!/^\.agents\/skills\/[a-z0-9-]+\/SKILL\.md$/.test(ref))return null;
  try{return (await readTaskFile(new URL('../project-overlay/',import.meta.url).pathname,ref)).digest;}catch{
    try{return (await readTaskFile(new URL('../project-overlay/workkeel-skills/',import.meta.url).pathname,ref.replace('.agents/skills/',''))).digest;}catch{return null;}
  }
}
async function catalogueSources(root,skillRefs,catalogRoots,errors=[]) {
  if(!Array.isArray(catalogRoots)||catalogRoots.length>64)throw Error('Skill source limit');
  const result=(await skillPaths(root,skillRefs)).map(ref=>({root,ref,source:'project',id:documentId(ref)}));
  const bundled=fileURLToPath(new URL('../project-overlay/',import.meta.url));
  for(const ref of await skillPaths(bundled))result.push({root:bundled,ref,source:'workkeel',id:documentId('bundled:'+ref)});
  const native=path.join(bundled,'workkeel-skills');
  for(const name of ['workkeel-init','workkeel-work'])result.push({root:native,ref:name+'/SKILL.md',project_ref:'.agents/skills/'+name+'/SKILL.md',source:'workkeel',id:documentId('native:'+name)});
  for(const [index,source] of catalogRoots.entries()){
    if(!source||!path.isAbsolute(source.path)||!['user','third-party'].includes(source.origin))throw Error('Invalid Skill source');
    // Launch-selected Skill directories only; never discover account/config files.
    try{
    const stat=await fs.lstat(source.path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Skill source must be a directory');
    const dir=await fs.realpath(source.path),entries=await fs.readdir(dir,{withFileTypes:true});
    if(entries.length>MAX_ENTRIES)throw Error('Skill source directory limit');
    for(const entry of entries)if(entry.isDirectory()&&!entry.isSymbolicLink()&&/^[A-Za-z0-9_-]+$/.test(entry.name)){
      const ref=entry.name+'/SKILL.md';
      if(await existsEntry(dir,ref))result.push({root:dir,ref,source:source.origin,label:source.label??source.origin,id:documentId('catalogue:'+index+':'+dir+':'+ref)});
    }
    }catch{errors.push({path:source.path,code:'skill-source-unavailable'});}
  }
  if(result.length>MAX_ENTRIES)throw Error('Combined Skill catalogue limit');
  return result;
}
export async function readMonitorLibrary(root,{cache=createLibraryCache(),query='',skillRefs=[],catalogRoots=[]}={}) {
  const skills=[],learning=[],errors=[];
  const projectDigests=new Map();
  for(const source of await catalogueSources(root,skillRefs,catalogRoots,errors)) {
    const {ref}=source;
    try{
      const file=await readSource(source.root,ref,cache);
      if(source.source==='project')projectDigests.set(ref,file.digest);
      if(source.source==='workkeel'&&projectDigests.get(source.project_ref??ref)===file.digest)continue;
      const entry=indexed(cache,source.id,file,()=>({id:source.id,path:source.source==='project'?ref:path.join(source.root,ref),name:frontmatter(file.content,'name')??ref.split('/').at(-2),
        description:frontmatter(file.content,'description')??'',search:file.content.toLocaleLowerCase(),digest:file.digest}));
      const builtIn=source.source==='project'?await builtinDigest(ref):null;
      const origin=builtIn===file.digest?'workkeel':frontmatter(file.content,'origin')==='third-party'?'third-party':source.source;
      if(!query||entry.search.includes(query.toLocaleLowerCase())){const {search,...publicEntry}=entry;skills.push({...publicEntry,origin,
        compatibility:!entry.name.startsWith('workkeel-')&&origin==='workkeel'&&/TEMPLE\.md|templew\.mjs|\btemple (?:work-item|init|status|doctor)/.test(file.content)?'legacy':'current',
        source_label:source.label??source.source,availability:source.source==='project'?'project':source.source==='workkeel'&&projectDigests.has(source.project_ref??ref)?'different-version':'not-added',
        origin_basis:origin==='workkeel'?'matches-bundled-source':origin==='third-party'?'declared-or-configured-source':'source-location-author-unrecorded'});}
    }catch{errors.push({path:ref,code:'skill-unavailable'});}
  }
  const indexRef='.ai-org/learning/index.json';
  if(await existsEntry(root,indexRef))try{
    const file=await readSource(root,indexRef,cache),index=indexed(cache,indexRef,file,()=>JSON.parse(file.content));
    if(!validateLearningIndex(index).valid||index.entries.length>MAX_ENTRIES)throw Error('Invalid learning index');
    for(const entry of index.entries) {
      try{
        const file=await readSource(root,entry.path,cache);
        const search=indexed(cache,entry.path,file,()=>file.content.toLocaleLowerCase());
        if(query&&!`${entry.title} ${entry.summary} ${search}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))continue;
        let completed=entry.kind==='practice'&&entry.status==='active'?3:entry.status==='validated'?2:1;
        let proposal=null;
        if(entry.promotion?.proposal_id) {
          const ref=`.ai-org/learning/proposals/${entry.promotion.proposal_id}.json`;
          try{
            const p=(await readTaskContractInput(root,ref)).document;
            if(!validateSkillProposal(p).valid||p.source_learning_id!==entry.id)throw Error('Invalid proposal');
            proposal={id:p.id,status:p.status,authoring_work_item_id:p.authoring_work_item_id,skill_path:p.skill_path};
            if(completed===3&&p.status==='approved')completed=4;
            // Existing proposal records do not certify authoring, validation or activation.
          }catch{errors.push({path:ref,code:'proposal-unavailable'});}
        }
        learning.push({id:entry.id,document_id:documentId(entry.path),path:entry.path,title:entry.title,summary:entry.summary,
          kind:entry.kind,status:entry.status,confidence:entry.confidence,tags:entry.tags,updated_at:entry.updated_at,
          sources:entry.source_work_items,completed_milestones:completed,total_milestones:7,
          stopped:entry.status==='deprecated',promotion_target:entry.promotion.target,proposal,digest:file.digest});
      }catch{errors.push({path:entry.path,code:'learning-unavailable'});}
    }
  }catch{errors.push({path:indexRef,code:'learning-index-unavailable'});}
  let nativeTotal=0;
  try {
    const native=await listNativeLearning(root);
    const matches=native.items.filter(entry=>!query||[entry.id,entry.title,entry.summary,entry.applicability,...entry.aliases].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    nativeTotal=matches.length;
    for(const entry of matches.slice(0,MAX_ENTRIES)) {
      const uses=native.uses.filter(use=>use.learning_id===entry.id),path='native-learning:'+entry.id;
      const content=nativeLearningText(entry,uses),completed=entry.eligible?(entry.kind==='practice'?3:2):1;
      learning.push({...entry,id:entry.id,document_id:documentId(path),path,title:entry.title,summary:entry.summary,
        native:true,confidence:null,tags:entry.aliases,updated_at:entry.review?.at??null,sources:[entry.source_task],
        status:entry.effective_state==='adopted'?'active':entry.effective_state,
        completed_milestones:completed,total_milestones:7,stopped:entry.effective_state==='contradicted',
        promotion_target:'skill',proposal:null,uses:uses.slice(-100),use_count:uses.length,digest:hash(content)});
    }
  }catch{errors.push({path:'.ai-org/learning/native',code:'native-learning-unavailable'});}
  return {skills,learning,errors,native_total:nativeTotal,native_limit:MAX_ENTRIES,scope:'project-and-configured-skills',promotion_automation:false};
}

function nativeLearningText(entry,uses){
  return ['# '+entry.title,entry.summary,'## Applicability',entry.applicability,'## Exclusions',entry.exclusions,
    '## Validation',entry.effective_state,entry.review?.decision??'Not reviewed',
    '## Sources',...entry.pins.map(pin=>pin.path+' · '+pin.sha256),
    '## Recorded use',...uses.slice(-100).map(use=>`${use.task_id} · ${use.stage} · ${use.outcome??''}\n${use.decision}`)].join('\n\n');
}

export async function readCatalogueDocument(root,id,{cache=createLibraryCache(),skillRefs=[],catalogRoots=[]}={}) {
  const source=(await catalogueSources(root,skillRefs,catalogRoots)).find(x=>x.id===id);
  if(!source)return null;
  const file=await readSource(source.root,source.ref,cache);
  return {id,path:source.source==='project'?source.ref:path.join(source.root,source.ref),content:file.content,digest:file.digest,read_at:new Date().toISOString(),read_only:true};
}

export async function readLearningDocument(root,id,{cache=createLibraryCache()}={}) {
  // A searched record may sit beyond the bounded first page. Resolve its opaque
  // ID against the validated inventory, never against that display slice.
  try {
    const native=await listNativeLearning(root),entry=native.items.find(x=>documentId('native-learning:'+x.id)===id);
    if(entry){const content=nativeLearningText(entry,native.uses.filter(use=>use.learning_id===entry.id));return {id,path:'native-learning:'+entry.id,content,digest:hash(content),read_at:new Date().toISOString(),read_only:true};}
  }catch{/* An invalid native store cannot authorize a document. */}
  const library=await readMonitorLibrary(root,{cache}),entry=library.learning.find(x=>x.document_id===id);
  if(entry?.native)return null;
  if(!entry)return null;
  const file=await readSource(root,entry.path,cache);
  return {id,path:entry.path,content:file.content,digest:file.digest,read_at:new Date().toISOString(),read_only:true};
}

/** The observer never exposes connection URLs, credential variable names or raw policies. */
export function connectionView(connection) {
  if(!connection)return null;
  return {kind:text(connection.kind,80),provider:text(connection.provider,120),model:text(connection.model,200),
    requested_reasoning:connection.effort?{name:'effort',value:text(connection.effort,80)}:null};
}
export async function taskResourceView(root,id) {
  const task=await readNativeTask(root,id),c=task.contract;
  let executionPolicy=null;
  if(c.execution.model_connection.kind==='policy')try{
    const ref=c.execution.model_connection.policy_ref,{document:p,digest}=await readTaskContractInput(root,ref);
    validateExecutionPolicy(p);
    executionPolicy={source:ref,source_status:task.authority_pins.some(pin=>pin.path===ref&&pin.sha256===digest)?'pinned':'changed',
      default_model:text(p.default_model,120),models:Array.isArray(p.models)?p.models.slice(0,32).map(m=>({id:text(m.id,120),connection:connectionView(m.connection)})):[],
      headroom:text(p.headroom?.mode,40),limits:Object.fromEntries(['steps','attempts_per_node','parallelism','timeout_ms'].map(k=>[k,Number.isSafeInteger(p.limits?.[k])?p.limits[k]:null])),
      rules:Array.isArray(p.rules)?p.rules.slice(0,64).map(r=>({id:text(r.id,120),nodes:Array.isArray(r.nodes)?r.nodes.slice(0,100).map(n=>text(n,120)):[],model:text(r.model,120)})):[]};
  }catch{executionPolicy={status:'unavailable'};}
  const refs=[...task.authority_pins??[],...task.delivery?.evidence??[],...task.review?.evidence??[],...task.closeout?.evidence??[]];
  const documents=[...new Map(refs.filter(p=>docPath(p.path)).map(p=>[p.path,{id:documentId(p.path),path:p.path,task_id:id,pinned_digest:p.sha256}])).values()];
  return {documents,skills:c.skills.map(ref=>({path:ref,document_id:documentId(ref),selection:'task-contract',read_complete:null,applied:null,verified:null})),
    settings:{runtime:{kind:c.execution.runtime.kind,adapter_id:c.execution.runtime.adapter_id??null},connection:connectionView(c.execution.model_connection),
      network_mode:c.environment.network.mode,tools:c.environment.tools,read_paths:c.environment.read_paths,write_paths:c.environment.write_paths,
      data_classification:c.environment.data.classification,model_access:c.environment.data.model_access,
      operations:c.authorization.operations,expires_at:c.authorization.expires_at,separation:c.verification.separation,execution_policy:executionPolicy}};
}

/** Rebuild the allowlist for each body request. No caller-supplied filesystem path. */
export async function readMonitorDocument(root,id,{cache=createLibraryCache()}={}) {
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid document identifier');
  await readTaskProject(root);
  const refs=new Set(),selected=[];
  const items=await listTaskItems(root,{isolateErrors:true});
  if(items.filter(item=>item.mode!=='legacy-read-only').length>2000)throw Error('Task inventory limit');
  for(const item of items.filter(i=>!['legacy-read-only','unavailable'].includes(i.mode)))try{
    const resources=await taskResourceView(root,item.id);
    for(const doc of resources.documents)refs.add(doc.path);
    for(const skill of resources.skills){refs.add(skill.path);selected.push(skill.path);}
  }catch{ /* Unreadable tasks grant no document access. */ }
  const library=await readMonitorLibrary(root,{cache,skillRefs:selected});
  for(const entry of [...library.skills,...library.learning])refs.add(entry.path);
  const ref=[...refs].find(ref=>docPath(ref)&&documentId(ref)===id);
  if(!ref)throw Error('Document is not in the current inventory');
  const file=await readSource(root,ref,cache);
  return {id,path:ref,content:file.content,digest:file.digest,read_at:new Date().toISOString(),read_only:true};
}

export async function monitorProjectView(root) {
  const project=await readTaskProject(root);
  return {name:path.basename(root),version:project.cli.version,record_mode:'native',review_separation:project.policy.review_separation,
    agents:project.policy.agents.map(a=>a.agent_id),observer:{read_only:true,model_calls:0,poll_interval_ms:2000,hidden_page:'paused',service:'foreground',network:'loopback-only'}};
}
