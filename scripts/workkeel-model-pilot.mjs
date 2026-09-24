// Manual, explicit opt-in development experiment; never imported by the runtime.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { initializeTaskProject } from "../src/workkeel-project.mjs";
import { createNativeTask, mutateNativeTask } from "../src/workkeel-tasks.mjs";
import { createLocalCodexSubscriptionRuntime, QUALIFIED_CODEX_VERSION } from "../src/workkeel-codex-host.mjs";
import { executeWorkflow } from "../src/workkeel-workflows.mjs";
import { readTaskMeasurements } from "../src/workkeel-measurements.mjs";
import { durableAtomicCreate, formatJson, sha256 } from "../src/files.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
export const limits = Object.freeze({ steps: 12, elapsed_ms: 1200000, step_ms: 90000, quota_floor: 40 });
export const cases = [
  { id: "intervals", prompt: "Fix export mergeIntervals(intervals) in src/solution.mjs. Input is an array of [start,end] finite-number pairs with start <= end. Return new sorted disjoint closed intervals, merging overlaps and touching endpoints, but not integer-adjacent gaps. Do not mutate input or nested arrays. Empty input returns []. Throw TypeError for a non-array input, malformed pair, nonfinite/non-number endpoint, or reversed pair. No dependencies or I/O.",
    starter: "export function mergeIntervals(intervals) { return intervals.sort((a,b)=>a[0]-b[0]); }\n",
    checks: [
      ["empty", "mergeIntervals([])", []], ["unsorted overlaps", "mergeIntervals([[5,8],[1,3],[2,6]])", [[1,8]]],
      ["touching", "mergeIntervals([[2,4],[0,2],[9,9]])", [[0,4],[9,9]]], ["gaps", "mergeIntervals([[3,4],[1,2]])", [[1,2],[3,4]]],
      ["containment", "mergeIntervals([[1,10],[2,3],[1,10]])", [[1,10]]], ["negative fractional", "mergeIntervals([[-1.5,0],[0,0.25],[-5,-3]])", [[-5,-3],[-1.5,0.25]]],
      ["immutable", "(()=>{const a=Object.freeze([Object.freeze([3,4]),Object.freeze([1,3])]);return mergeIntervals(a)})()", [[1,4]]],
      ...["null", "[[1]]", "[[2,1]]", "[[0,Infinity]]", "[['1',2]]", "[[1,2,3]]"].map((v,i)=>[`invalid ${i}`, `mergeIntervals(${v})`, "TypeError", true]) ] },
  { id: "ready", prompt: "Implement export readyTasks(tasks, state, limit) in src/solution.mjs. Valid inputs only: tasks have unique string id and dependencies arrays; state has completed/running/failed ID arrays; limit is a nonnegative integer. Return IDs in original task order whose dependencies ALL exist in tasks AND are in completed, excluding IDs in completed, running or failed. A dependency missing from tasks blocks its dependent even if that ID is in completed. Cycles remain not ready unless their dependencies are already completed. Dependencies are not implicitly completed by selecting a task in this call. Limit caps returned count. Do not mutate anything. No dependencies or I/O.",
    starter: "export function readyTasks(tasks,state,limit) { return tasks.slice(0,limit).map(t=>t.id); }\n",
    checks: [
      ["empty", "readyTasks([], {completed:[],running:[],failed:[]},5)", []],
      ["zero", "readyTasks([{id:'a',dependencies:[]}],{completed:[],running:[],failed:[]},0)", []],
      ["blocked first", "readyTasks([{id:'b',dependencies:['a']},{id:'a',dependencies:[]},{id:'c',dependencies:[]}],{completed:[],running:[],failed:[]},1)", ["a"]],
      ["no cascading", "readyTasks([{id:'a',dependencies:[]},{id:'b',dependencies:['a']}],{completed:[],running:[],failed:[]},9)", ["a"]],
      ["all dependencies", "readyTasks([{id:'a',dependencies:[]},{id:'b',dependencies:[]},{id:'c',dependencies:['a','b']},{id:'d',dependencies:['a']}],{completed:['a'],running:['b'],failed:[]},9)", ["d"]],
      ["exclude states", "readyTasks(['a','b','c','d'].map(id=>({id,dependencies:[]})),{completed:['a'],running:['b'],failed:['c']},9)", ["d"]],
      ["missing and cycle", "readyTasks([{id:'a',dependencies:['b']},{id:'b',dependencies:['a']},{id:'c',dependencies:['missing']}],{completed:[],running:[],failed:[]},9)", []],
      ["stable", "readyTasks([{id:'done',dependencies:[]},{id:'z',dependencies:['done']},{id:'a',dependencies:['done']}],{completed:['done'],running:[],failed:[]},9)", ["z","a"]],
      ["completed but absent", "readyTasks([{id:'a',dependencies:['missing']}],{completed:['missing'],running:[],failed:[]},9)", []],
      ["immutable", "(()=>{const t=Object.freeze([Object.freeze({id:'a',dependencies:Object.freeze([])})]); const s=Object.freeze({completed:Object.freeze([]),running:Object.freeze([]),failed:Object.freeze([])});return readyTasks(t,s,2)})()", ["a"]] ] },
  { id: "usage", prompt: "Fix export summarizeUsage(records) in src/solution.mjs. For each field input_tokens and output_tokens separately return {total,known_subtotal,observed,complete}. Accept only nonnegative safe integers as observed values; missing, null, negative, strings, fractions, Infinity and NaN are unknown. observed counts valid values. complete is true only if every record has a valid value for that field AND their sum is a safe integer. total is that sum when complete, otherwise null. known_subtotal is sum of valid values if at least one is known and sum is safe; otherwise null. Empty records means each field {total:0,known_subtotal:0,observed:0,complete:true}. Input is an array of non-null objects. Do not mutate input. Never turn unknown into zero. No dependencies or I/O.",
    starter: "export function summarizeUsage(records) { return {input_tokens:records.reduce((s,r)=>s+(r.input_tokens||0),0),output_tokens:records.reduce((s,r)=>s+(r.output_tokens||0),0)}; }\n",
    checks: [] }
];
const metric = (total,known_subtotal,observed,complete) => ({total,known_subtotal,observed,complete});
cases[2].checks = [
  ["empty", "summarizeUsage([])", {input_tokens:metric(0,0,0,true),output_tokens:metric(0,0,0,true)}],
  ["known", "summarizeUsage([{input_tokens:2,output_tokens:3},{input_tokens:5,output_tokens:0}])", {input_tokens:metric(7,7,2,true),output_tokens:metric(3,3,2,true)}],
  ["partial", "summarizeUsage([{input_tokens:5,output_tokens:null},{input_tokens:null,output_tokens:0}])", {input_tokens:metric(null,5,1,false),output_tokens:metric(null,0,1,false)}],
  ["unknown", "summarizeUsage([{}, {input_tokens:null,output_tokens:NaN}])", {input_tokens:metric(null,null,0,false),output_tokens:metric(null,null,0,false)}],
  ["invalid", "summarizeUsage([{input_tokens:-1,output_tokens:0.5},{input_tokens:'5',output_tokens:Infinity}])", {input_tokens:metric(null,null,0,false),output_tokens:metric(null,null,0,false)}],
  ["overflow", "summarizeUsage([{input_tokens:Number.MAX_SAFE_INTEGER,output_tokens:1},{input_tokens:1,output_tokens:2}])", {input_tokens:metric(null,null,2,false),output_tokens:metric(3,3,2,true)}],
  ["immutable", "summarizeUsage(Object.freeze([Object.freeze({input_tokens:0,output_tokens:0})]))", {input_tokens:metric(0,0,1,true),output_tokens:metric(0,0,1,true)}]
];
const order = ["luna", "sol", "sol", "luna", "luna", "sol"];
const actor = { agent_id: "builder", principal_id: "owner" };
const json = async file => JSON.parse(await fs.readFile(file,"utf8"));
const create = (file,data) => durableAtomicCreate(file,formatJson(data));
const git = (root,...args) => execFileSync("git",["-C",root,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const sourceFiles = ["scripts/workkeel-model-pilot.mjs","src/workkeel-codex-host.mjs","src/workkeel-codex-runtime.mjs","src/workkeel-workflows.mjs","src/workkeel-measurements.mjs","src/workkeel-execution-policy.mjs","src/workkeel-checkpoints.mjs"];
async function hashes() { return Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,sha256(await fs.readFile(path.join(repo,name)))]))); }

export function assertBudget({ steps, startedAt, now, remaining, quotaFloor = limits.quota_floor }) {
  if (!Number.isInteger(steps) || steps < 0 || steps >= limits.steps) throw new Error("Step budget exhausted");
  if (!Number.isFinite(now) || !Number.isFinite(startedAt) || now < startedAt || now-startedAt >= limits.elapsed_ms) throw new Error("Time budget exhausted");
  if (!Number.isFinite(quotaFloor) || quotaFloor < 30 || quotaFloor >= 100 || !Number.isFinite(remaining) || remaining <= quotaFloor || remaining > 100) throw new Error("Quota brake reached or unavailable");
}

// No imports or host objects are exposed to the module. A separate process has
// a hard timeout as well as VM timeouts. This is an evaluator for these approved
// synthetic fixtures, not a general-purpose adversarial-code security service.
export function evaluate(source,scenario) {
  const evaluator = `import vm from 'node:vm'; import {isDeepStrictEqual} from 'node:util';
    const c=vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false}});
    const m=new vm.SourceTextModule(${JSON.stringify(source)},{context:c});
    await m.link(()=>{throw Error('Imports are not permitted')});await m.evaluate({timeout:500});
    for(const name of Object.getOwnPropertyNames(m.namespace)) c[name]=m.namespace[name];
    const checks=${JSON.stringify(scenario.checks)}; const results=[];
    for(const [name,expression,expected,throws] of checks){let value,error=null;try{value=vm.runInContext('JSON.stringify('+expression+')',c,{timeout:500})}catch(e){error=e.name}
      let pass=throws?error===expected:false; if(!throws&&error===null){try{pass=isDeepStrictEqual(JSON.parse(value),expected)}catch{}}
      results.push({name,pass,error});}
    process.stdout.write(JSON.stringify(results));`;
  try {
    const rows=JSON.parse(execFileSync(process.execPath,["--experimental-vm-modules","--input-type=module","-e",evaluator],{timeout:5000,encoding:"utf8",env:{},maxBuffer:65536,stdio:["ignore","pipe","pipe"]}));
    return { pass:rows.every(row=>row.pass), passed:rows.filter(row=>row.pass).length,total:rows.length, failed:rows.filter(row=>!row.pass).map(row=>row.name) };
  } catch { return {pass:false,passed:0,total:scenario.checks.length,failed:["Module load or evaluation failure"]}; }
}

async function approvalHash(reference) {
  if (typeof reference !== "string" || !/^\.ai-org\/artifacts\/WI-\d{4,}\/work-order\.md$/.test(reference)) throw new Error("Explicit repository work-order approval is required");
  const file=path.join(repo,reference);
  const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error("Approval must be a regular work-order file");
  return sha256(await fs.readFile(file));
}

export async function prepare(directory, {approvalRef, quotaRemaining} = {}) {
  const approvalSha256=await approvalHash(approvalRef);
  const quotaFloor=Math.max(30,quotaRemaining-3);
  assertBudget({steps:0,startedAt:0,now:0,remaining:quotaRemaining,quotaFloor});
  await fs.mkdir(directory); // Must be a fresh, explicitly named directory.
  const plan={schema_version:"workkeel.model-pilot/v2",at:new Date().toISOString(),limits:{...limits,quota_floor:quotaFloor},models:["gpt-6-luna","gpt-6-sol"],effort:"medium",order,
    code_sha256:await hashes(),cases:cases.map(({id,prompt,starter,checks})=>({id,prompt_sha256:sha256(prompt),starter_sha256:sha256(starter),checks_sha256:sha256(JSON.stringify(checks)),checks:checks.length})),
    approval_ref:approvalRef,approval_sha256:approvalSha256,codex:QUALIFIED_CODEX_VERSION,
    extra_paid_spend:0,subscription_dollars:null,quota_start_remaining:quotaRemaining,limitations:["Three cases per model are diagnostic only","Account quota is shared; tokens are not credits","No independently observed backend model","No human answer edits between attempts"]};
  await create(path.join(directory,"plan.json"),plan);
  return plan;
}

async function fixture(scenario,model,attempt,input,priorSource,plan) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"workkeel-paired-")));
  git(root,"init","-q");git(root,"config","user.name","Workkeel synthetic pilot");git(root,"config","user.email","pilot@example.invalid");
  await initializeTaskProject(root,{schema_version:"workkeel.task-policy/v1",principals:["owner"],agents:[actor],approvers:["owner"],review_separation:"distinct-agent"});
  await fs.mkdir(path.join(root,"src"));await fs.mkdir(path.join(root,"docs"));
  await fs.writeFile(path.join(root,"src/solution.mjs"),priorSource??scenario.starter);
  await fs.writeFile(path.join(root,"docs/approval.md"),`Maintainer approved synthetic paired-model pilot: ${plan.approval_ref}, SHA-256 ${plan.approval_sha256}. Only src may be modified; no network, publishing, credentials or external actions. One bounded step in this fixture.`);
  const policy={schema_version:"workkeel.execution-policy/v1",models:[{id:model,connection:{kind:"codex-subscription",model:`gpt-6-${model}`,effort:"medium"},data_classes:["public"]}],default_model:model,rules:[],limits:{steps:1,attempts_per_node:1,parallelism:1,timeout_ms:limits.step_ms,max_cost_usd:null},headroom:{mode:"off"}};
  const definition={schema_version:"workkeel.workflow/v1",nodes:[{id:"solve",kind:"runtime",write_paths:["src"],input:input+" Use tools to edit src/solution.mjs. Only src may be written. Do not read outside this fixture, use network or install anything. The restricted tool environment does not provide Node.js; the coordinator runs the independent tests outside it after submission. Submit the implementation without trying to install or find an external runtime, and state that you did not run tests. Finish with a concise summary."}],edges:[{from:"start",to:"solve"},{from:"solve",to:"end"}]};
  await fs.writeFile(path.join(root,"docs/policy.json"),formatJson(policy));await fs.writeFile(path.join(root,"docs/workflow.json"),formatJson(definition));
  const contract={schema_version:"workkeel.task-contract/v1",id:"WK-pilot",goal:scenario.prompt,state:"intake",actor,scope:{include:["Implement this synthetic function"],exclude:["External actions","Other projects"]},dependencies:[],acceptance:{criteria:[scenario.prompt],evidence:[]},handoff:null,
    verification:{risk_tier:"standard",separation:"distinct-agent",implementer:null,reviewer:null,candidate_revision:null},environment:{cwd:".",read_paths:["."],write_paths:["src"],tools:["codex"],resources:[],network:{mode:"none",hosts:[]},external_actions:[],data:{classification:"public",model_access:"approved-connection",policy_refs:["docs/approval.md","docs/policy.json","docs/workflow.json"]}},
    authorization:{approved_by:"owner",approval_ref:"docs/approval.md",operations:["read","write","execute"],expires_at:new Date(Date.now()+limits.step_ms+30000).toISOString()},skills:[],execution:{runtime:{kind:"adapter",adapter_id:"codex-app-server",required_features:["filesystem-sandbox","network-disabled","fixed-model"]},model_connection:{kind:"policy",policy_ref:"docs/policy.json"}},legacy:null};
  git(root,"add",".");git(root,"commit","-qm",`Synthetic ${scenario.id} attempt ${attempt}`);
  await createNativeTask(root,contract,{operation_id:"create",expected_version:0,actor});
  const claim=await mutateNativeTask(root,contract.id,"claim",{operation_id:"claim",expected_version:1,actor,base_revision:git(root,"rev-parse","HEAD")});
  return {root,claim};
}

export async function runPair(directory,pair,remaining) {
  if (!Number.isInteger(pair)||pair<0||pair>=cases.length) throw new Error("Pair must be 0, 1 or 2");
  const plan=await json(path.join(directory,"plan.json"));
  if(plan.schema_version!=="workkeel.model-pilot/v2" || plan.approval_sha256!==await approvalHash(plan.approval_ref)) throw new Error("Pilot approval changed or requires a fresh plan");
  const quotaFloor=Math.max(30,plan.quota_start_remaining-3);
  if(JSON.stringify(plan.limits)!==JSON.stringify({...limits,quota_floor:quotaFloor}))throw new Error("Pilot limits changed");
  assertBudget({steps:0,startedAt:0,now:0,remaining:plan.quota_start_remaining,quotaFloor});
  if (JSON.stringify(plan.code_sha256)!==JSON.stringify(await hashes())) throw new Error("Pinned pilot source changed");
  const lock=await fs.open(path.join(directory,"running.lock"),"wx");
  try {
    const names=await fs.readdir(directory);
    if (names.some(name=>name.endsWith(".intent.json")&&!names.includes(name.replace(".intent.json",".result.json")))) throw new Error("Unfinished attempt; inspect, do not replay");
    if (names.includes(`pair-${pair}.json`)) throw new Error("Pair already completed; replay prohibited");
    if (pair>0&&!names.includes(`pair-${pair-1}.json`)) throw new Error("Pairs must run in order");
    for(const name of names.filter(n=>n.endsWith(".result.json"))) if ((await json(path.join(directory,name))).infrastructure_failure) throw new Error("Prior infrastructure failure stops the pilot");
    let start;
    try { start=await json(path.join(directory,"started.json")); }
    catch(error) { if(error.code!=="ENOENT")throw error;start={at:Date.now()}; await create(path.join(directory,"started.json"),start); }
    let steps=names.filter(n=>n.endsWith(".intent.json")).length;
    const results=[];const scenario=cases[pair];
    for (const model of order.slice(pair*2,pair*2+2)) {
      let prior=null;
      for(let attempt=0;attempt<2;attempt++) {
        assertBudget({steps,startedAt:start.at,now:Date.now(),remaining,quotaFloor});
        const input=scenario.prompt+(prior?`\nThe prior solution failed independent checks: ${prior.checks.failed.join(", ")}. Correct those cases without changing the contract.`:"");
        const f=await fixture(scenario,model,attempt,input,prior?.source,plan);
        assertBudget({steps,startedAt:start.at,now:Date.now(),remaining,quotaFloor});
        const id=`pair-${pair}-${model}-${attempt}`;
        await create(path.join(directory,`${id}.intent.json`),{at:new Date().toISOString(),fixture:f.root,model,attempt,remaining,source_sha256:sha256(prior?.source??scenario.starter)});steps++;
        const started=performance.now();const result={id,case:scenario.id,model:`gpt-6-${model}`,effort:"medium",attempt,fixture:f.root,infrastructure_failure:null,checks:null,measurements:null,cost_usd:null};
        try {
          const runtime=await createLocalCodexSubscriptionRuntime(f.root);
          const timeout=Math.min(limits.step_ms,limits.elapsed_ms-(Date.now()-start.at));
          const run=await executeWorkflow(f.root,{run_id:"pilot",task_id:"WK-pilot",actor,claim_id:f.claim.claim.id,policy_ref:"docs/policy.json",workflow_ref:"docs/workflow.json"},{adapters:[runtime],signal:AbortSignal.timeout(Math.max(1,timeout))});
          if(run.status.state!=="completed") throw new Error("Pilot workflow did not complete");
          const source=await fs.readFile(path.join(f.root,"src/solution.mjs"),"utf8");
          result.checks=evaluate(source,scenario);result.source=source;result.source_sha256=sha256(source);
        } catch(error) { result.infrastructure_failure=error.message.startsWith("Codex")||error.message.startsWith("Local subscription")?error.message:error.name; }
        result.elapsed_ms=performance.now()-started;
        try{ result.measurements=await readTaskMeasurements(f.root,"WK-pilot"); }catch{ result.measurement_failure="Measurement unavailable; preserve fixture for diagnosis"; }
        await create(path.join(directory,`${id}.result.json`),result);results.push(result);console.log(JSON.stringify({id,checks:result.checks,infrastructure_failure:result.infrastructure_failure,usage:result.measurements?.usage,timing:result.measurements?.timing}));
        if(result.infrastructure_failure) throw new Error("Infrastructure failure: pilot stopped without retry");
        if(result.checks.pass)break;prior=result;
      }
    }
    await create(path.join(directory,`pair-${pair}.json`),{pair,results:results.map(r=>r.id),at:new Date().toISOString(),steps,elapsed_ms:Date.now()-start.at,quota_remaining_before_pair:remaining});
    return results;
  } finally { await lock.close();await fs.unlink(path.join(directory,"running.lock")); }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [command,directory,flag,pair,remaining]=process.argv.slice(2);
  if(command==="prepare"&&directory&&flag==="--approval") console.log(JSON.stringify(await prepare(path.resolve(directory),{approvalRef:pair,quotaRemaining:Number(remaining)})));
  else if(command==="run-pair"&&directory&&flag==="--use-subscription") await runPair(path.resolve(directory),Number(pair),remaining===undefined?NaN:Number(remaining));
  else throw new Error("Usage: prepare FRESH_DIRECTORY --approval REPOSITORY_WORK_ORDER WEEKLY_REMAINING_PERCENT | run-pair DIRECTORY --use-subscription PAIR WEEKLY_REMAINING_PERCENT; obtain fresh account quota before preparation and every pair");
}
