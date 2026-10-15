import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {executionDigest,exactKeys,validateExecutionPolicy} from './workkeel-execution-policy.mjs';
import {createTrustedGoalAdapter} from './workkeel-goals.mjs';
import {createLocalCodexSubscriptionHost} from './workkeel-codex-host.mjs';
import {createCodexRuntime,codexPermissionsForContract} from './workkeel-codex-runtime.mjs';
import {createTrustedRoleHost} from './workkeel-role-preflight.mjs';
import {readApprovedModelPolicy} from './workkeel-model-routing.mjs';
import {resolveModelPolicy} from './workkeel-model-policy.mjs';
import {readTaskProject,assertActor,safeDirectory,readNativeGit} from './workkeel-project.mjs';
import {readNativeTask,mutateNativeTask,assertTaskExecutionContext} from './workkeel-tasks.mjs';
import {readTaskFile} from './task-contract.mjs';
import {durableAtomicCreate,durableAtomicWrite,formatJson} from './files.mjs';
import {assertScreenshotPNG,withOwnedBrowser} from './workkeel-browser-check.mjs';

const within=(p,root)=>root==='.'||p===root||p.startsWith(root+'/');
const fail=m=>{throw Error('Codex goal host: '+m);};
const noCost={input_tokens:0,output_tokens:0,cost_usd:0};
let systemGit;
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const gitConfig=['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','credential.helper=','-c','protocol.allow=never','-c','gc.auto=0','-c','maintenance.auto=false'];
const environment=()=>({PATH:path.dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',OPENSSL_CONF:'/dev/null',LC_ALL:'C'});
function duration(ctx){return ctx.manifest.limits.operation_timeout_ms??Math.max(1,Math.floor(ctx.manifest.limits.timeout_ms/ctx.manifest.limits.max_operations));}
function slotRef(ctx){return '.ai-org/goals/'+ctx.goal+'/runtime/'+ctx.operation_id+'/slot.json';}
async function readSlot(ctx){const file=await readTaskFile(ctx.target,slotRef(ctx)),envelope=JSON.parse(file.content);exactKeys(envelope,['value','sha256']);if(executionDigest(envelope.value)!==envelope.sha256)fail('runtime slot integrity');return envelope.value;}
async function writeSlot(ctx,value){const dir=await safeDirectory(ctx.target,path.posix.dirname(slotRef(ctx)),{create:true});await durableAtomicWrite(path.join(dir,'slot.json'),formatJson({value,sha256:executionDigest(value)}));}
function reportRef(ctx,kind){return '.ai-org/artifacts/'+ctx.component.task_id+'/goal-'+kind+'-'+ctx.operation_id+'.json';}
async function report(ctx,kind,value){
  const ref=reportRef(ctx,kind),content=formatJson(value);if(Buffer.byteLength(content)>131072)fail('bounded report exceeded');
  const dir=await safeDirectory(ctx.component.root,path.posix.dirname(ref),{create:true});
  try{await durableAtomicCreate(path.join(dir,path.posix.basename(ref)),content);}catch(e){if(e.code!=='EEXIST'||(await readTaskFile(ctx.component.root,ref)).content!==content)throw e;}
  return {path:ref,sha256:(await readTaskFile(ctx.component.root,ref)).bytes_digest};
}
async function artifactRefs(ctx){
  const root='.ai-org/artifacts/'+ctx.component.task_id;let dir;try{dir=await safeDirectory(ctx.component.root,root);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const names=(await fs.readdir(dir)).filter(n=>/^goal-[A-Za-z0-9._-]+\.json$/.test(n)).sort();if(names.length>256)fail('artifact inventory exceeded');return names.map(name=>root+'/'+name);
}
async function visualEvidence(ctx){
  const pins=[];
  const refs=[...new Set([...(ctx.input.verification?.evidence??[]),...(ctx.task.delivery?.evidence??[]).map(pin=>pin.path)])];
  for(const ref of refs){
    if(!ref.endsWith('.json'))continue;
    let value;try{value=JSON.parse((await readTaskFile(ctx.component.root,ref)).content);}catch(error){if(error instanceof SyntaxError)continue;throw error;}
    if(value.schema_version!=='workkeel.goal-checks/v1'||value.candidate_revision!==ctx.input.candidate)continue;
    for(const log of value.logs??[])for(const pin of log.visual_evidence??[]){
      if(!pin.path.startsWith('.ai-org/artifacts/'+ctx.component.task_id+'/goal-browser-')||path.posix.dirname(pin.path)!=='.ai-org/artifacts/'+ctx.component.task_id)fail('visual evidence outside task artifacts');
      await safeDirectory(ctx.component.root,path.posix.dirname(pin.path));const file=path.join(ctx.component.root,pin.path),handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      try{const stat=await handle.stat();if(!stat.isFile()||stat.size>1048576)fail('visual evidence exceeds bound');const bytes=await handle.readFile();if(createHash('sha256').update(bytes).digest('hex')!==pin.sha256)fail('visual evidence changed after verification');}finally{await handle.close();}
      pins.push({...pin,absolute_path:file});
    }
  }
  if(pins.length>256)fail('visual evidence inventory exceeded');return pins;
}
function effective(ctx){
  const contract=structuredClone(ctx.task.contract),phase=ctx.input.phase,read=ctx.component.purpose==='discovery'||['planning','review','verification'].includes(phase);
  contract.actor=structuredClone(ctx.input.actor);if(read)contract.environment.write_paths=[];
  if(!contract.environment.tools.includes('codex'))fail('component did not approve Codex tools');
  // A task's allowed tools are a ceiling. Model turns use the smaller qualified
  // profile; coordinator checks do not acquire model-tool or network access.
  contract.environment.tools=['codex'];
  contract.environment.network={mode:'none',hosts:[]};
  contract.environment.resources=[];
  contract.environment.external_actions=[];
  contract.execution.runtime={kind:'adapter',adapter_id:'codex-app-server',required_features:['filesystem-sandbox','network-disabled','fixed-model','resume','cancel']};
  contract.execution.model_connection={kind:'codex-subscription',model:ctx.input.model.model,effort:ctx.input.model.reasoning};
  return {contract,access:read?'read':'write',selection:{connection:contract.execution.model_connection,runtime_selection:ctx.input.model},policy:{headroom:{mode:'off'},limits:{timeout_ms:duration(ctx),max_cost_usd:null}}};
}
async function processResult(command,args,{cwd,signal,timeout_ms,env=environment()}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(Error('Operation cancelled before process'));
    const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});let stdout='',stderr='',bytes=0,finished=false;
    const stop=()=>{if(finished)return;try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{}};
    const timer=setTimeout(stop,timeout_ms),abort=()=>stop();signal?.addEventListener('abort',abort,{once:true});
    const chunk=(which,data)=>{bytes+=data.length;if(bytes>1024*1024){stop();return;}if(which==='out')stdout+=data;else stderr+=data;};
    child.stdout.on('data',d=>chunk('out',d));child.stderr.on('data',d=>chunk('err',d));
    child.once('error',e=>{finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(e);});
    child.once('close',(code,term)=>{stop();finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve({exit_code:code,signal:term,stdout,stderr,output_complete:bytes<=1024*1024});});
  });
}
/** Stock local checks use the actual macOS sandbox, not a metadata promise.
 * Write access is limited to private scratch, or Git metadata for checkpointing. */
async function browserPrerequisites(ctx,args){
  const parent=await readNativeTask(ctx.target,ctx.controller.task_id);
  for(const task of [parent,ctx.task]){const env=task.contract.environment;
    if(!env.tools.includes('browser')||!env.tools.includes('node')||env.network.mode!=='allowlist'||!env.network.hosts.includes('127.0.0.1')||!task.contract.authorization.operations.includes('network'))fail('browser checks require explicit coordinator and component browser, node and loopback authority');
  }
  if(![1,2].includes(args.length)||!args[0].endsWith('.mjs'))fail('browser check requires an approved Node module and optional pinned preview configuration');
  const file=await readTaskFile(ctx.component.root,args[0]);
  if(!ctx.task.authority_pins.some(pin=>pin.path===args[0]&&pin.sha256===file.bytes_digest))fail('browser check script must be immutable component approval evidence');
  let origin=null;
  if(args.length===2){
    const config=await readTaskFile(ctx.component.root,args[1]);
    if(!ctx.task.authority_pins.some(pin=>pin.path===args[1]&&pin.sha256===config.bytes_digest))fail('preview configuration must be immutable component approval evidence');
    const value=JSON.parse(config.content);exactKeys(value,['origin']);const url=new URL(value.origin);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash||value.origin!==url.origin)fail('preview must be an exact loopback HTTP origin with an explicit port');
    origin=url.origin;
  }
  if(!(await fs.stat(chrome)).isFile())fail('installed Google Chrome is required for browser checks');
  return origin;
}
async function freePort(){const server=net.createServer();await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function stockCommand(ctx,{command,args,git_write=false,check_id='check'}){
  if(process.platform!=='darwin')fail('local command runner requires qualified macOS sandbox');
  const parent=await readNativeTask(ctx.target,ctx.controller.task_id);
  if(!parent.contract.environment.tools.includes(command))fail('coordinator tool was not approved');
  if(command==='git'&&!systemGit){const lookup=await processResult('/usr/bin/xcrun',['--find','git'],{cwd:ctx.component.root,signal:ctx.signal,timeout_ms:duration(ctx)});const selected=lookup.stdout.trim();if(lookup.exit_code!==0||!path.isAbsolute(selected)||!selected.endsWith('/git'))fail('qualified system Git unavailable');systemGit=await fs.realpath(selected);}
  const browser=command==='browser',previewOrigin=browser?await browserPrerequisites(ctx,args):null;
  const binary=command==='node'||browser?process.execPath:command==='git'?systemGit:null;
  if(!binary)fail('explicit command is unsupported by stock local runner');
  const scratch=browser?await fs.mkdtemp('/private/tmp/workkeel-browser-'):await safeDirectory(ctx.target,'.ai-org/goals/'+ctx.goal+'/scratch/'+ctx.operation_id+'/'+check_id,{create:true});
  try{
  const components=ctx.component.id===ctx.manifest.integration.component_id?ctx.manifest.components:[ctx.component],readRoots=['/System','/usr','/bin','/sbin','/Library/Apple',path.dirname(process.execPath),path.dirname(path.dirname(binary))],denied=[];
  if(command==='node'||browser)for(const ref of process.report?.getReport().sharedObjects??[])if(path.isAbsolute(ref)&&!ref.startsWith('/System/')&&!ref.startsWith('/usr/')){
    const resolved=await fs.realpath(ref);readRoots.push(path.dirname(resolved));
    // dyld checks the installed Homebrew opt alias before following the Cellar
    // symlink. Grant that exact verified library-directory alias as well.
    const match=/^(.*)\/Cellar\/([^/]+)\/[^/]+\/(.+)$/.exec(resolved);
    if(match){const aliasRoot=match[1]+'/opt/'+match[2],alias=aliasRoot+'/'+match[3];try{if(await fs.realpath(alias)===resolved)readRoots.push(aliasRoot);}catch(e){if(e.code!=='ENOENT')throw e;}}
  }
  for(const component of components){const task=component.id===ctx.component.id?ctx.task:await readNativeTask(component.root,component.task_id),profile=await codexPermissionsForContract(component.root,task.contract,{productAccess:'read'});for(const [ref,access]of Object.entries(profile.filesystem)){if(!path.isAbsolute(ref))continue;if(access==='read')readRoots.push(ref);else if(access==='deny')denied.push(ref);}if(command==='git')readRoots.push(path.join(component.root,'.git'));}
  if(browser)readRoots.push('/Applications/Google Chrome.app',scratch,'/Library/Preferences');
  const terms=readRoots.map(root=>'(subpath '+JSON.stringify(root)+')').join(' ');
  const ancestors=new Set();for(const root of [...readRoots,scratch])for(let parent=path.dirname(root);;parent=path.dirname(parent)){ancestors.add(parent);if(parent==='/')break;}
  const metadata=[...ancestors].map(root=>'(literal '+JSON.stringify(root)+')').join(' ');
  const writes=['(subpath '+JSON.stringify(scratch)+')','(literal "/dev/null")'];
  if(git_write){const git=path.join(ctx.component.root,'.git');if(!(await fs.lstat(git)).isDirectory())fail('stock checkpoints require a regular local .git directory');writes.push('(subpath '+JSON.stringify(git)+')');}
  const port=browser?(previewOrigin?Number(new URL(previewOrigin).port):await freePort()):null;let browserPort=browser?await freePort():null;while(browser&&browserPort===port)browserPort=await freePort();
  const profile='(version 1)'+(browser?'(allow default)(deny file-read*)(deny file-write*)(deny network*)':'(deny default)')+'(allow process*)(allow sysctl-read)(allow file-read-metadata '+metadata+')(allow file-read* '+terms+' (literal "/")(literal "/dev/null")(literal "/dev/urandom"))(deny file-read* '+denied.map(ref=>'(subpath '+JSON.stringify(ref)+')').join(' ')+')(allow file-write* '+writes.join(' ')+')'+(browser?[port,browserPort].map(p=>'(allow network-bind (local ip "localhost:'+p+'"))(allow network-inbound (local ip "localhost:'+p+'"))(allow network-outbound (remote ip "localhost:'+p+'"))').join('')+'(allow network* (local unix-socket (subpath '+JSON.stringify(scratch)+')) (remote unix-socket (subpath '+JSON.stringify(scratch)+')))':'(deny network*)');
  const output=path.join(scratch,'evidence');if(browser)await fs.mkdir(output,{recursive:true});
  const env={...environment(),TMPDIR:scratch,TMP:scratch,TEMP:scratch,...(browser?{HOME:scratch,CFFIXED_USER_HOME:scratch,MAC_CHROMIUM_TMPDIR:scratch,WORKKEEL_CHECK_PORT:String(port),WORKKEEL_CHECK_OUTPUT:output,WORKKEEL_CHECK_CANDIDATE:ctx.input.candidate??'',...(previewOrigin?{WORKKEEL_CHECK_ORIGIN:previewOrigin}:{})}:{})};
  const checkProfile=profile+(command==='node'||browser?'(deny process-fork)':'');
  const run=(signal,endpoint)=>processResult('/usr/bin/sandbox-exec',['-p',checkProfile,binary,...(browser?[args[0]]:args)],{cwd:ctx.component.root,signal,timeout_ms:duration(ctx),env:{...env,...(endpoint?{WORKKEEL_BROWSER_URL:endpoint}:{})}});
  const result=browser?await withOwnedBrowser({chrome,profile,port:browserPort,scratch,cwd:ctx.component.root,env,signal:ctx.signal,timeout_ms:duration(ctx)},({endpoint,signal})=>run(signal,endpoint)):await run(ctx.signal);
  if(browser){
    try{
    if(await fs.realpath(output)!==output)fail('browser evidence directory changed');
    const names=await fs.readdir(output);if(!names.length||names.length>16)return {...result,exit_code:result.exit_code||1,stderr:result.stderr+'\nBrowser check must retain 1 to 16 PNG screenshots',visual_evidence:[]};
    const visual_evidence=[];let bytes=0;
    for(const name of names){if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.png$/.test(name))fail('browser evidence must be named PNG screenshots');const file=path.join(output,name),handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let data;try{const stat=await handle.stat();if(!stat.isFile()||stat.size>1048576||(bytes+=stat.size)>8388608)fail('bounded regular browser evidence required');data=Buffer.alloc(stat.size);let offset=0;while(offset<data.length){const r=await handle.read(data,offset,data.length-offset,null);if(!r.bytesRead)fail('incomplete browser evidence');offset+=r.bytesRead;}}finally{await handle.close();}const dimensions=assertScreenshotPNG(data);const dir=await safeDirectory(ctx.component.root,'.ai-org/artifacts/'+ctx.component.task_id,{create:true}),ref='goal-browser-'+ctx.operation_id+'-'+check_id+'-'+name;await durableAtomicCreate(path.join(dir,ref),data);visual_evidence.push({path:'.ai-org/artifacts/'+ctx.component.task_id+'/'+ref,sha256:createHash('sha256').update(data).digest('hex'),...dimensions});}
    return {...result,visual_evidence};
    }catch(error){return {...result,exit_code:result.exit_code||1,stderr:result.stderr+'\nInvalid browser evidence: '+error.message,visual_evidence:[]};}
  }
  return result;
  }finally{if(browser)await fs.rm(scratch,{recursive:true,force:true});}
}
async function productChanges(ctx){
  const root=ctx.component.root,task=ctx.task;
  const tracked=(await readNativeGit(root,['diff','--no-renames','--name-only','-z','HEAD','--'])).split('\0').filter(Boolean);
  const untracked=(await readNativeGit(root,['ls-files','--others','--exclude-standard','-z'])).split('\0').filter(Boolean);
  const admin=p=>p==='.ai-org/work-items/'+task.id+'.json'||p.startsWith('.ai-org/artifacts/'+task.id+'/goal-');
  const files=[...new Set([...tracked,...untracked])].filter(p=>!admin(p));
  if(files.length>512)fail('checkpoint path bound exceeded');
  const pins=[];
  for(const ref of files){
    if(!task.contract.environment.write_paths.some(root=>within(ref,root)))fail('candidate path exceeds component approval: '+ref);
    try{const file=await readTaskFile(root,ref,{preserveBom:true});pins.push({path:ref,sha256:file.bytes_digest});}catch(e){if(e.code!=='ENOENT')throw e;pins.push({path:ref,sha256:null});}
  }
  return pins;
}
async function commit(ctx,runCommand,snapshot){
  const message='Workkeel goal '+ctx.operation_id;
  const previous=await runCommand(ctx,{command:'git',args:[...gitConfig,'log','-1','--format=%B']});
  if(previous.exit_code!==0)fail('cannot inspect checkpoint identity: '+previous.stderr.slice(0,600));
  if(previous.stdout.trim()===message){
    for(const pin of snapshot){try{const file=await readTaskFile(ctx.component.root,pin.path,{preserveBom:true});if(file.bytes_digest!==pin.sha256)fail('checkpoint source changed');}catch(e){if(e.code!=='ENOENT'||pin.sha256!==null)throw e;}}
    return (await readNativeGit(ctx.component.root,['rev-parse','HEAD'])).trim();
  }
  const current=await productChanges(ctx);if(executionDigest(current)!==executionDigest(snapshot))fail('implementation source changed before checkpoint');
  if(current.length){
    const add=await runCommand(ctx,{command:'git',args:[...gitConfig,'add','--',...current.map(p=>':(literal)'+p.path)],git_write:true});if(add.exit_code!==0)fail('exact file staging failed');
    const staged=(await readNativeGit(ctx.component.root,['diff','--cached','--name-only','-z','--'])).split('\0').filter(Boolean);
    if(staged.some(p=>!ctx.task.contract.environment.write_paths.some(root=>within(p,root))))fail('preexisting staged paths exceed approved scope');
    const committed=await runCommand(ctx,{command:'git',args:[...gitConfig,'commit','-m',message],git_write:true});if(committed.exit_code!==0)fail('candidate checkpoint failed');
  }
  return (await readNativeGit(ctx.component.root,['rev-parse','HEAD'])).trim();
}
function roleContract(ctx,access){
  const phase=ctx.input.phase,role=phase==='repair'?'repair':phase==='review'?'review':phase==='planning'?'planning':'implementation';
  // Discovery implementation is intentionally a read-only planning capability.
  const actualRole=access==='read'&&role==='implementation'?'planning':role;
  return {schema_version:'workkeel.role-contract/v1',role:actualRole,product_access:access,tests:actualRole==='planning'?'none':'coordinator',edit_tools:access==='write'?['codex']:[],model:{provider:'openai',model:ctx.input.model.model,effort:ctx.input.model.reasoning},usage:{fields:['input_tokens','output_tokens']}};
}
function authoredFailure(ctx,result){
  if(ctx.input.phase!=='review'||result?.status!=='failed'||result.outcome!=='attention')return false;
  try{return JSON.parse(result.output).native_request?.judgment==='fail';}catch{return false;}
}
/** Trusted stock host with fixed Codex protocol, role sandbox and unchanged
 * reviewer-authored request relay. Optional factories are trusted embedding code. */
export async function createCodexGoalAdapter({hostFactory=createLocalCodexSubscriptionHost,commandRunner=stockCommand}={}){
  if(typeof hostFactory!=='function'||typeof commandRunner!=='function')fail('trusted host functions required');
  const hosts=new Map(),runtimes=new Map();
  async function hostFor(root){if(!hosts.has(root))hosts.set(root,await hostFactory(root));return hosts.get(root);}
  async function componentCapabilities(ctx){
    const model=ctx.input.model;
    // Check the restricted Git environment before a model turn whose changes
    // could not be checkpointed. Global identity is intentionally absent.
    if(commandRunner===stockCommand&&process.platform==='darwin'&&ctx.component.purpose!=='discovery'&&['planning','implementation','repair'].includes(ctx.input.phase)){
      for(const identity of ['GIT_AUTHOR_IDENT','GIT_COMMITTER_IDENT']){
        const checked=await stockCommand({...ctx,goal:ctx.manifest.id,operation_id:ctx.operation_id??'capability-preflight'},{command:'git',args:[...gitConfig,'var',identity],check_id:'identity'});
        if(checked.exit_code!==0)fail('repository-local Git author and committer identity are required before model work; configure user.name and user.email in this checkout');
      }
    }
    if(commandRunner===stockCommand){if(process.platform!=='darwin')fail('qualified local command sandbox unavailable before model dispatch');const control=await readNativeTask(ctx.target,ctx.controller.task_id);for(const check of ctx.component.checks){if(!['node','git','browser'].includes(check.command)||!control.contract.environment.tools.includes(check.command))fail('mandatory check tool not supported or approved');if(check.command==='browser')await browserPrerequisites(ctx,check.args);}if(ctx.component.purpose!=='discovery'&&!control.contract.environment.tools.includes('git'))fail('checkpoint Git tool not approved');}
    if(ctx.manifest.limits.max_cost_usd!==null)fail('stock subscription host cannot enforce finite financial caps');
    if(model.provider!=='openai'||model.service!=='provider-default')fail('fixed provider or service unsupported; no fallback');
    if(ctx.task.contract.execution.runtime.adapter_id!=='codex-app-server'||ctx.task.contract.environment.data.model_access!=='approved-connection')fail('component did not approve the actual Codex model connection');
    const connection=ctx.task.contract.execution.model_connection;
    if(ctx.input.phase!=='verification'){
      if(connection.kind==='codex-subscription'){
        if(connection.model!==model.model||connection.effort!==model.reasoning)fail('fixed native model connection differs from the approved goal role');
      }else if(connection.kind==='policy'){
        const file=await readTaskFile(ctx.component.root,connection.policy_ref);if(!ctx.task.authority_pins.some(p=>p.path===connection.policy_ref&&p.sha256===file.bytes_digest))fail('source model policy is not unchanged and authority-pinned');
        const policy=validateExecutionPolicy(JSON.parse(file.content)),allowed=policy.models.find(m=>m.connection.kind==='codex-subscription'&&m.connection.model===model.model&&m.connection.effort===model.reasoning&&m.data_classes.includes(ctx.task.contract.environment.data.classification)&&(!m.routing||m.routing.provider===model.provider&&m.routing.reasoning_efforts.includes(model.reasoning)&&m.routing.service_tiers.includes(model.service)));
        if(!allowed)fail('goal role model is outside the original component data/risk allowlist');
        if(policy.model_policy){
          const bridge=policy.model_policy,profile=await readApprovedModelPolicy(ctx.component.root,{policy_id:bridge.policy_id,version:bridge.version,sha256:bridge.sha256},{require_active:true});
          const context=policy.model_contexts?.find(c=>c.node===ctx.input.phase),role=context?.role??bridge.context?.role;
          // The desktop dispatch catalog names the Codex host; the subscription
          // wire protocol names OpenAI. This mapping changes no model setting.
          const resolved=resolveModelPolicy(profile,{task:ctx.task.id,node:ctx.input.phase,activity:context?.activity??ctx.input.phase,...(role?{role}:{})}),catalog=profile.models.find(m=>(m.provider==='codex'?'openai':m.provider)===model.provider&&m.model===model.model);
          if(!catalog||!catalog.data_classes.includes(ctx.task.contract.environment.data.classification)||!catalog.risk_tiers.includes(ctx.task.contract.verification.risk_tier)||catalog.quality<bridge.min_quality||!catalog.reasoning_efforts.includes(model.reasoning)||!catalog.service_tiers.includes(model.service))fail('goal role model violates original layered data/risk/quality requirements');
          if(resolved.requested.model.mode==='fixed'&&resolved.requested.model.value!==catalog.id||resolved.requested.reasoning.mode==='fixed'&&resolved.requested.reasoning.value!==model.reasoning||resolved.requested.service.mode==='fixed'&&resolved.requested.service.value!==model.service)fail('goal role cannot bypass immutable fixed component policy');
        }
        if(policy.limits.max_cost_usd!==null&&(ctx.manifest.limits.max_cost_usd===null||ctx.manifest.limits.max_cost_usd>policy.limits.max_cost_usd))fail('goal financial limit exceeds original component policy');
      }else fail('source component did not approve a selectable Codex model connection');
    }
    const project=await readTaskProject(ctx.component.root);assertActor(project.policy,ctx.input.actor);
    const e=effective(ctx);await codexPermissionsForContract(ctx.component.root,e.contract,{productAccess:e.access});
    if(ctx.input.phase==='verification'&&commandRunner===stockCommand&&process.platform!=='darwin')fail('verification command sandbox unavailable');
  }
  async function capabilities(ctx){await componentCapabilities(ctx);const host=await hostFor(ctx.component.root);await host.assertCompatible({target:ctx.component.root,...effective(ctx)});}
  async function verified(ctx){
    const head=(await readNativeGit(ctx.component.root,['rev-parse','HEAD'])).trim();if(head!==ctx.input.candidate)fail('verification candidate changed');
    const checks=[],logs=[];for(const check of ctx.component.checks){const started=performance.now(),value=await commandRunner(ctx,{command:check.command,args:check.args,git_write:false,check_id:check.id});checks.push({id:check.id,status:value.exit_code===0&&!value.signal&&value.output_complete!==false?'pass':'fail'});logs.push({id:check.id,command:check.command,args:check.args,...value,duration_ms:performance.now()-started});}
    if((await readNativeGit(ctx.component.root,['rev-parse','HEAD'])).trim()!==head)fail('verification changed the committed candidate');
    const pin=await report(ctx,'verification',{schema_version:'workkeel.goal-checks/v1',operation_id:ctx.operation_id,candidate_revision:head,checks,logs,model_called:false});
    let integration_pin=null;
    if(ctx.component.id===ctx.manifest.integration.component_id){integration_pin=await report(ctx,'integration',{schema_version:'workkeel.goal-integration/v1',manifest_sha256:ctx.manifest_sha256,required_components:ctx.input.required_components,components:ctx.input.accepted_components,candidate_set_sha256:executionDigest(ctx.input.accepted_components),integration_candidate:head,checks});}
    return {status:'completed',operation_id:ctx.operation_id,actor:ctx.input.actor,thread_id:ctx.input.previous_threads.at(-1)??'local-verification-'+ctx.operation_id,runtime_selection:null,product_access:'read',candidate_revision:head,checks,evidence:await artifactRefs(ctx),integration_pin,report_pin:pin,usage:noCost,tool:'local-checks',model_called:false};
  }
  async function finalize(ctx,slot){
    const result=slot.runtime_result,e=effective(ctx),base={status:'completed',operation_id:ctx.operation_id,actor:ctx.input.actor,thread_id:result.conversation_id,runtime_selection:result.runtime_selection,product_access:e.access,usage:result.usage,tool:'codex',model_called:true};
    if((result.status!=='completed'||result.outcome!=='done')&&!authoredFailure(ctx,result)){
      const pin=await report(ctx,'attention',{schema_version:'workkeel.goal-attention/v1',operation_id:ctx.operation_id,phase:ctx.input.phase,thread_id:result.conversation_id,output:result.output,usage:result.usage});
      return {...base,status:'attention',reason:('Actual Codex role reports incomplete work: '+result.output).slice(0,1000),report_pin:pin};
    }
    if(ctx.input.phase==='review'){
      await visualEvidence(ctx);
      if(ctx.input.previous_threads.includes(result.conversation_id))fail('reviewer must use a distinct actual thread');
      const authored=JSON.parse(result.output);exactKeys(authored,['native_request']);const request=authored.native_request;
      exactKeys(request,['operation_id','expected_version','actor','revision','judgment','summary','evidence'],['review_attempt_id']);
      if(executionDigest(request.actor)!==executionDigest(ctx.input.actor)||request.operation_id!==ctx.operation_id||request.expected_version!==ctx.input.task_version||request.revision!==ctx.input.candidate||!['pass','fail'].includes(request.judgment)||request.review_attempt_id!==undefined)fail('reviewer authored request differs from exact native gate');
      const proofPath=reportRef(ctx,'review');if(!Array.isArray(request.evidence)||!request.evidence.includes(proofPath))fail('reviewer must explicitly name its authored proof');
      const pin=await report(ctx,'review',{schema_version:'workkeel.goal-authored-review/v1',actor:ctx.input.actor,thread_id:result.conversation_id,operation_id:ctx.operation_id,runtime_selection:result.runtime_selection,product_access:'read',native_request:request,usage:result.usage,raw_result_sha256:executionDigest(result)});
      // Import the exact bytes authored by this actual registered reviewer
      // thread. The coordinator never selects a judgment or rewrites the request.
      await mutateNativeTask(ctx.component.root,ctx.component.task_id,'review',request);
      return {...base,authored_request_pin:pin};
    }
    const pin=await report(ctx,ctx.input.phase,{schema_version:'workkeel.goal-role-result/v1',operation_id:ctx.operation_id,actor:ctx.input.actor,thread_id:result.conversation_id,runtime_selection:result.runtime_selection,product_access:e.access,phase:ctx.input.phase,output:result.output,usage:result.usage});
    if(ctx.input.phase==='planning')return {...base,report_pin:pin};
    if(ctx.component.purpose==='discovery'){
      const proposal_report=JSON.parse(result.output);exactKeys(proposal_report,['proposals']);if(!Array.isArray(proposal_report.proposals)||proposal_report.proposals.length>32)fail('bounded proposal report required');
      const source_pins=[];for(const proposal of proposal_report.proposals){if(!Array.isArray(proposal.evidence)||!proposal.evidence.length||proposal.evidence.length>32)fail('proposal requires exact evidence');for(const source of proposal.evidence){exactKeys(source,['path','sha256']);if(!ctx.task.contract.environment.read_paths.some(root=>within(source.path,root)))fail('proposal source outside component read authority');const file=await readTaskFile(ctx.component.root,source.path);if(file.bytes_digest!==source.sha256)fail('proposal evidence differs from actual bytes');source_pins.push(source);}}
      return {...base,candidate_revision:(await readNativeGit(ctx.component.root,['rev-parse','HEAD'])).trim(),proposal_report,source_pins,report_pin:pin};
    }
    return {...base,candidate_revision:await commit(ctx,commandRunner,slot.source_pins),report_pin:pin};
  }
  async function execute(ctx){
    let modelRequested=false,effectsMayExist=false,slot;
    try{
    await capabilities(ctx);
    if(typeof ctx.beforeEffects!=='function')fail('native goal dispatch guard required');
    await ctx.beforeEffects();
    if(ctx.input.phase==='verification'){
      effectsMayExist=true;const controller=new AbortController(),signal=ctx.signal?AbortSignal.any([ctx.signal,controller.signal]):controller.signal;
      const settled=verified({...ctx,signal});
      runtimes.set(ctx.operation_id,{cancel:async()=>{controller.abort();await settled.catch(()=>{});}});
      try{return await settled;}finally{runtimes.delete(ctx.operation_id);}
    }
    const e=effective(ctx),host=await hostFor(ctx.component.root);
    slot={schema_version:'workkeel.goal-runtime-slot/v1',operation_id:ctx.operation_id,input_sha256:executionDigest(ctx.input),actor:ctx.input.actor,thread_id:null,turn_id:null,model:ctx.input.model,product_access:e.access,status:'intent',model_requested:false,pre_model_stops:[],runtime_result:null,source_pins:[],final:null};
    let writes=Promise.resolve();const persist=()=>{const snapshot=structuredClone(slot);writes=writes.then(()=>writeSlot(ctx,snapshot));return writes;};
    try{
      const old=await readSlot(ctx);if(old.input_sha256!==slot.input_sha256)fail('runtime operation replay conflict');
      if(old.status==='not-started'&&old.model_requested===false){
        if(!Array.isArray(old.pre_model_stops)||old.pre_model_stops.length>=32){const error=Error('Pre-model stop history limit; retained evidence cannot be pruned');error.retentionBlocked=true;throw error;}
        slot.pre_model_stops=structuredClone(old.pre_model_stops);
      }else{
        effectsMayExist=true;if(old.final)return old.final;if(old.runtime_result)return await finalize(ctx,old);return {status:'unknown',reason:'Existing runtime intent requires exact host reconciliation'};
      }
    }catch(error){if(error.code!=='ENOENT')throw error;}
    await persist();
    const decorated={...host,connect:options=>{
      const rpc=host.connect({...options,onNotification:message=>{
        if(message.method==='turn/started'&&message.params?.threadId===slot.thread_id){slot.turn_id=message.params.turn?.id??slot.turn_id;slot.status='turn-confirmed';void persist().catch(()=>{});}
        options.onNotification(message);
      }}),request=rpc.request.bind(rpc);
      return {...rpc,request:async(method,params,timeout)=>{
        if(method==='turn/start'){modelRequested=true;effectsMayExist=true;slot.model_requested=true;}
        const value=await request(method,params,timeout);
        if(method==='thread/start'||method==='thread/resume'){slot.thread_id=value.thread?.id;slot.status='thread-confirmed';await persist();}
        if(method==='turn/start'){slot.turn_id=value.turn?.id;slot.status='turn-confirmed';await persist();}
        return value;
      }};
    }};
    const role=roleContract(ctx,e.access),roleHost=createTrustedRoleHost({id:'qualified-codex-goal',probe:async()=>({host:'qualified-codex-goal',enforcement:{sandbox:'enforced',product_access:e.access,network:'disabled',test_scratch:'none'},tools:['codex'],models:[{provider:'openai',model:ctx.input.model.model,efforts:[ctx.input.model.reasoning]}],usage:{fields:['input_tokens','output_tokens'],unknown:'null'}})});
    const runtime=createCodexRuntime(decorated,{coordinatorChecks:['git','tests'],role:{contract:role,host:roleHost},beforeModelDispatch:async()=>{
      await componentCapabilities(ctx);await ctx.beforeEffects();ctx.signal?.throwIfAborted();
    }});
    runtimes.set(ctx.operation_id,runtime);
    const discoveryDirection=ctx.manifest.derived_from?JSON.parse((await readTaskFile(ctx.target,ctx.manifest.derived_from.admission_ref)).content).value.direction:ctx.manifest.admission?.directions?.[0]??'unknown';
    const pictures=ctx.input.phase==='review'?await visualEvidence(ctx):[];
    const visualInstruction=pictures.length?' You must open the exact PNG screenshots with view_image and assess their actual pixels against the UI acceptance criteria. Check reports alone do not establish visual quality. Include concrete visual observations in your summary; fail if the images cannot be inspected. Screenshot paths and byte digests: '+JSON.stringify(pictures)+'.':'';
    const proof=reportRef(ctx,'review'),instruction=(ctx.input.phase==='review'
      ?'Independently review the complete exact candidate and mandatory checks. Author the entire native review request JSON {"native_request":{"operation_id":'+JSON.stringify(ctx.operation_id)+',"expected_version":'+ctx.input.task_version+',"actor":'+JSON.stringify(ctx.input.actor)+',"revision":'+JSON.stringify(ctx.input.candidate)+',"judgment":"pass or fail","summary":"your actual judgment","evidence":'+JSON.stringify([...new Set([...(ctx.input.verification?.evidence??[]),...(ctx.task.delivery?.evidence??[]).map(pin=>pin.path),proof])])+'}}. Omit review_attempt_id because there is no review recovery attempt. You own judgment and summary. No source edits. Completion is this exact authored request, not task acceptance.'
      :ctx.component.purpose==='discovery'&&ctx.input.phase==='implementation'
        ?'Explore permitted source evidence within the approved standing goal and bounds. Return only JSON {"proposals":[{"id":"stable observed-problem slug","title":"bounded observed opportunity","direction":"the approved direction supplied below","risk_tier":"low, standard, high, critical or unknown","expected_benefit":"specific before/after outcome to test","acceptance":["testable criterion"],"evidence":[{"path":"exact local path","sha256":"exact bytes SHA256"}],"scope":{"read_paths":[],"write_paths":[]},"budget":{"max_attempts":1,"max_runtime_ms":1000,"max_cost_usd":null}}]}. Empty proposals are valid. Unknown risk remains unknown. Never invent permission or call a benefit improved before observing results. Proposals do not create or approve tasks. Read-only product access. Approved discovery direction: '+JSON.stringify(discoveryDirection)+'.'
        :'Perform the approved '+ctx.input.phase+' for '+ctx.component.id+'. Read AGENTS.md and WORKKEEL.md and applicable Skills. Preserve allowed paths, exact task authority and existing behavior. Report work or attention honestly. The coordinator owns candidate Git/check/lifecycle operations; do not commit, run coordinator checks, or invent review/acceptance. Goal integration requires every mandatory component: '+JSON.stringify(ctx.input.required_components)+'. Prior exact accepted components: '+JSON.stringify(ctx.input.accepted_components)+'.')+visualInstruction;
    const previous_results={verification:ctx.input.verification??null,delivery:ctx.task.delivery??null,prior_attempt:ctx.task.attempts?.at(-1)??null};
    const context={target:ctx.component.root,operation_id:ctx.operation_id,run_id:ctx.goal,contract:e.contract,policy:e.policy,selection:e.selection,input:{instruction:instruction+' Read previous_results and its exact evidence paths before repair or review. They are observed results, not new authority.',previous_results},signal:ctx.signal};
    const previous=ctx.input.phase==='review'||executionDigest(ctx.input.previous_model)!==executionDigest(ctx.input.model)?null:ctx.input.previous_threads.at(-1);
    try{
      const result=await (previous?runtime.resume({...context,conversation_id:previous}):runtime.start(context));
      slot.runtime_result=result;slot.status='runtime-completed';
      if(['implementation','repair'].includes(ctx.input.phase)&&ctx.component.purpose!=='discovery')slot.source_pins=await productChanges(ctx);
      await persist();
      const final=await finalize(ctx,slot);slot.final=final;slot.status='completed';await persist();return final;
    }finally{try{await writes;}finally{runtimes.delete(ctx.operation_id);}}
    }catch(error){
      const reason=error.message.slice(0,1000),safe=!effectsMayExist&&!error.runtimeUnsettled&&!error.retentionBlocked;
      if(safe&&slot){
        slot.status='not-started';slot.model_requested=false;
        slot.pre_model_stops.push({reason,thread_id:slot.thread_id,at:new Date().toISOString(),quiescence:'no-model-request-and-owned-runtime-settled'});
        await writeSlot(ctx,slot);
      }
      return {status:'unknown',reason,model_called:modelRequested?true:effectsMayExist&&ctx.input.phase!=='verification'?null:false,...(safe?{dispatch_started:false}:{}),tool:'codex'};
    }
  }
  async function reconcile(ctx){
    let slot;try{slot=await readSlot(ctx);}catch(e){if(e.code==='ENOENT')return {status:'unknown',reason:'No runtime slot; no automatic inference replay'};throw e;}
    if(slot.input_sha256!==executionDigest(ctx.input))fail('reconciliation input differs');
    if(slot.final&&(slot.final.status!=='attention'||!authoredFailure(ctx,slot.runtime_result)))return slot.final;
    if(slot.runtime_result){await capabilities(ctx);const final=await finalize(ctx,slot);slot.final=final;slot.status='completed';await writeSlot(ctx,slot);return final;}
    return {status:'unknown',reason:'Actual turn result unavailable; reconcile exact host thread before continuation',thread_id:slot.thread_id,turn_id:slot.turn_id};
  }
  async function cancel(ctx){
    const active=runtimes.get(ctx.operation_id);if(active){await active.cancel({operation_id:ctx.operation_id});return {status:'cancelled',reason:'Actual owned Codex runtime settled after interruption'};}
    const slot=await readSlot(ctx);if(slot.input_sha256!==executionDigest(ctx.input))fail('cancellation input differs');
    if(slot.final||slot.runtime_result)return {status:'cancelled',reason:'Recorded actual runtime is already settled'};
    const stop=Array.isArray(slot.pre_model_stops)?slot.pre_model_stops.at(-1):null;
    if(['not-started','cancelled'].includes(slot.status)&&slot.model_requested===false&&slot.turn_id===null&&stop?.quiescence==='no-model-request-and-owned-runtime-settled'&&stop.thread_id===slot.thread_id){
      // This proof is written only after the owned runtime has settled without
      // requesting a model. There is no turn to interrupt; preserve that proof
      // and settle the exact slot so frozen whole-goal cancellation can proceed.
      if(slot.status!=='cancelled'){slot.status='cancelled';await writeSlot(ctx,slot);}
      return {status:'cancelled',reason:'Exact unstarted operation and settled owned runtime confirmed',model_called:false};
    }
    if(!slot.thread_id||!slot.turn_id)return {status:'unknown',reason:'Actual dispatched thread/turn identity not confirmed; stop requires host reconciliation'};
    const host=await hostFor(ctx.component.root),permissions='workkeel-'+randomUUID(),profile=await codexPermissionsForContract(ctx.component.root,effective(ctx).contract,{productAccess:'read'}),rpc=host.connect({target:ctx.component.root,permissionProfile:{id:permissions,profile},onNotification:()=>{},onRequest:()=>{throw Error('Approval forbidden during stop');},onError:()=>{}});
    try{
      await rpc.request('initialize',{clientInfo:{name:'workkeel-goal-stop',version:'1'},capabilities:{experimentalApi:true}});rpc.notify('initialized');
      const before=await rpc.request('thread/read',{threadId:slot.thread_id,includeTurns:true}),recorded=before.thread?.turns?.find(t=>t.id===slot.turn_id);
      if(!recorded)return {status:'unknown',reason:'Exact recorded turn is unavailable for cancellation'};
      if(['completed','failed','interrupted'].includes(recorded.status)){
        // A new app-server does not load persisted threads merely by reading
        // them. Resume the exact settled thread with read-only permissions and
        // no turn/start, then confirm its background resources are empty.
        const loaded=await rpc.request('thread/resume',{threadId:slot.thread_id,cwd:ctx.component.root,approvalPolicy:'never',permissions,model:ctx.input.model.model,modelProvider:'openai',serviceTier:'default',config:{model_reasoning_effort:ctx.input.model.reasoning}});
        if(loaded.thread?.id!==slot.thread_id||loaded.activePermissionProfile?.id!==permissions)return {status:'unknown',reason:'Settled thread could not be loaded with the cancellation permission profile'};
      }else await rpc.request('turn/interrupt',{threadId:slot.thread_id,turnId:slot.turn_id});
      await rpc.request('thread/backgroundTerminals/clean',{threadId:slot.thread_id});
      const data=await rpc.request('thread/backgroundTerminals/list',{threadId:slot.thread_id}),thread=await rpc.request('thread/read',{threadId:slot.thread_id,includeTurns:true});
      const turn=thread.thread?.turns?.find(t=>t.id===slot.turn_id);
      if(!Array.isArray(data.data)||data.data.length||data.nextCursor||!turn||!['completed','failed','interrupted'].includes(turn.status))return {status:'unknown',reason:'Exact remote runtime quiescence not confirmed'};
      slot.status='cancelled';await writeSlot(ctx,slot);return {status:'cancelled',reason:'Exact thread terminal state and empty background terminals confirmed'};
    }finally{await rpc.close();}
  }
  return createTrustedGoalAdapter({id:'codex-native-goal',assertCapabilities:capabilities,execute,reconcile,cancel});
}
