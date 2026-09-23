import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {cases,evaluate,assertBudget,prepare,runPair,limits} from "../scripts/workkeel-model-pilot.mjs";

const solutions=[
  `export function mergeIntervals(a){if(!Array.isArray(a)||a.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>typeof n!=='number'||!Number.isFinite(n))||p[0]>p[1]))throw new TypeError();const out=[];for(const p of a.map(p=>[...p]).sort((a,b)=>a[0]-b[0])){const last=out.at(-1);if(last&&p[0]<=last[1])last[1]=Math.max(last[1],p[1]);else out.push(p)}return out}`,
  `export function readyTasks(tasks,state,limit){const completed=new Set(state.completed),excluded=new Set([...state.completed,...state.running,...state.failed]);return tasks.filter(t=>!excluded.has(t.id)&&t.dependencies.every(id=>completed.has(id))).slice(0,limit).map(t=>t.id)}`,
  `export function summarizeUsage(records){return Object.fromEntries(['input_tokens','output_tokens'].map(k=>{const values=records.map(r=>r[k]).filter(v=>Number.isSafeInteger(v)&&v>=0),sum=values.reduce((a,b)=>a+b,0),safe=Number.isSafeInteger(sum),complete=safe&&values.length===records.length;return [k,{observed:values.length,complete,total:complete?sum:null,known_subtotal:safe&&(values.length||!records.length)?sum:null}]}))}`
];

test("paired pilot checks accept reference solutions, reject buggy starters and preserve semantic object equality",()=>{
  for(let i=0;i<cases.length;i++){
    assert.equal(evaluate(solutions[i],cases[i]).pass,true,cases[i].id);
    assert.equal(evaluate(cases[i].starter,cases[i]).pass,false,cases[i].id);
  }
});
test("evaluator rejects imports and bounded infinite code",()=>{
  assert.equal(evaluate("import fs from 'node:fs';",cases[0]).pass,false);
  assert.equal(evaluate("while(true){}",cases[0]).pass,false);
  assert.equal(evaluate("process.exit(0)",cases[0]).pass,false);
});
test("pilot has hard step/time and conservative quota brakes, not a token-to-dollar conversion",()=>{
  const base={steps:0,startedAt:1000,now:1000,remaining:45};
  assert.doesNotThrow(()=>assertBudget(base));
  for(const patch of [{steps:12},{steps:-1},{now:1000+limits.elapsed_ms},{now:999},{remaining:40},{remaining:NaN},{remaining:undefined},{remaining:101}]) assert.throws(()=>assertBudget({...base,...patch}));
});
test("pilot plan is exclusive and unknown quota or invalid pair never starts model execution",async()=>{
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),"workkeel-pilot-test-"));const root=path.join(parent,"pilot");
  try{
    const plan=await prepare(root);assert.equal(plan.effort,"medium");assert.equal(plan.subscription_dollars,null);assert.equal(plan.cases.length,3);
    await assert.rejects(prepare(root));await assert.rejects(runPair(root,3,45));
    await assert.rejects(runPair(root,0,NaN),/Quota/);
    assert.equal((await fs.readdir(root)).some(n=>n.endsWith("intent.json")),false);
    await fs.writeFile(path.join(root,"unfinished.intent.json"),"{}");
    await assert.rejects(runPair(root,0,45),/Unfinished/);
  }finally{await fs.rm(parent,{recursive:true,force:true});}
});
