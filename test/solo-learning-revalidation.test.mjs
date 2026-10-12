import test from 'node:test';
import assert from 'node:assert/strict';
import {learningDocuments,createRepositoryRetrievalProvider} from '../src/context.mjs';

for(const [kind,status] of [['lesson','validated'],['practice','active']])test(`${kind} contradicted latest result is not eligible for retrieval`,async()=>{
 const entry={id:kind==='lesson'?'LESSON-0001':'PRACTICE-0001',kind,status,title:'Quantity validation',summary:'Strict quantity inputs',path:`.ai-org/learning/${kind}s/record.md`,tags:['quantity'],revalidation:{last_result:'confirmed'}};
 const search=async value=>createRepositoryRetrievalProvider().search({documents:learningDocuments({entries:[value]}),query:'quantity',limit:5});
 assert.equal((await search(entry)).length,1);
 const contradicted={...entry,revalidation:{last_result:'contradicted',history:[{result:'confirmed'},{result:'contradicted'}]}};
 assert.deepEqual(await search(contradicted),[]);assert.equal(contradicted.status,status);
 assert.equal((await search({...contradicted,revalidation:{last_result:'confirmed'}})).length,1);
 assert.equal((await search({...entry,revalidation:undefined})).length,1);
 assert.deepEqual(await search({...entry,status:'candidate'}),[]);
});
