import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readNativeTask,validateNativeTaskSnapshot} from '../src/workkeel-tasks.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {safeDirectory,existsEntry} from '../src/workkeel-project.mjs';
import {readTaskFile} from '../src/task-contract.mjs';
import {withProjectMutationLock} from '../src/project.mjs';
import {durableAtomicCreate} from '../src/files.mjs';

export async function recoverClaimProof(root,taskId,revision,{apply=false}={}) {
 root=await fs.realpath(root);
 if(!/^WK-[A-Za-z0-9._-]+$/.test(taskId)||!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision))throw Error('Exact task and Git revision required');
 return withProjectMutationLock(root,async()=>{
  const current=await readNativeTask(root,taskId),source_path=`.ai-org/work-items/${taskId}.json`;
  const original=execFileSync('git',['-C',root,'show',`${revision}:${source_path}`],{maxBuffer:256*1024,stdio:['ignore','pipe','pipe']});
  const snapshot=validateNativeTaskSnapshot(JSON.parse(original),taskId),event=snapshot.history.at(-1);
  if(snapshot.state!=='build'||event.action!=='claim'||snapshot.contract_sha256!==current.contract_sha256||executionDigest(snapshot.history)!==executionDigest(current.history.slice(0,snapshot.version)))throw Error('Original claim is not anchored in current task history');
  const ref=`.ai-org/artifacts/${taskId}/dispatch-claim-${event.hash}.json`,sha256=createHash('sha256').update(original).digest('hex');
  const present=await existsEntry(root,ref);
  if(present&&(await readTaskFile(root,ref)).digest!==sha256)throw Error('Existing proof differs; preserve and inspect');
  if(apply&&!present){const dir=await safeDirectory(root,path.posix.dirname(ref),{create:true});await durableAtomicCreate(path.join(dir,path.basename(ref)),original);}
  return {schema_version:'workkeel.claim-recovery/v1',task_id:taskId,source_revision:revision,source_path,destination:ref,sha256,bytes:original.length,status:present?'already-retained':apply?'restored':'validated-preview',source:'original-git-object',canonical_task_changed:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [mode,root,id,revision]=process.argv.slice(2);if(!['plan','apply'].includes(mode))throw Error('Usage: workkeel-history-recover.mjs plan|apply PROJECT TASK_ID REVISION');console.log(JSON.stringify(await recoverClaimProof(root,id,revision,{apply:mode==='apply'}),null,2));}
 catch(error){console.error(JSON.stringify({message:error.message}));process.exitCode=1;}
}
