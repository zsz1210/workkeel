#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {prepareClassifiedDispatch} from '../src/workkeel-dispatch-classifier.mjs';

// Explicit trusted local module and machine config; no discovery, installation,
// model launch, account lookup, or modification of the original personal tool.
const [target,requestPath,classifierModule,configPath,...extra]=process.argv.slice(2);
async function json(file,max){
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const before=await handle.stat();if(!before.isFile()||before.size>max)throw Error('Bounded JSON input required');
    const buffer=Buffer.alloc(before.size+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0),after=await handle.stat();
    if(bytesRead!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('Input changed');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytesRead)));
  }finally{await handle.close();}
}
try{
  if(extra.length||![target,requestPath,classifierModule,configPath].every(v=>typeof v==='string'&&path.isAbsolute(v)))throw Error('Use four explicit absolute paths');
  const request=await json(requestPath,65536),config=await json(configPath,16384);
  const stat=await fs.lstat(classifierModule);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Trusted regular classifier module required');
  const {preview}=await import(pathToFileURL(classifierModule));
  if(typeof preview!=='function')throw Error('Classifier must export preview');
  const ticket=await prepareClassifiedDispatch(target,request,(prompt,{profile})=>preview(prompt,{profile,config}));
  console.log(JSON.stringify(ticket,null,2));
}catch(error){console.error(JSON.stringify({error:'dispatch-preparation-failed',message:error.message}));process.exitCode=1;}
