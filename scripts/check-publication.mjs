import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifestPath='public-files.json';
const localSetupFiles=new Set(['WORKKEEL.md','workkeelw.mjs']);
const forbiddenRoots=/^(?:\.ai-org|\.codex|\.workkeel-private|node_modules|output|coverage|private|backups)(?:\/|$)|^(?:TEMPLE\.md|temple\.lock|templew\.mjs|workkeel\.lock)$|^docs\/(?:validation|planning|pilots|research|policies)(?:\/|$)/;
const forbiddenNames=/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|id_rsa|id_ed25519|credentials(?:\..*)?|[^/]*\.jsonl|[^/]*\.log|[^/]*\.bundle|[^/]*\.tgz|[^/]*\.zip)$/i;
const privateContent=[
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['provider-token',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/],
  ['npm-token',/\bnpm_[A-Za-z0-9]{30,}\b/],
  ['personal-home',/\/(?:Users|home)\/(?!example(?:\/|\b)|user(?:\/|\b)|alice(?:\/|\b)|bob(?:\/|\b)|fixture(?:\/|\b)|tester(?:\/|\b)|runner(?:\/|\b))[^/\s"'`]+\//],
  ['private-network-host',/\b192\.168\.(?!0\.0\b)\d{1,3}\.\d{1,3}\b/]
];
const git=(cwd,args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});

export function readAllowlist(cwd=root){
 const document=JSON.parse(fs.readFileSync(path.join(cwd,manifestPath),'utf8'));
 if(document.schema_version!=='workkeel.public-files/v1'||!Array.isArray(document.files)||!document.files.length||document.files.length>10000)throw Error('Invalid public-file manifest');
 const files=new Set();
 for(const file of document.files){
  if(typeof file!=='string'||!file||file.startsWith('/')||file.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f\x7f*?\[\]{}:]/.test(file)||files.has(file)||localSetupFiles.has(file)||forbiddenRoots.test(file)||forbiddenNames.test(file))throw Error('Invalid or private path in public-file manifest');
  files.add(file);
 }
 if(!files.has(manifestPath))throw Error('Manifest must declare itself');
 identityExceptions(document);
 return files;
}

function identityExceptions(document){
 const entries=Object.hasOwn(document,'historical_identities')?document.historical_identities:[];
 if(!Array.isArray(entries)||entries.length>16||entries.some(hash=>typeof hash!=='string'||!/^[a-f0-9]{40}$/.test(hash))||new Set(entries).size!==entries.length)
  throw Error('Invalid historical-identity exceptions; use at most 16 unique full lowercase commit hashes');
 return new Set(entries);
}

function readHistoryExceptions(cwd){
 const entries=JSON.parse(fs.readFileSync(path.join(cwd,manifestPath),'utf8')).historical_files??[];
 if(!Array.isArray(entries)||entries.length>2)throw Error('Invalid historical-file exceptions');
 const result=new Set(),paths=new Set();
 for(const entry of entries){
  if(!entry||!localSetupFiles.has(entry.path)||paths.has(entry.path)||entry.mode!=='100644'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.blob))throw Error('Invalid historical-file exception');
  paths.add(entry.path);result.add(entry.path+'\0'+entry.blob+'\0'+entry.mode);
 }
 return result;
}

export function inspectPublicFile(file,bytes,allowed,mode='100644'){
 const findings=[];
 if(!allowed.has(file))findings.push('not-allowlisted');
 if(localSetupFiles.has(file)||forbiddenRoots.test(file)||forbiddenNames.test(file))findings.push('private-path');
 if(!['100644','100755'].includes(mode))findings.push('non-regular-git-entry');
 if(bytes.length>2*1024*1024)findings.push('file-size-limit');
 if(bytes.includes(0))findings.push('binary-content-not-approved');
 const text=bytes.toString('utf8');
 for(const [label,expression] of privateContent)if(expression.test(text))findings.push(label);
 return findings.map(rule=>({path:file,rule}));
}

export function checkPublication(cwd=root,{mode='working',revisions=[]}={}){
 const allowed=readAllowlist(cwd),historicalFiles=readHistoryExceptions(cwd),failures=[],seen=new Set();let commits=0,files=0,bytes=0;
 const inspect=(file,data,gitMode,historical=false)=>{files++;bytes+=data.length;
  const findings=inspectPublicFile(file,data,allowed,gitMode);
  failures.push(...findings.filter(f=>!historical||!['not-allowlisted','private-path'].includes(f.rule)));
 };
 if(mode==='working'){
  const names=git(cwd,['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(Boolean);
  for(const file of new Set(names)){
   const resolved=path.join(cwd,file);let stat;
   try{stat=fs.lstatSync(resolved);}catch{failures.push({path:file,rule:'missing-working-file'});continue;}
   if(!stat.isFile()||stat.isSymbolicLink()){failures.push({path:file,rule:'non-regular-working-entry'});continue;}
   inspect(file,fs.readFileSync(resolved),stat.mode&0o111?'100755':'100644');
  }
 }else if(mode==='staged'){
  const entries=git(cwd,['ls-files','--stage','-z']).split('\0').filter(Boolean);
  for(const entry of entries){const match=entry.match(/^(\d+) ([a-f0-9]+) (\d+)\t([\s\S]+)$/);if(!match)throw Error('Malformed Git index');
   const [,gitMode,oid,stage,file]=match;if(stage!=='0'){failures.push({path:file,rule:'unmerged-index'});continue;}
   if(!['100644','100755'].includes(gitMode)){inspect(file,Buffer.alloc(0),gitMode);continue;}
   inspect(file,execFileSync('git',['-C',cwd,'cat-file','blob',oid],{maxBuffer:3*1024*1024}),gitMode);
  }
 }else if(mode==='history'){
  if(revisions.some(r=>!(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/).test(r)))throw Error('History revisions must be full Git object IDs');
  const tips=new Set(git(cwd,['rev-list','--no-walk',...(revisions.length?revisions:['--all','HEAD'])]).trim().split('\n').filter(Boolean));
  const reachable=git(cwd,['rev-list',...tips]).trim().split('\n').filter(Boolean);commits=reachable.length;
  if(!commits)throw Error('No committed history to verify');
  const identities=identityExceptions(JSON.parse(fs.readFileSync(path.join(cwd,manifestPath),'utf8')));
  const allowedIdentity=email=>/@users\.noreply\.github\.com$|^noreply@github\.com$|\.invalid$/i.test(email);
  for(const line of git(cwd,['log','--no-show-signature','--format=%H%x00%ae%x00%ce',...tips,'--']).trim().split('\n').filter(Boolean)){
   const [commit,author,committer]=line.split('\0');
   if(identities.has(commit))continue;
   for(const [field,email] of [['author',author],['committer',committer]])if(!allowedIdentity(email??''))failures.push({commit,field,rule:'commit-identity'});
  }
  for(const commit of reachable){
   for(const entry of git(cwd,['ls-tree','-r','-z',commit]).split('\0').filter(Boolean)){
    const match=entry.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/);if(!match)throw Error('Malformed Git tree');
    const [,gitMode,type,oid,file]=match,key=file+'\0'+oid+'\0'+gitMode;
    const historical=!tips.has(commit)&&historicalFiles.has(key),seenKey=key+'\0'+historical;
    if(seen.has(seenKey))continue;seen.add(seenKey);
    if(type!=='blob'||!['100644','100755'].includes(gitMode)){inspect(file,Buffer.alloc(0),gitMode);continue;}
    inspect(file,execFileSync('git',['-C',cwd,'cat-file','blob',oid],{maxBuffer:3*1024*1024}),gitMode,historical);
   }
  }
 }else throw Error('Unknown publication check mode');
 return {schema_version:'workkeel.publication-check/v1',mode,commits,files,bytes,passed:failures.length===0,failures,limitations:['An allowlist and pattern check do not establish that arbitrary content is safe. Review newly allowlisted files before publishing.','Local hooks can be bypassed; use the reviewed publication procedure and repository CI as additional controls.']};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),option=args.shift()??'--working';
  const mode=({'--working':'working','--staged':'staged','--history':'history'})[option];
  if(!mode||mode!=='history'&&args.length)throw Error('Usage: check-publication.mjs [--working|--staged|--history [full-commit-id...]]');
  const report=checkPublication(root,{mode,revisions:args});console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
 }catch(error){console.error('Publication check failed: '+error.message);process.exitCode=1;}
}
