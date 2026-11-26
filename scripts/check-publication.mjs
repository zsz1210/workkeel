import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifestPath='public-files.json';
const localSetupFiles=new Set(['WORKKEEL.md','workkeelw.mjs']);
const forbiddenRoots=/^(?:\.ai-org|\.codex|\.workkeel-private|node_modules|output|coverage|private|backups)(?:\/|$)|^(?:TEMPLE\.md|temple\.lock|templew\.mjs|workkeel\.lock)$|^docs\/(?:validation|planning|pilots|research|policies)(?:\/|$)/;
const forbiddenNames=/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|id_rsa|id_ed25519|credentials(?:\..*)?|[^/]*\.jsonl|[^/]*\.log|[^/]*\.bundle|[^/]*\.tgz|[^/]*\.zip)$/i;
/** @type {[string,RegExp][]} */
const privateContent=[
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['provider-token',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/],
  ['npm-token',/\bnpm_[A-Za-z0-9]{30,}\b/],
  ['personal-home',/\/(?:Users|home)\/(?!example(?:\/|\b)|user(?:\/|\b)|alice(?:\/|\b)|bob(?:\/|\b)|fixture(?:\/|\b)|tester(?:\/|\b)|runner(?:\/|\b))[^/\s"'`]+\//],
  ['private-network-host',/\b192\.168\.(?!0\.0\b)\d{1,3}\.\d{1,3}\b/]
];
// Commit messages must not carry Co-Authored-By or "Generated with" trailers.
// The 38 commits of 2026-10-18 to 2026-10-20 (7bcf9701..29d755e2, all on main)
// predate this rule and keep their Co-Authored-By trailer. The list is frozen:
// it exempts those exact commits from that one rule and nothing else.
export const HISTORICAL_TRAILER_COMMITS=Object.freeze([
 '7bcf970101d4043ecab661887c555321b4eb1921','d0153b7d703d8c38cc549961c8de3bfbcb03c95f',
 '79ef6b00ab4679ae6d1a1f4f556c409cb8830052','a3222bb1e8fa60df41b4dfa54b0542aaed737888',
 '95739cecf80687accd92e74fdf2f73db628c43a3','404f832cfe451a216602f83525f210094ec11148',
 '8359fdcfc7c75ef01b9eb4ea34e44a003e458026','a41e00c589f7f4bb3554162c9fe0a2659d3a6078',
 '28492446441a1f70117a12ece062688b939f3865','a29a8d42d42fc417600879c75e38ae274b6a0c0d',
 'c1255855db0bc1e6914a067da5d0794392740ed0','2d8d38a8812c829e7f8f4ff26f21e1cae0da2703',
 'bd0865ebe74736f17c1d8532ec9d8c9f461c068f','369f8ac76c2b5746bbf000efd9ca096a823d113a',
 'a96562322f3c468c33b9b508fe9251a45e1d2624','acf6dff5be4ec8e8c13bf2f1651a5652ea9ca956',
 '7ee4e1ced0fd8a84a36fc604dcf33f52f7f00d26','733d096fdbd3f99e2610750b24f9d18915228f08',
 '7dd1689c6f0acc9abeb08f17275d0cf2a5d2af80','db27a8f39bc82c735f49b360f7e0b514b4c60d99',
 'fefe2ea69ef588b902c8e8865aab0131967d15cd','2ca732775bd3140b4ffdac7121a6a70ec4cfd9b5',
 '7ea10212ae0fe94eb0b7af223b9b67d2f2785327','140e25a551090d54641bdc85c2cde149f5bb41b6',
 '7b0ef3ba97b4a498e19905e099dd624451c57def','83359cf6ced246eed9012ce0ab359f2311202c14',
 '6f45a5a2b4ac96fecda08c2d37c463e615ebabda','54583def0219f4bfc8b3627f324c6b5d351fbe7a',
 'a5c3436cf4363ebb8492836bd96c6e99693588fc','5119e78c8fa7e0745311b5fc60156503b56a5ebf',
 '97fdb1b6e9ee49d6ad89b726fe8e43aa77fd95b7','d3e42501f417ab51e3eb49aebe43809110d48bed',
 '04fe076ed2a7d45a604be32640ea6dec1fee05df','e81e58a3e9860efe78ee59fad4734e10383a6a5a',
 '7b5287dd20ef73ab425cdaa1c9ce5e74460ffa2b','70e14691a5712662c7f8fd7d86028a942b289a2b',
 'dc7c5a55d855ab5ab1dafa89e05549f1adb617da','29d755e24dd45d51736947e843505f2e6e438b01'
]);
const historicalTrailerCommits=new Set(HISTORICAL_TRAILER_COMMITS);
/** @type {[string,RegExp][]} */
const forbiddenTrailers=[['Co-Authored-By',/^[ \t]*co-authored-by[ \t]*:/im],['Generated with',/^[^\S\n]*(?:[^\w\s]+[^\S\n]*)?generated with\b/im]];
/** History failures for one commit message; only the frozen commits keep their Co-Authored-By trailer. */
export function commitTrailerFailures(commit,message){
 return forbiddenTrailers.filter(([name,expression])=>expression.test(message)&&!(name==='Co-Authored-By'&&historicalTrailerCommits.has(commit)))
  .map(([trailer])=>({commit,trailer,rule:'commit-trailer'}));
}
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
  for(const record of git(cwd,['log','--no-show-signature','--format=%H%x00%B%x1e',...tips,'--']).split('\x1e')){
   const separator=record.indexOf('\0');if(separator<0)continue;
   const commit=record.slice(0,separator).trim(),message=record.slice(separator+1);
   failures.push(...commitTrailerFailures(commit,message));
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
