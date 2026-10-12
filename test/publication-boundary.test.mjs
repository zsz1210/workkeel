import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkPublication,inspectPublicFile,readAllowlist} from '../scripts/check-publication.mjs';

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
test('private paths and undeclared files fail even if force-staged',t=>{
 const {cwd,git}=fixture(t);fs.mkdirSync(path.join(cwd,'.ai-org'));
 fs.writeFileSync(path.join(cwd,'.ai-org','record.json'),'{}');git('add','-f','.ai-org/record.json');
 assert.ok(checkPublication(cwd,{mode:'staged'}).failures.some(r=>r.rule==='private-path'));
 fs.writeFileSync(path.join(cwd,'unreviewed.txt'),'public-looking but unreviewed');
 assert.ok(checkPublication(cwd).failures.some(r=>r.path==='unreviewed.txt'&&r.rule==='not-allowlisted'));
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
 for(const file of ['../escape','.ai-org/data.json','docs/validation/result.md','x/../README.md']){
  fs.writeFileSync(path.join(cwd,'public-files.json'),JSON.stringify({schema_version:'workkeel.public-files/v1',files:['public-files.json',file]}));
  assert.throws(()=>readAllowlist(cwd),/Invalid or private/);
 }
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
 fs.writeFileSync(path.join(cwd,'scripts/check-publication.mjs'),'process.exit(17)');
 const oid=git('rev-parse','HEAD'),hook=path.join(root,'.githooks/pre-push');
 const r=spawnSync('sh',[hook],{cwd,input:`refs/heads/main ${oid} refs/heads/main ${'0'.repeat(40)}\n`,encoding:'utf8'});
 assert.equal(r.status,17);
 const removed=spawnSync('sh',[hook],{cwd,input:`(delete) ${'0'.repeat(40)} refs/heads/old ${oid}\n`,encoding:'utf8'});
 assert.equal(removed.status,0);
});
