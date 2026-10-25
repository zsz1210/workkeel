import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkPublication,inspectPublicFile,readAllowlist} from '../scripts/check-publication.mjs';
import {checkSourceCheckout} from '../scripts/check-source-checkout.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function fixture(t){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'workkeel-publication-'));
 t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(cwd,'public-files.json'),JSON.stringify({schema_version:'workkeel.public-files/v1',files:['public-files.json','README.md']}));
 fs.writeFileSync(path.join(cwd,'README.md'),'Synthetic public source\n');git('add','public-files.json','README.md');git('commit','-qm','Public baseline');
 return {cwd,git};
}
test('clean working, staged and committed content passes without publishing',t=>{
 const {cwd}=fixture(t);
 for(const mode of ['working','staged','history'])assert.equal(checkPublication(cwd,{mode}).passed,true,mode);
});
for(const field of ['author','committer']) test(`history rejects a personal ${field} identity without exposing its email`,t=>{
 const {cwd,git}=fixture(t),email='fixture@personal.example';
 if(field==='author')git('commit','--allow-empty','-qm','Synthetic author','--author',`Fixture <${email}>`);
 else git('-c',`user.email=${email}`,'commit','--allow-empty','-qm','Synthetic committer','--author','Fixture <fixture@example.invalid>');
 const commit=git('rev-parse','HEAD'),report=checkPublication(cwd,{mode:'history'});
 assert.equal(report.passed,false);
 assert.deepEqual(report.failures,[{commit,field,rule:'commit-identity'}]);
 assert.ok(!JSON.stringify(report).includes(email));
 const manifest=path.join(cwd,'public-files.json'),document=JSON.parse(fs.readFileSync(manifest,'utf8'));
 document.historical_identities=[commit];fs.writeFileSync(manifest,JSON.stringify(document));
 assert.equal(checkPublication(cwd,{mode:'history'}).passed,true);
});
for(const email of ['fixture@users.noreply.github.com','noreply@github.com','fixture@example.invalid']) test(`history permits ${email.endsWith('.invalid')?'invalid-domain':'noreply'} identities`,t=>{
 const {cwd,git}=fixture(t);
 git('-c',`user.email=${email}`,'commit','--allow-empty','-qm','Allowed identity','--author',`Fixture <${email}>`);
 assert.equal(checkPublication(cwd,{mode:'history'}).passed,true);
});
test('history checks merge identities even when all tree bytes were already scanned',t=>{
 const {cwd,git}=fixture(t),base=git('rev-parse','HEAD');
 git('checkout','-qb','side');git('commit','--allow-empty','-qm','Side');
 git('checkout','-qb','target',base);git('commit','--allow-empty','-qm','Main');
 git('-c','user.email=fixture@personal.example','merge','--no-ff','-qm','Synthetic merge','side');
 const report=checkPublication(cwd,{mode:'history'}),commit=git('rev-parse','HEAD');
 assert.deepEqual(report.failures,[{commit,field:'author',rule:'commit-identity'},{commit,field:'committer',rule:'commit-identity'}]);
});
test('historical identity exceptions require bounded unique full lowercase hashes',t=>{
 const {cwd}=fixture(t),manifest=path.join(cwd,'public-files.json'),document=JSON.parse(fs.readFileSync(manifest,'utf8'));
 for(const entries of [null,{},['abc'],['A'.repeat(40)],['a'.repeat(40),'a'.repeat(40)],Array.from({length:17},(_,i)=>i.toString(16).padStart(40,'0'))]){
  fs.writeFileSync(manifest,JSON.stringify({...document,historical_identities:entries}));
  assert.throws(()=>readAllowlist(cwd),/historical-identity/);
 }
});
test('clean public checkout permits dependencies and nested synthetic framework templates',t=>{
 const {cwd}=fixture(t);
 for(const directory of ['node_modules','project-overlay/.ai-org','docs/getting-started'])fs.mkdirSync(path.join(cwd,directory),{recursive:true});
 fs.writeFileSync(path.join(cwd,'docs/getting-started/workkeel.md'),'Public guide');
 fs.writeFileSync(path.join(cwd,'project-overlay/.ai-org/template.json'),'{}');
 const manifest=path.join(cwd,'public-files.json'),policy=JSON.parse(fs.readFileSync(manifest,'utf8'));
 policy.files.push('docs/getting-started/workkeel.md','project-overlay/.ai-org/template.json');
 fs.writeFileSync(manifest,JSON.stringify(policy));
 assert.equal(checkSourceCheckout(cwd).passed,true);
 fs.writeFileSync(path.join(cwd,'project-overlay/.ai-org/private-record.json'),'Synthetic unexpected task');
 assert.deepEqual(checkSourceCheckout(cwd).failures,[{path:'project-overlay/.ai-org/private-record.json',rule:'private-state-in-public-checkout'}]);
});
test('ignored real-state paths fail the public-checkout check without exposing or modifying contents',t=>{
 const {cwd,git}=fixture(t),content='Synthetic private record that must not appear in a report';
 fs.copyFileSync(path.join(root,'.gitignore'),path.join(cwd,'.gitignore'));
 for(const name of ['.ai-org','output']){
  fs.mkdirSync(path.join(cwd,name));fs.writeFileSync(path.join(cwd,name,'record.json'),content);
 }
 for(const name of ['WORKKEEL.md','workkeel.lock','workkeelw.mjs','session.log'])fs.writeFileSync(path.join(cwd,name),content);
 assert.equal(git('status','--short','--','.ai-org','output','WORKKEEL.md','workkeel.lock','workkeelw.mjs','session.log'),'');
 const report=checkSourceCheckout(cwd);
 assert.equal(report.passed,false);assert.equal(report.failures.length,6);
 assert.ok(!JSON.stringify(report).includes(content));
 assert.equal(fs.readFileSync(path.join(cwd,'.ai-org/record.json'),'utf8'),content);
});
test('dangling private-state symlinks are rejected without following their targets',t=>{
 const {cwd}=fixture(t);fs.symlinkSync('missing-private-target',path.join(cwd,'.ai-org'));
 assert.deepEqual(checkSourceCheckout(cwd).failures,[{path:'.ai-org',rule:'symlink-in-public-checkout'}]);
});
test('nested ignored output cannot bypass the public-checkout or pre-push guard',t=>{
 const {cwd,git}=fixture(t);
 fs.copyFileSync(path.join(root,'.gitignore'),path.join(cwd,'.gitignore'));
 fs.mkdirSync(path.join(cwd,'docs/output'),{recursive:true});
 fs.writeFileSync(path.join(cwd,'docs/output/private-evidence.json'),'Synthetic private evidence');
 assert.equal(git('status','--short','--','docs/output'),'');
 assert.deepEqual(checkSourceCheckout(cwd).failures,[{path:'docs/output',rule:'private-state-in-public-checkout'}]);
 fs.mkdirSync(path.join(cwd,'scripts'));
 for(const file of ['check-source-checkout.mjs','check-publication.mjs'])fs.copyFileSync(path.join(root,'scripts',file),path.join(cwd,'scripts',file));
 const oid=git('rev-parse','HEAD');
 const pushed=spawnSync('sh',[path.join(root,'.githooks/pre-push')],{cwd,input:`refs/heads/workkeel/x ${oid} refs/heads/workkeel/x ${'0'.repeat(40)}\n`,encoding:'utf8'});
 assert.equal(pushed.status,1);assert.match(pushed.stdout,/docs\/output/);
});
test('private paths and undeclared files fail even if force-staged',t=>{
 const {cwd,git}=fixture(t);fs.mkdirSync(path.join(cwd,'.ai-org'));
 fs.writeFileSync(path.join(cwd,'.ai-org','record.json'),'{}');git('add','-f','.ai-org/record.json');
 assert.ok(checkPublication(cwd,{mode:'staged'}).failures.some(r=>r.rule==='private-path'));
 fs.writeFileSync(path.join(cwd,'unreviewed.txt'),'public-looking but unreviewed');
 assert.ok(checkPublication(cwd).failures.some(r=>r.path==='unreviewed.txt'&&r.rule==='not-allowlisted'));
});
test('source ignore rules retain nested framework templates while excluding local task state',t=>{
 const {cwd,git}=fixture(t);
 fs.copyFileSync(path.join(root,'.gitignore'),path.join(cwd,'.gitignore'));
 const publicPaths=['project-overlay/.ai-org/core/positions.json','docs/getting-started/workkeel.md'];
 const localPaths=['.ai-org/private/task.json','WORKKEEL.md','workkeelw.mjs','workkeel.lock'];
 for(const file of [...publicPaths,...localPaths]){
  fs.mkdirSync(path.dirname(path.join(cwd,file)),{recursive:true});fs.writeFileSync(path.join(cwd,file),'Synthetic fixture');
 }
 const visible=git('ls-files','--others','--exclude-standard').split('\n');
 for(const file of publicPaths)assert.ok(visible.includes(file),file);
 for(const file of localPaths)assert.ok(!visible.includes(file),file);
});
test('a secret deleted from the latest tree remains rejected in outgoing history',t=>{
 const {cwd,git}=fixture(t);fs.writeFileSync(path.join(cwd,'README.md'),'ghp_'+'A'.repeat(36));
 git('add','README.md');git('commit','-qm','Synthetic forbidden token');
 fs.writeFileSync(path.join(cwd,'README.md'),'Clean latest view');git('add','README.md');git('commit','-qm','Remove synthetic token');
 assert.equal(checkPublication(cwd).passed,true);
 assert.ok(checkPublication(cwd,{mode:'history',revisions:[git('rev-parse','HEAD')]}).failures.some(r=>r.rule==='github-token'));
});
test('staged bytes are checked independently from repaired working bytes',t=>{
 const {cwd,git}=fixture(t);fs.writeFileSync(path.join(cwd,'README.md'),'npm_'+'B'.repeat(36));git('add','README.md');
 fs.writeFileSync(path.join(cwd,'README.md'),'Clean working bytes');
 assert.equal(checkPublication(cwd).passed,true);
 assert.ok(checkPublication(cwd,{mode:'staged'}).failures.some(r=>r.rule==='npm-token'));
});
test('symlinks and gitlinks cannot smuggle data through an allowlisted filename',t=>{
 const {cwd,git}=fixture(t);fs.unlinkSync(path.join(cwd,'README.md'));fs.symlinkSync('public-files.json',path.join(cwd,'README.md'));git('add','README.md');
 assert.ok(checkPublication(cwd).failures.some(r=>r.rule==='non-regular-working-entry'));
 assert.ok(checkPublication(cwd,{mode:'staged'}).failures.some(r=>r.rule==='non-regular-git-entry'));
 assert.ok(inspectPublicFile('README.md',Buffer.alloc(0),new Set(['README.md']),'160000').some(r=>r.rule==='non-regular-git-entry'));
});
test('path traversal, private-path additions and revision options fail closed',t=>{
 const {cwd}=fixture(t);
 assert.throws(()=>checkPublication(cwd,{mode:'history',revisions:['--all']}),/full Git object IDs/);
 for(const file of ['../escape','.ai-org/data.json','docs/validation/result.md','x/../README.md','WORKKEEL.md','workkeelw.mjs']){
  fs.writeFileSync(path.join(cwd,'public-files.json'),JSON.stringify({schema_version:'workkeel.public-files/v1',files:['public-files.json',file]}));
  assert.throws(()=>readAllowlist(cwd),/Invalid or private/);
 }
});
test('exact bootstrap history exceptions never permit setup files in the index or outgoing tips',t=>{
 const {cwd,git}=fixture(t),file=path.join(cwd,'WORKKEEL.md'),manifest=path.join(cwd,'public-files.json');
 fs.writeFileSync(file,'Generic bootstrap instructions');git('add','WORKKEEL.md');git('commit','-qm','Generic bootstrap');
 const bootstrap=git('rev-parse','HEAD'),blob=git('rev-parse','HEAD:WORKKEEL.md');
 const policy=JSON.parse(fs.readFileSync(manifest,'utf8'));
 policy.historical_files=[{path:'WORKKEEL.md',blob,mode:'100644'}];fs.writeFileSync(manifest,JSON.stringify(policy));
 git('rm','WORKKEEL.md');git('add','public-files.json');git('commit','-qm','Separate local initialization');
 for(const mode of ['working','staged','history'])assert.equal(checkPublication(cwd,{mode}).passed,true,mode);
 assert.equal(checkPublication(cwd,{mode:'history',revisions:[bootstrap,git('rev-parse','HEAD')]}).passed,false);
 fs.writeFileSync(file,'Generic bootstrap instructions');git('add','WORKKEEL.md');
 for(const mode of ['working','staged'])assert.equal(checkPublication(cwd,{mode}).passed,false,mode);
 git('commit','-qm','Attempt to reintroduce setup file');
 assert.equal(checkPublication(cwd,{mode:'history'}).passed,false);
 fs.writeFileSync(file,'Different unapproved instructions');git('add','WORKKEEL.md');git('commit','-qm','Unapproved historical content');
 git('rm','WORKKEEL.md');git('commit','-qm','Remove from current tree');
 assert.equal(checkPublication(cwd,{mode:'history'}).passed,false);
 policy.historical_files=[{path:'.ai-org/private.json',blob,mode:'100644'}];fs.writeFileSync(manifest,JSON.stringify(policy));
 assert.throws(()=>checkPublication(cwd,{mode:'history'}),/Invalid historical-file/);
});
test('historical path exceptions do not suppress credential detection',t=>{
 const {cwd,git}=fixture(t),manifest=path.join(cwd,'public-files.json');
 fs.writeFileSync(path.join(cwd,'WORKKEEL.md'),'npm_'+'D'.repeat(36));git('add','WORKKEEL.md');git('commit','-qm','Synthetic bad bootstrap');
 const policy=JSON.parse(fs.readFileSync(manifest,'utf8'));
 policy.historical_files=[{path:'WORKKEEL.md',blob:git('rev-parse','HEAD:WORKKEEL.md'),mode:'100644'}];
 fs.writeFileSync(manifest,JSON.stringify(policy));git('rm','WORKKEEL.md');git('add','public-files.json');git('commit','-qm','Remove synthetic bootstrap');
 assert.ok(checkPublication(cwd,{mode:'history'}).failures.some(r=>r.rule==='npm-token'));
});
test('content checks cover personal paths and credentials without echoing their values',()=>{
 const allowed=new Set(['README.md']);
 for(const content of ['/'+'Users/maintainer/project/file','sk-proj-'+'C'.repeat(50),'-----BEGIN '+'PRIVATE KEY-----']){
  const result=inspectPublicFile('README.md',Buffer.from(content),allowed);
  assert.ok(result.length);assert.ok(!JSON.stringify(result).includes(content));
 }
 assert.deepEqual(inspectPublicFile('README.md',Buffer.from('/Users/example/project'),allowed),[]);
});
test('pre-push runs history verification and refuses its failure',t=>{
 const {cwd,git}=fixture(t);fs.mkdirSync(path.join(cwd,'scripts'));
 fs.copyFileSync(path.join(root,'scripts/check-source-checkout.mjs'),path.join(cwd,'scripts/check-source-checkout.mjs'));
 fs.writeFileSync(path.join(cwd,'scripts/check-publication.mjs'),"export function readAllowlist(){return new Set(['README.md','public-files.json']);}\nif(process.argv.includes('--history'))process.exit(17);");
 const oid=git('rev-parse','HEAD'),hook=path.join(root,'.githooks/pre-push');
 const r=spawnSync('sh',[hook],{cwd,input:`refs/heads/workkeel/x ${oid} refs/heads/workkeel/x ${'0'.repeat(40)}\n`,encoding:'utf8'});
 assert.equal(r.status,17);
 fs.mkdirSync(path.join(cwd,'.ai-org'));
 const privateState=spawnSync('sh',[hook],{cwd,input:`refs/heads/workkeel/x ${oid} refs/heads/workkeel/x ${'0'.repeat(40)}\n`,encoding:'utf8'});
 assert.equal(privateState.status,1);assert.match(privateState.stdout,/private-state-in-public-checkout/);
 const removed=spawnSync('sh',[hook],{cwd,input:`(delete) ${'0'.repeat(40)} refs/heads/workkeel/old ${oid}\n`,encoding:'utf8'});
 assert.equal(removed.status,0);
});
test('pre-push refuses every ref except workkeel/* branches before any check runs',t=>{
 const {cwd,git}=fixture(t);fs.mkdirSync(path.join(cwd,'scripts'));
 for(const file of ['check-source-checkout.mjs','check-publication.mjs'])fs.writeFileSync(path.join(cwd,'scripts',file),"process.exit(0);");
 const oid=git('rev-parse','HEAD'),zero='0'.repeat(40),hook=path.join(root,'.githooks/pre-push');
 const push=line=>spawnSync('sh',[hook],{cwd,input:line+'\n',encoding:'utf8'});
 for(const ref of ['refs/heads/main','refs/heads/workkeel','refs/heads/workkeel/','refs/heads/feature/workkeel/x','refs/tags/v1.0.0','refs/heads/codex/x']){
  const refused=push(`refs/heads/workkeel/x ${oid} ${ref} ${zero}`);
  assert.equal(refused.status,1,ref);assert.match(refused.stderr,/only workkeel\/\* branches/);
 }
 const deleted=push(`(delete) ${zero} refs/heads/main ${oid}`);
 assert.equal(deleted.status,1,'deleting main is refused too');
 const mixed=push(`refs/heads/workkeel/x ${oid} refs/heads/workkeel/x ${zero}\nrefs/heads/main ${oid} refs/heads/main ${zero}`);
 assert.equal(mixed.status,1,'one forbidden ref refuses the whole push');
 const allowed=push(`refs/heads/workkeel/x ${oid} refs/heads/workkeel/x ${zero}`);
 assert.equal(allowed.status,0,allowed.stderr);
});
