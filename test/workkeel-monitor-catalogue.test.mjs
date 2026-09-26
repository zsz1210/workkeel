import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createObserverFixture} from '../scripts/workkeel-observer-fixture.mjs';
import {readMonitorLibrary,readCatalogueDocument} from '../src/workkeel-monitor-data.mjs';
test('configured Skill sources are searchable, source-labelled and read only through registered IDs',async t=>{
  const root=await createObserverFixture(),personal=await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-skill-source-'));
  t.after(()=>Promise.all([fs.rm(root,{recursive:true,force:true}),fs.rm(personal,{recursive:true,force:true})]));
  await fs.mkdir(path.join(personal,'my-skill'));await fs.writeFile(path.join(personal,'my-skill/SKILL.md'),'---\nname: personal-check\ndescription: Useful checks\n---\nTrigger: copper sparrow');
  await fs.writeFile(path.join(personal,'private.txt'),'NEVER_SERVE');
  const catalogRoots=[{path:personal,origin:'user',label:'Personal'}],lib=await readMonitorLibrary(root,{catalogRoots,query:'copper sparrow'});
  assert.equal(lib.skills.length,1);const skill=lib.skills[0];assert.equal(skill.origin,'user');assert.equal(skill.availability,'not-added');
  assert.match((await readCatalogueDocument(root,skill.id,{catalogRoots})).content,/copper sparrow/);
  assert.equal(await readCatalogueDocument(root,skill.id),null);
  assert.equal(await readCatalogueDocument(root,'../../private.txt',{catalogRoots}),null);
  for(const marker of ['|','>-']){
    await fs.writeFile(path.join(personal,'my-skill/SKILL.md'),'---\r\nname: personal-check\r\ndescription: '+marker+'\r\n  Check the input.\r\n  Explain the result.\r\nother: hidden metadata\r\n---\r\n# Source');
    const updated=await readMonitorLibrary(root,{catalogRoots});
    assert.equal(updated.skills.find(s=>s.name==='personal-check').description,'Check the input. Explain the result.');
  }
  await fs.unlink(path.join(personal,'my-skill/SKILL.md'));await fs.symlink('../private.txt',path.join(personal,'my-skill/SKILL.md'));
  await assert.rejects(readCatalogueDocument(root,skill.id,{catalogRoots}),/symlink/);
  const partial=await readMonitorLibrary(root,{catalogRoots:[{path:personal+'/missing',origin:'user'}]});assert.ok(partial.errors.some(e=>e.code==='skill-source-unavailable'));assert.ok(partial.skills.some(s=>s.origin==='workkeel'));
});
