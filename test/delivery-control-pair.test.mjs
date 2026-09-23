import test from "node:test";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile as execCallback, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { digest, fixture, preparePair, createProtocol, inspectReadiness, inspectProvider, validateApproval, validateProtocol, runPair, eventViolation, evaluateProduct, stageRequests, subprocessEnvironment, deliveryProcessContract, safeFailureCode, sourceDigest, deliveryTempRoot, retainedArtifactDigest } from "../scripts/delivery-control-pair.mjs";
import {createJsonRpcProcess} from "../src/codex-app-server-provider.mjs";
import {representativeAppServerArguments} from "../scripts/run-representative-microservice-comparison.mjs";
const sandboxReportPath=process.env.TEMPLE_DELIVERY_SANDBOX_REPORT;
// Installed-wire integration is optional on hosts such as the npm Release runner.
// An explicit real-sandbox request must still fail on missing tools, never skip.
const installedSandboxTools = existsSync("/bin/zsh") && spawnSync("codex", ["--version"], {
  env: subprocessEnvironment(), encoding: "utf8", timeout: 5000
}).status === 0;
const execFile = promisify(execCallback);
const sourceRoot = path.resolve(import.meta.dirname, "..");
const cleanProduct = `export function quoteOrder(lines, options = {}) {
  const integer = (v, positive = false) => Number.isSafeInteger(v) && v >= (positive ? 1 : 0);
  if (!Array.isArray(lines) || options === null || typeof options !== 'object' || ![Object.prototype,null].includes(Object.getPrototypeOf(options))) throw new TypeError('shape');
  for (const key of ['shippingCents','freeShippingAtCents']) if (key in options && !integer(options[key])) throw new TypeError('option');
  const shipping = 'shippingCents' in options ? options.shippingCents : 500;
  const threshold = 'freeShippingAtCents' in options ? options.freeShippingAtCents : 3000;
  let subtotalCents = 0;
  for (const row of lines) {
    if (!row || typeof row !== 'object' || !integer(row.unitCents) || !integer(row.quantity,true)) throw new TypeError('row');
    const product = row.unitCents * row.quantity;
    if (!Number.isSafeInteger(product) || !Number.isSafeInteger(subtotalCents + product)) throw new RangeError('overflow');
    subtotalCents += product;
  }
  const shippingCents = !lines.length || subtotalCents >= threshold ? 0 : shipping;
  const totalCents = subtotalCents + shippingCents;
  if (!Number.isSafeInteger(totalCents)) throw new RangeError('overflow');
  return {subtotalCents,shippingCents,totalCents};
}
`;
const extraTest = "import test from 'node:test'; import assert from 'node:assert/strict'; import {quoteOrder} from '../order.mjs'; test('zero threshold',()=>assert.equal(quoteOrder([{unitCents:0,quantity:1}],{freeShippingAtCents:0}).shippingCents,0));\n";
const memoryConfig = { config: { memories: { use_memories: false, generate_memories: false }, features: { memories: false } } };
function approve(protocol) { return { schema_version: "temple.delivery-pair-approval/v2", status: "approved", work_item_id: protocol.work_item_id, protocol_sha256: digest(protocol), approved_by: "synthetic-test-only", approved_at: "2026-01-01T00:00:00Z", evidence_ref: "injected fixture, never live approval", account: "existing-included-allowance-only", maximum_stage_turns: 4, purchase: false, refill: false, reset: false, retries: 0, fallback: false }; }
function usage(threadId, turnId, total = {}) { const value={ inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 120, ...total }; return { method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage: { total:value,last:{...value} } } }; }
function shell(root, command, id = "command-1") { return { type: "commandExecution", id, cwd: root, command, commandActions: [{ type: "unknown", command }], status: "completed", exitCode: 0, aggregatedOutput: "observed process output" }; }
const diagnosticKey=Buffer.alloc(32,7);
const hmac=value=>"hmac-sha256:"+crypto.createHmac("sha256",diagnosticKey).update(String(value)).digest("hex");
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
function assertLedger(stage,ledger) {
  const entries=ledger.filter(e=>e.stageIndex === stage.index);
  const observed=stage.observation.events.filter(e=>["commandExecution","fileChange"].includes(e.item_type)&&["item/started","item/completed"].includes(e.method));
  assert.equal(observed.length,entries.length*2,"every actual actor operation has exactly two observed envelopes");
  for (const [i,entry] of entries.entries()) {
    const [start,end]=observed.slice(i*2,i*2+2);
    assert.deepEqual([start.method,end.method],["item/started","item/completed"]);
    assert.equal(start.item_id,hmac(entry.id)); assert.equal(end.item_id,start.item_id);
    if(entry.command) {
      assert.equal(start.command_digest,hmac(entry.command)); assert.equal(end.command_digest,start.command_digest);
      assert.equal(end.exit_code,entry.exitCode); assert.equal(start.classification.allowed,true);
      assert.equal(start.classification.operation,entry.operation);
    }
  }
}
function replayFactory({ mutate, mode, calls = [], ledger = [], errors=[] } = {}) {
  let stageIndex=0;
  return (_program,_args,options)=>{
    const index=stageIndex++,root=options.cwd,threadId=`thread-${index}`,turnId=`turn-${index}`;
    let stage,closed=false,interrupted=false,sequence=0, sandboxConnection, turnParams;
    const sandboxExecute=async command=>{
      if(!sandboxConnection){
        sandboxConnection=createJsonRpcProcess("codex",representativeAppServerArguments,{cwd:root,env:options.env});
        await sandboxConnection.request("initialize",{clientInfo:{name:"delivery-sandbox-prerequisites",version:"1"},capabilities:{experimentalApi:false}});
        sandboxConnection.notify("initialized",{});
      }
      return sandboxConnection.request("command/exec",{command,cwd:root,sandboxPolicy:turnParams.sandboxPolicy,timeoutMs:30000,outputBytesCap:1024*1024});
    };
    const emit=(method,item,extra={})=>options.onNotification({method,params:{threadId,turnId,...(method==="item/started"?{startedAtMs:Date.now()}:method==="item/completed"?{completedAtMs:Date.now()}:{}),...(item?{item}:{}),...extra}});
    const active=()=>{ if(closed||interrupted) throw Error("synthetic-actor-stopped"); };
    const execute=async (program,args,operation,glob=false)=>{
      active();
      const inner=typeof glob === "string"?glob:glob?"node --test test/*.test.mjs":[program,...args].map(quote).join(" ");
      const command="/bin/zsh -lc "+quote(inner),id=`op-${sequence++}`;
      const item={...shell(root,command,id),status:"inProgress",exitCode:null,aggregatedOutput:""};
      emit("item/started",item); active();
      let result,exitCode=0;
      try {
        if(sandboxReportPath){result=await sandboxExecute(["/bin/zsh","-lc",inner]);exitCode=result.exitCode;}
        else result=await execFile("/bin/zsh",["-lc",inner],{cwd:root,env:options.env,timeout:30000,maxBuffer:1024*1024});
      }
      catch(error) { result=error; exitCode=Number.isInteger(error.code)?error.code:-1; }
      ledger.push({stageIndex:index,id,command,operation,exitCode});
      emit("item/completed",{...item,status:exitCode?"failed":"completed",exitCode,aggregatedOutput:(result.stdout??"")+(result.stderr??"")});
      active();
      if(exitCode && operation!=="product-tests-all") throw Error("synthetic-command-failed:"+operation+":"+(result.stderr??"")+(result.stdout??""));
      return {output:result.stdout??"",exitCode};
    };
    const read=async name=>(await execute("cat",[name],"cat")).output;
    const g=async args=>(await execute("git",args,{"rev-parse":"git-rev-parse",branch:"git-current-branch",status:"git-status",add:"git-add",commit:"git-commit",show:"git-show"}[args[0]])).output.trim();
    const c=async (args,operation)=>execute("node",["./templew.mjs",...args],operation);
    const patch=async(name,body)=>{
      active(); const id=`op-${sequence++}`,item={type:"fileChange",id,status:"inProgress",changes:[{path:path.join(root,name),kind:{type:"update",move_path:null},diff:"+synthetic fixture write"}]};
      emit("item/started",item); active();
      if(sandboxReportPath){
        const result=await sandboxExecute([process.execPath,"-e","require('fs').writeFileSync(process.argv[1],process.argv[2])",path.join(root,name),body]);
        assert.equal(result.exitCode,0,result.stderr);
      } else await fs.writeFile(path.join(root,name),body);
      ledger.push({stageIndex:index,id,path:name}); emit("item/completed",{...item,status:"completed"}); active();
    };
    const act=async params=>{
      try {
        turnParams=params;
        if(mode==="timeout") return;
        if(mode==="approval") { options.onRequest({method:"item/commandExecution/requestApproval",params:{}},{respond(){}}); return; }
        if(mode==="reroute") { emit("model/rerouted"); return; }
        if(mode==="private-error") { options.onProtocolError(Error("SECRET-SENTINEL-ERROR")); return; }
        if(mode==="private-command") { emit("item/started",shell(root,"curl SECRET-SENTINEL-COMMAND","SECRET-SENTINEL-ID")); return; }
        if(mode==="revision-diagnostic") {
          const command = shell(root,"git rev-parse --verify SECRET-SENTINEL-REF","SECRET-SENTINEL-ID");
          emit("item/started", { ...command, status: "inProgress" });
          emit("item/completed", { ...command, status: "completed", exitCode: 0 });
          return;
        }
        if(mode==="wrong-usage") { options.onNotification(usage("wrong-thread",turnId)); return; }
        if(mode==="partial-usage") { options.onNotification(usage(threadId,turnId)); options.onProtocolError(Error("later failure")); return; }
        if(mode==="regressed-component") { options.onNotification(usage(threadId,turnId)); options.onNotification(usage(threadId,turnId,{inputTokens:90,outputTokens:40,totalTokens:130})); options.onProtocolError(Error("later failure")); return; }
        if(mode==="unmatched") { emit("item/started",{...shell(root,"pwd"),status:"inProgress"}); emit("turn/completed",null,{turn:{id:turnId,status:"completed"}}); return; }
        if(mode==="duplicate-start") { const item={...shell(root,"pwd"),status:"inProgress"}; emit("item/started",item); emit("item/started",item); return; }
        if(mode==="duplicate-completion") { const item=shell(root,"pwd"); emit("item/started",{...item,status:"inProgress"}); emit("item/completed",item); emit("item/completed",item); return; }
        if(mode==="completion-without-start") { emit("item/completed",shell(root,"pwd")); return; }
        const temple=params.input[0].text.includes("First read AGENTS.md");
        await execute("pwd",[],"pwd"); await g(["status","--short"]); await g(["branch","--show-current"]);
        if(temple) {
          await read("AGENTS.md"); await read("TEMPLE.md"); await read(".agents/skills/temple-work/SKILL.md");
          await c(["--help"],"temple-help");
          await c(["context","enter",".","--work-item","WI-0001","--position",stage==="build"?"developer":"quality_evaluator","--agent-id",stage==="build"?"agent-builder":"agent-verifier","--principal-id","human","--no-write","--json"],"temple-context-enter");
          await read(".ai-org/project/usage-policy.json");
        } else { await read("README.md"); await read("WORK.md"); }
        await read("BRIEF.md");
        await execute("cat",[],"cat","cat test/*.test.mjs");
        const base=await g(["rev-parse","HEAD"]);
        if(temple) await c(["work-item","claim",".","--work-item","WI-0001","--agent-id",stage==="build"?"agent-builder":"agent-verifier","--principal-id","human","--base-revision",base,"--branch","main"],"temple-claim");
        let revision;
        if(stage==="build") {
          await read("order.mjs"); await read("test/public.test.mjs");
          await patch("order.mjs",mode==="broken"&&index===0?cleanProduct.replace("subtotalCents >= threshold","subtotalCents > threshold"):cleanProduct);
          await patch("test/added.test.mjs",extraTest);
          await g(["add","order.mjs","test/added.test.mjs"]); await g(["commit","-m","Deliver feature"]); revision=await g(["rev-parse","HEAD"]);
        } else {
          revision=JSON.parse(await read("DELIVERY.json")).candidate_revision;
          await read("HANDOFF.md"); await read("order.mjs"); await read("test/added.test.mjs");
          assert.equal(await g(["rev-parse",`${revision}^{commit}`]),revision);
        }
        const {exitCode}=await execute("node",[],"product-tests-all",true);
        const record={candidate_revision:revision,test_command:"node --test test/*.test.mjs",test_exit_code:exitCode,decision:stage==="build"?"delivered":exitCode===0?"accept":"reject",summary:"Synthetic fixture execution",unresolved:[]};
        // Explicit out-of-band fault injection, never part of the positive actor ledger.
        if(mutate) await mutate({root,stage,record,index});
        await patch(stage==="build"?"DELIVERY.json":"VERIFICATION.json",JSON.stringify(record));
        if(stage==="build") {
          await patch("HANDOFF.md",`# Handoff\n\nCandidate ${record.candidate_revision}. Tests exited ${record.test_exit_code}. Fresh verifier must independently inspect and test.\n`);
          if(temple) {
            await read(".agents/skills/temple-work/references/lean-delivery.md");
            const claimId=JSON.parse(await read(".ai-org/work-items/WI-0001.json")).claim.id;
            await c(["work-item","finish",".","--position","developer","--work-item","WI-0001","--operation-id","finish-build-v8","--claim-id",claimId,"--agent-id","agent-builder","--principal-id","human","--revision",revision,"--completed","Feature and tests delivered","--evidence","DELIVERY.json","--json"],"temple-finish");
          }
        } else if(temple) {
          if(record.decision==="accept") {
            const claimId=JSON.parse(await read(".ai-org/work-items/WI-0001.json")).claim.id;
            await c(["work-item","finish",".","--work-item","WI-0001","--position","quality_evaluator","--operation-id","finish-verify-v8","--claim-id",claimId,"--agent-id","agent-verifier","--principal-id","human","--revision",revision,"--judgment","pass","--test-evidence","VERIFICATION.json","--lean-closeout","VERIFICATION.json","--json"],"temple-finish");
          } else await c(["work-item","release",".","--work-item","WI-0001","--agent-id","agent-verifier","--principal-id","human","--reason",record.decision],"temple-release");
        }
        if(mode!=="missing-usage") options.onNotification(usage(threadId,turnId,mode==="bad-usage"?{cachedInputTokens:101}:mode==="cap"?{inputTokens:3000,totalTokens:3020}:{}));
        const completionRecord={...record,summary:"A concise paraphrase describing the same completed fixture work"};
        if(mode==="completion-disagreement") completionRecord.test_exit_code=9;
        emit("item/completed",{type:"agentMessage",id:"answer",text:JSON.stringify(completionRecord)});
        emit("turn/completed",null,{turn:{id:turnId,status:"completed"}});
      } catch(error) { errors.push(error.message); if(!closed&&!interrupted) options.onProtocolError(error); }
    };
    return {notify(){},async close(){closed=true;await sandboxConnection?.close();},async request(method,params){
      calls.push({method,params,root});
      if(method==="initialize") return {};
      if(method==="config/read") return mode==="memory"?{config:{}}:memoryConfig;
      if(method==="model/list") return {data:[{model:"gpt-5.6-terra",supportedReasoningEfforts:[{reasoningEffort:"medium"}]}]};
      if(method==="thread/start") {
        stage=params.serviceName.endsWith("build")?"build":"verify";
        return {thread:{id:threadId},model:mode==="route"?"gpt-5.6-sol":mode==="missing-model"?undefined:params.model,reasoningEffort:mode==="effort"?"high":params.config.model_reasoning_effort};
      }
      if(method==="turn/interrupt") { interrupted=true; if(mode==="interrupt-failure") throw Error("SECRET-SENTINEL-INTERRUPT"); emit("turn/completed",null,{turn:{id:turnId,status:"interrupted"}}); return {}; }
      assert.equal(method,"turn/start");
      if(mode==="pending-start") return new Promise(()=>{});
      if(mode==="early-usage") options.onNotification(usage(threadId,turnId));
      if(mode==="early-wrong-usage") options.onNotification(usage(threadId,"wrong-turn"));
      if(mode==="interrupt-failure") { setImmediate(()=>options.onProtocolError(Error("provider failure"))); }
      else setImmediate(()=>act(params));
      return {turn:{id:turnId,status:"inProgress"}};
    }};
  };
}

test("delivery pair readiness and actual injected lifecycles are generation-free and evidence-bearing", {
  skip: !sandboxReportPath && !installedSandboxTools ? "Optional installed-provider integration requires Codex CLI and zsh; portable contracts still run" : false
}, async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "delivery-test-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const template = path.join(parent, "template"); const manifest = await preparePair({ labRoot: template, sourceRoot });
  const readinessCalls=[];
  const contract = await inspectProvider({ sourceRoot, providerFactory: replayFactory({calls:readinessCalls}) });
  assert.equal(readinessCalls.some(c=>["thread/start","turn/start"].includes(c.method)),false);
  const protocol = createProtocol(manifest, { provider_contract_sha256: digest(contract), readiness_review:{status:"passed",test_only:true}, limits: { stages: 4, per_stage_ms: 30000, aggregate_ms: 120000, per_stage_operational_tokens: 1000, aggregate_operational_tokens: 4000 } });
  const approval = approve(protocol);
  assert.equal(validateApproval(approval, protocol), true);
  assert.equal((await inspectReadiness({ labRoot: template, protocol, providerContract: contract })).model_generation_performed, false);
  let number = 0;
  let completeRun;
  // Reuse only pristine setup, keyed by the exact arm order. Every scenario gets
  // its own writable copy, including Git metadata; actor commands still run.
  const initialPairs = new Map([[JSON.stringify(manifest.order), { root: template, manifest }]]);
  async function copyInitialPair(labRoot, order = manifest.order) {
    const key = JSON.stringify(order);
    let initial = initialPairs.get(key);
    if (!initial) {
      const root = path.join(parent, `template-${initialPairs.size}`);
      initial = { root, manifest: await preparePair({ labRoot: root, sourceRoot, order }) };
      initialPairs.set(key, initial);
    }
    await fs.cp(initial.root, labRoot, { recursive: true });
    return initial.manifest;
  }
  async function run(options = {}, changeProtocol) {
    const labRoot = path.join(parent, `run-${number++}`);
    const initial = await copyInitialPair(labRoot, options.order);
    const baseProtocol = { ...protocol, manifest_sha256: digest(initial), order: initial.order };
    const p = changeProtocol ? changeProtocol(structuredClone(baseProtocol)) : baseProtocol;
    const calls = [],ledger=[],errors=[]; const result = await runPair({ labRoot, protocol: p, approval: approve(p), providerContract: contract, diagnosticKey, deadline: options.deadline, providerFactory: replayFactory({ ...options, calls,ledger,errors }) });
    return { result, labRoot, calls,ledger,errors };
  }
  await t.test("both complete arms, fresh stages, preserved fixtures, exact candidates, independent actual checks", async () => {
    const { result, labRoot, calls,ledger,errors } = await run();
    completeRun={result,labRoot,calls,ledger,errors};
    assert.equal(result.status, "completed", JSON.stringify({stop:result.stop_reason,errors,stages:result.stages.map(s=>({stage:s.stage,arm:s.arm,status:s.status,reason:s.quality_reason,last:s.events.at(-1)}))})); assert.equal(result.efficiency_comparable, true, JSON.stringify(result.stages));
    assert.equal(result.stages.length, 4); assert.equal(new Set(result.stages.map(s => s.thread_id)).size, 4);
    assert.equal(result.total_usage.operational_tokens, 320); assert.equal(result.total_usage.reasoning_output_tokens, 20);
    assert.equal(result.model_generation_performed, false); assert.equal(result.synthetic_provider_replay, true);
    assert.equal(calls.filter(c => c.method === "turn/start").length, 4);
    for (const s of result.stages) { assert.equal(s.public_tests.exit_code, 0); assert.equal(s.oracle.exit_code, 0); assert.ok(s.command_count >= 10); assert.equal(s.command_started_count,s.command_completed_count); assert.equal(s.unmatched_command_starts,0); assert.equal(s.acknowledged_model,"gpt-5.6-terra"); assert.equal(s.effective_turn_effort, null); assert.match(s.candidate_revision, /^[a-f0-9]{40}$/); }
    result.stages.forEach((observation,index)=>assertLedger({observation,index},ledger));
    assert.throws(()=>assertLedger({observation:result.stages[0],index:0},ledger.slice(1)),/exactly two/);
    assert.equal(result.total_usage_final,null);
    assert.ok(result.stages.every(s=>s.completion_agreement.evidence_matches && !s.completion_agreement.summary_matches),"summary paraphrases do not suppress verification");
    const templeOps=ledger.filter(e=>result.stages[e.stageIndex].arm==="temple").map(e=>e.operation);
    for(const required of ["temple-help","temple-context-enter","temple-claim","temple-finish"]) assert.ok(templeOps.includes(required),required);
    assert.equal(result.stages.filter(s=>s.arm==="temple").every(s=>s.treatment?.pass===true),true);
    const seal = JSON.parse(await fs.readFile(path.join(labRoot, "seal.json"))); assert.equal(seal.run_sha256, digest(result));
    assert.equal(seal.archive_error,null);
    assert.equal(await retainedArtifactDigest(labRoot),seal.artifact_sha256);
    const scratch=deliveryTempRoot(path.join(labRoot,"arm-a"),"verify");
    await fs.mkdir(scratch,{recursive:true});
    await new Promise(resolve=>setTimeout(resolve,25));
    await fs.writeFile(path.join(scratch,"late-runtime-cache"),"late operational write");
    assert.equal(await retainedArtifactDigest(labRoot),seal.artifact_sha256,"late scratch writes cannot mutate retained evidence");
    await assert.rejects(runPair({ labRoot, protocol, approval, providerContract: contract, providerFactory: replayFactory() }));
  });
  if(sandboxReportPath){
    assert.equal(completeRun?.result?.efficiency_comparable,true,"complete real-sandbox lifecycle prerequisite");
    const {result,labRoot,ledger}=completeRun;
    const armRoot=path.join(labRoot,manifest.arms.ordinary.id);
    const c=createJsonRpcProcess("codex",representativeAppServerArguments,{cwd:armRoot,env:subprocessEnvironment()});
    const negatives=[];
    try{
      await c.request("initialize",{clientInfo:{name:"delivery-negative-writes",version:"1"},capabilities:{experimentalApi:false}});c.notify("initialized",{});
      for(const target of [path.join(parent,"outside-sentinel"),path.join(labRoot,manifest.arms.temple.id,"outside-sentinel")]){
        const observed=await c.request("command/exec",{command:[process.execPath,"-e","require('fs').writeFileSync(process.argv[1],'forbidden')",target],cwd:armRoot,sandboxPolicy:stageRequests({root:armRoot,arm:"ordinary",stage:"build",protocol}).turn.sandboxPolicy,timeoutMs:10000,outputBytesCap:2000});
        assert.notEqual(observed.exitCode,0,"outside write denied");assert.equal(await fs.stat(target).then(()=>true,()=>false),false);
        negatives.push({exit_code:observed.exitCode,denied:true});
      }
    } finally{await c.close();}
    await fs.writeFile(sandboxReportPath,JSON.stringify({schema_version:"temple.delivery-sandbox-readiness/v1",status:"passed",model_generation_performed:false,provider_thread_requests:0,provider_turn_requests:0,transport:"installed-provider-command/exec; actual-zsh-envelope; sandboxed-file-writes",source_sha256:await sourceDigest(sourceRoot),process_contract_sha256:digest(deliveryProcessContract()),cli_version:contract.cli_version,completed_stages:4,negative_write_checks:negatives.length,negatives,operation_count:ledger.length,operations:[...new Set(ledger.map(e=>e.operation).filter(Boolean))],stages:result.stages.map(s=>({arm:s.arm,stage:s.stage,quality_passed:s.quality_passed,workflow:s.workflow,command_started_count:s.command_started_count,command_completed_count:s.command_completed_count,oracle_exit_code:s.oracle.exit_code})),synthetic_usage_excluded:true},null,2)+"\n");
    return;
  }
  await t.test("initial pair copies isolate product, lifecycle and Git state in both orders", async () => {
    for (const order of [["ordinary", "temple"], ["temple", "ordinary"]]) {
      const left = path.join(parent, `isolation-${order[0]}-left`);
      const right = path.join(parent, `isolation-${order[0]}-right`);
      const initial = await copyInitialPair(left, order);
      assert.deepEqual(initial.order, order);
      const pristine = initialPairs.get(JSON.stringify(order)).root;
      const paths = [
        path.join(initial.arms.ordinary.id, "order.mjs"),
        path.join(initial.arms.temple.id, ".ai-org/work-items/WI-0001.json"),
        path.join(initial.arms.temple.id, ".git/config")
      ];
      const before = await Promise.all(paths.map(name => fs.readFile(path.join(pristine, name))));
      for (const name of paths) await fs.appendFile(path.join(left, name), "\nchanged only in one copy\n");
      await copyInitialPair(right, order);
      for (const [index, name] of paths.entries()) {
        assert.deepEqual(await fs.readFile(path.join(pristine, name)), before[index]);
        assert.deepEqual(await fs.readFile(path.join(right, name)), before[index]);
        assert.notDeepEqual(await fs.readFile(path.join(left, name)), before[index]);
      }
    }
    assert.equal(initialPairs.size, 2, "one pristine setup per exact order");
  });
  await t.test("broken actual product is a measured arm failure; other arm may run once", async () => {
    const { result } = await run({ mode: "broken" });
    assert.equal(result.status, "completed", result.stop_reason); assert.equal(result.efficiency_comparable, false); assert.equal(result.stages[0].status, "quality-failed"); assert.equal(result.stages.length, 3);
  });
  await t.test("expired caller deadline stops before starting a subject provider", async () => {
    const {result,calls}=await run({deadline:Date.now()-1000});
    assert.equal(result.status,"stopped");
    assert.equal(result.stop_reason,"aggregate-wall-clock-limit");
    assert.equal(result.stages.length,0);
    assert.equal(calls.length,0);
  });
  await t.test("substantive completion evidence mismatch still prevents acceptance",async()=>{
    const {result}=await run({mode:"completion-disagreement"});
    assert.equal(result.efficiency_comparable,false);
    assert.ok(result.stages.every(s=>s.status==="quality-failed" && s.quality_reason==="completion-file-disagreement"));
  });
  for (const [name, mutate] of [
    ["fabricated revision", async ({ record }) => { record.candidate_revision = "a".repeat(40); }],
    ["fabricated process result", async ({ record }) => { record.test_exit_code = 9; }],
    ["candidate content must match exact Git commit", async ({ root }) => { await fs.appendFile(path.join(root, "order.mjs"), "// uncommitted product\n"); }]
  ]) await t.test(name, async () => { const { result } = await run({ mutate }); assert.equal(result.efficiency_comparable, false); assert.ok(["quality-failed","stopped"].includes(result.stages[0].status)); });
  for (const [name, mutate] of [
    ["public tests cannot be replaced", async ({ root }) => { await fs.writeFile(path.join(root, "test/public.test.mjs"), "// removed\n"); }],
    ["fresh verifier cannot edit product", async ({ root, stage }) => { if (stage === "verify") await fs.appendFile(path.join(root, "order.mjs"), "// verifier edit\n"); }]
  ]) await t.test(name, async () => {
    for (const order of [["ordinary","temple"],["temple","ordinary"]]) {
      const { result, errors } = await run({ mutate, order });
      assert.equal(result.status, "stopped");
      assert.equal(result.efficiency_comparable, false);
      if (name === "fresh verifier cannot edit product" && order[0] === "temple") {
        assert.equal(result.stop_reason, "provider-protocol");
        assert.ok(errors.some(e => e.includes("synthetic-command-failed:temple-finish:") && e.includes("uncommitted changes")), JSON.stringify(errors));
        const rejected = result.stages.at(-1);
        assert.equal(rejected.stage, "verify");
        assert.equal(rejected.status, "stopped");
        assert.ok(!rejected.events.some(e => e.finish_current_passed === true));
        assert.notEqual(rejected.quality_passed, true);
      } else assert.match(result.stop_reason, /write-scope|public-file-changed|verifier-product/);
    }
  });
  async function assertStoppedPair({ result, labRoot, calls }, mode) {
    assert.equal(result.status, "stopped", mode); assert.equal(result.stages.length, 1); assert.equal(result.efficiency_comparable, false);
    assert.ok(result.stop_reason); assert.equal(JSON.parse(await fs.readFile(path.join(labRoot, "run.json"))).status, "stopped"); await fs.access(path.join(labRoot, "seal.json"));
    if (mode === "missing-usage") { assert.equal(result.total_usage, null); assert.equal(result.usage_complete, false); assert.equal(result.known_usage_subtotal.operational_tokens, 0); }
    if (["route","missing-model","effort", "memory"].includes(mode)) assert.equal(calls.some(c => c.method === "turn/start"), false);
  }
  for (const mode of ["missing-usage", "bad-usage", "missing-model", "effort", "memory", "approval", "reroute", "cap", "timeout", "pending-start","private-error","wrong-usage","unmatched","duplicate-start","duplicate-completion","completion-without-start"]) await t.test(`${mode} stops pair and retains output`, async () => {
    await assertStoppedPair(await run({ mode }, ["timeout", "pending-start"].includes(mode) ? p => { p.limits.per_stage_ms = 30; return p; } : undefined), mode);
  });
  await t.test("real observer retains first revision rejection across trailing completion without private operands", async () => {
    const { result, labRoot } = await run({ mode: "revision-diagnostic" });
    assert.equal(result.stop_reason, "revision-boundary");
    const observation = result.stages[0];
    assert.equal(observation.first_stop.reason, "revision-boundary");
    const first = observation.events[observation.first_stop.event_index];
    assert.equal(first.method, "item/started");
    assert.equal(first.classification.argument_index, 3);
    assert.equal(first.classification.revision_category, "named-ref");
    assert.equal(observation.first_stop.item_id, first.item_id);
    assert.ok(observation.events.some(e => e.method === "item/completed" && e.exit_code === 0));
    assert.ok(!(await fs.readFile(path.join(labRoot, "run.json"), "utf8")).includes("SECRET-SENTINEL"));
  });
  await t.test("turn notifications before acknowledgement are correlated before usage",async()=>{
    const {result}=await run({mode:"early-usage"}); assert.equal(result.status,"completed",result.stop_reason);
    assert.equal(result.total_usage.operational_tokens,320);
  });
  await t.test("partial usage and rejected private envelopes remain diagnostic without raw content",async()=>{
    const partial=await run({mode:"partial-usage"});
    await assertStoppedPair(partial,"partial-usage");
    assert.equal(partial.result.stages[0].usage.operational_tokens,80); assert.equal(partial.result.total_usage,null);
    assert.equal(partial.result.stages[0].interrupt_requested,true); assert.equal(partial.result.stages[0].interrupt_acknowledged,true);
    assert.equal(partial.result.stages[0].terminal_status,"interrupted"); assert.equal(partial.result.stop_reason,"provider-protocol");
    const regressed=await run({mode:"regressed-component"}); assert.equal(regressed.result.stop_reason,"usage-regressed"); assert.equal(regressed.result.stages[0].usage.input_tokens,100);
    const wrong=await run({mode:"early-wrong-usage"}); await assertStoppedPair(wrong,"early-wrong-usage"); assert.equal(wrong.result.stages[0].usage,null);
    const privateRun=await run({mode:"private-command"});
    await assertStoppedPair(privateRun,"private-command");
    const retained=await fs.readFile(path.join(privateRun.labRoot,"run.json"),"utf8");
    assert.equal(retained.includes("SECRET-SENTINEL"),false); assert.equal(retained.includes(diagnosticKey.toString("hex")),false);
    assert.equal(privateRun.result.stages[0].events.find(e=>e.classification)?.classification.allowed,false);
    assert.equal(privateRun.result.stages[0].command_started_count,1); assert.equal(privateRun.result.stages[0].command_completed_count,0); assert.equal(privateRun.result.stages[0].unmatched_command_starts,1);
    const rejected=await run({mode:"route"}); await assertStoppedPair(rejected,"route"); assert.equal(rejected.result.stages[0].acknowledged_model,"gpt-5.6-sol"); assert.equal(rejected.result.stages[0].model_acknowledgement,"mismatched");
    const noAck=await run({mode:"interrupt-failure"}); await assertStoppedPair(noAck,"interrupt-failure"); assert.equal(noAck.result.stages[0].interrupt_requested,true); assert.equal(noAck.result.stages[0].interrupt_acknowledged,false);
    assert.equal(safeFailureCode(Error("SECRET-SENTINEL-ERROR")),"observation-invalid");
  });
  await t.test("invalid approval and source, fixture or provider drift never invoke provider", async () => {
    let calls = 0; const providerFactory = () => { calls++; throw Error("must not start"); };
    for (const bad of [{ ...approval, status: "pending" }, { ...approval, protocol_sha256: digest("wrong") }, { ...approval, purchase: true }]) await assert.rejects(runPair({ labRoot: template, protocol, approval: bad, providerContract: contract, providerFactory }), /approval/);
    for(const review of [null,{status:"passed",test_only:true}]) {
      const pending={...protocol,readiness_review:review};
      await assert.rejects(runPair({labRoot:template,protocol:pending,approval:approve(pending),providerContract:contract}),/readiness-review-required/);
    }
    const p = { ...protocol, source_sha256: digest("other") }; await assert.rejects(runPair({ labRoot: template, protocol: p, approval: approve(p), providerContract: contract, providerFactory }), /source-drift/);
    await assert.rejects(runPair({ labRoot: template, protocol, approval, providerContract: { ...contract, cli_version: "wrong" }, providerFactory }), /provider-contract/);
    await fs.appendFile(path.join(template, manifest.arms.ordinary.id, "order.mjs"), "// drift");
    await assert.rejects(runPair({ labRoot: template, protocol, approval, providerContract: contract, providerFactory }), /fixture-drift/); assert.equal(calls, 0);
  });
});

test("unknown metadata becomes fixed categories",()=>{
  for(const secret of ["SECRET-SENTINEL-ERROR","runtime-request:SECRET-SENTINEL-METHOD","provider-exit:SECRET-SENTINEL-PATH"]) assert.equal(safeFailureCode(Error(secret)),"observation-invalid");
});

test("authentic command and file-change envelopes enforce scoped boundaries", () => {
  const root = canonicalTemporaryRoot(), context = { root, arm: "ordinary", stage: "build", threadId: "t", turnId: "u" };
  const event = item => ({ method: "item/started", params: { threadId: "t", turnId: "u", item } });
  assert.equal(eventViolation(event(shell(root, "/bin/zsh -lc 'node --test test/*.test.mjs'")), context), null);
  assert.ok(eventViolation(event(shell("/unrelated-provider-wrapper-cwd", "git status --short")), context));
  for (const cmd of ["cat ../secret", "cat /etc/passwd", "node -e 'fetch(1)'", "git config core.hooksPath x", "curl https://example.com", "cat ~/.codex/memories/MEMORY.md", "node --test /tmp/oracle.mjs", "git status; curl x"]) assert.ok(eventViolation(event(shell(root, cmd)), context), cmd);
  const file = p => ({ type: "fileChange", id: "f", changes: [{ path: p, kind: { type: "update", move_path: null }, diff: "+change" }] });
  assert.equal(eventViolation(event(file(path.join(root, "order.mjs"))), context), null);
  assert.equal(eventViolation(event(file(path.join(root, "order.mjs"))), { ...context, stage: "verify" }), "file-write-scope");
  assert.equal(eventViolation(event(file("../escape")), context), "file-path-escape");
  assert.equal(eventViolation(event({ type: "mcpToolCall", id: "m" }), context), "forbidden-item");
  assert.equal(eventViolation(event(file(path.join(root, ".ai-org/work-items/WI-0001.json"))), { ...context, arm: "temple" }), "file-write-scope");
  assert.equal(eventViolation(event(shell(root, "node ./templew.mjs collaboration sponsor . --principal-id human --agent-id agent-builder")), { ...context, arm: "temple" }), "unsupported-command");
  assert.equal(eventViolation(usage("wrong", "u"), context), "wrong-thread-event");
  assert.equal(eventViolation(usage("t", "wrong"), context), "wrong-turn-event");
});
function canonicalTemporaryRoot() { return os.tmpdir(); }

test("oracle tests actual clean and broken modules outside the actor repository", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "delivery-product-")); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "order.mjs"), cleanProduct); assert.equal((await evaluateProduct(root)).exit_code, 0);
  await fs.writeFile(path.join(root, "order.mjs"), fixture["order.mjs"]); assert.notEqual((await evaluateProduct(root)).exit_code, 0);
  assert.deepEqual(await fs.readdir(root), ["order.mjs"]);
});

test("all actor prompts distinguish evidence writes from test-invalidating changes", () => {
  const protocol = createProtocol({ order: ["ordinary", "temple"] });
  for (const arm of ["ordinary", "temple"]) for (const stage of ["build", "verify"]) {
    const request = stageRequests({ root: os.tmpdir(), arm, stage, protocol });
    for (const text of [request.turn.input[0].text, request.thread.developerInstructions]) {
      assert.doesNotMatch(text, /after (?:your last|the final) edit/i);
      assert.match(text, /implementation, tests, relevant configuration, dependencies or test inputs/);
      assert.match(text, /evidence.only|Writing only delivery/i);
      assert.match(text, /candidate binding/);
      assert.match(text, /evidence validation/);
      assert.match(text, /uncertain/i);
    }
    assert.match(request.instruction, /Run the complete product tests yourself/);
    assert.match(request.instruction, /Verifier must not substitute the Builder's result/);
    assert.match(request.instruction, /Exact test_command: node --test test\/\*\.test\.mjs/);
    if (stage === "verify") assert.match(request.instruction, /Do not modify order\.mjs, tests or product documentation/);
    if (arm === "temple") assert.match(request.instruction, /do not report acceptance on a diagnostic failure/);
  }
  const contract = deliveryProcessContract();
  assert.equal(contract.version, "delivery-process/v9");
  assert.equal(contract.templates.length, 4);
  const changed = structuredClone(contract);
  changed.templates[0].developer += " changed";
  assert.notEqual(digest(contract), digest(changed));
});

test("guardrails and requests contain no oracle answers or inherited test context", () => {
  const protocol = createProtocol({ order: ["ordinary", "temple"] }); assert.throws(() => validateProtocol(protocol));
  assert.equal(subprocessEnvironment({ NODE_TEST_CONTEXT: "child-v8", NODE_OPTIONS: "--bad" }).NODE_TEST_CONTEXT, undefined);
  assert.equal(deliveryProcessContract().model_and_effort_are_parameters,true);
  const requests = stageRequests({ root: os.tmpdir(), arm: "ordinary", stage: "verify", protocol });
  assert.equal(requests.thread.ephemeral, true); assert.equal(requests.thread.allowProviderModelFallback, false);
  assert.equal(requests.turn.effort, "medium"); assert.equal(requests.turn.sandboxPolicy.networkAccess, false);
  assert.equal(requests.turn.sandboxPolicy.excludeSlashTmp, true); assert.equal(JSON.stringify(requests).includes(cleanProduct), false);
  assert.equal(requests.instruction.includes("held-out contract passed"), false);
});
