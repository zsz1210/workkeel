#!/usr/bin/env node
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {bindHostUsage, collectHostUsage, reportHostUsage, reportHostActivity, closeHostUsage} from '../src/workkeel-host-usage.mjs';

// Explicit target and binding only. This helper never discovers host sessions.
const [command,target,value,...extra]=process.argv.slice(2);
async function request(file) {
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const stat=await handle.stat();if(!stat.isFile()||stat.size>64*1024)throw Error('Invalid bounded request file');
    const content=Buffer.alloc(stat.size+1),{bytesRead}=await handle.read(content,0,content.length,0);
    if(bytesRead!==stat.size)throw Error('Request changed during read');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content.subarray(0,bytesRead)));
  } finally {await handle.close();}
}
try {
  if(!target||!value||extra.length||!['bind','once','collect','watch','report','activity','close'].includes(command))throw Error('Usage: collect-workkeel-host-usage.mjs bind|report|activity|close TARGET REQUEST.json; once|watch TARGET BINDING_ID');
  if(command==='bind')console.log(JSON.stringify(await bindHostUsage(target,await request(value))));
  else if(command==='report')console.log(JSON.stringify(await reportHostUsage(target,await request(value))));
  else if(command==='activity')console.log(JSON.stringify(await reportHostActivity(target,await request(value))));
  else if(command==='close')console.log(JSON.stringify(await closeHostUsage(target,await request(value))));
  else {
    let stopped=false;process.once('SIGINT',()=>{stopped=true;});process.once('SIGTERM',()=>{stopped=true;});
    do {
      const result=await collectHostUsage(target,value);console.log(JSON.stringify(result));
      if(command!=='watch'||result.collection_status!=='running')break;
      await new Promise(resolve=>setTimeout(resolve,5000));
    }while(!stopped);
  }
}catch(error) {
  console.error(JSON.stringify({error:typeof error?.code==='string'&&/^host-[a-z-]+$/.test(error.code)?error.code:'host-usage-command-failed'}));
  process.exitCode=1;
}
