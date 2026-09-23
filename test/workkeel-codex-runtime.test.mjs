import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexRuntime, createCodexProcessHost, codexPermissionsForContract } from "../src/workkeel-codex-runtime.mjs";

async function context(t) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-codex-"));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  await fs.mkdir(path.join(target, "src"));
  await fs.writeFile(path.join(target, "approval.md"), "Synthetic offline approval");
  return { target, operation_id: "run:node", run_id: "run", conversation_id: null,
    contract: { execution: { runtime: { adapter_id: "codex-app-server", required_features: [] } },
      authorization: { approval_ref: "approval.md", expires_at: null, operations: ["read", "write", "execute"] },
      environment: { cwd: ".", read_paths: ["src"], write_paths: ["src"], tools: ["shell"], external_actions: [], data: { model_access: "approved-connection" } } },
    policy: { headroom: { mode: "off" }, limits: { timeout_ms: 3000, max_cost_usd: null } },
    selection: { connection: { kind: "gateway", provider: "litellm", base_url: "http://localhost:4000/v1", model: "fixture-fixed", selection: "fixed", credential_env: "FIXTURE_KEY" } },
    input: { instruction: "Offline protocol fixture", previous_results: {} } };
}
function fixtureHost({ reroute = false, earlyReroute = false, approval = false, neverComplete = false, account = "chatgpt", available = true, permissionMismatch = false, effortMismatch = false, earlyApproval = false, dirtyTerminals = false, wrongCwd = false, attention = false, delayedStart = false, hideStarted = false, onStart = () => {}, onTurn = () => {}, onStarted = () => {}, onInterrupt = () => {} } = {}) {
  const source = `import readline from 'node:readline';
    const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
    const reply = (id,result) => send({id,result});
    readline.createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line);
      if(m.method==='initialize') { ${earlyApproval ? "send({id:81,method:'item/commandExecution/requestApproval',params:{}});" : ""} ${earlyReroute ? "send({method:'model/rerouted',params:{toModel:'unapproved'}});" : ""} reply(m.id,{userAgent:'offline-fixture'}); }
      if(m.method==='account/read') reply(m.id,{account:{type:${JSON.stringify(account)}}});
      if(m.method==='model/list') reply(m.id,{data:${available ? "[{model:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]" : "[]"}});
      if(m.method==='thread/start'||m.method==='thread/resume') {
        send({method:'fixture/started',params:{}});
        if(m.method==='thread/start'&&m.params.allowProviderModelFallback!==false) process.exit(4);
        if(m.params.config.web_search!=='disabled'||m.params.approvalPolicy!=='never') process.exit(2);
        const profile=m.params.config.permissions[m.params.permissions];
        if(profile.filesystem[':root']!=='deny'||profile.network.enabled!==false) process.exit(3);
        reply(m.id,{thread:{id:'thread-one',turns:[]},cwd:${wrongCwd ? "'/wrong'" : "m.params.cwd"},approvalPolicy:'never',instructionSources:[],runtimeWorkspaceRoots:[m.params.cwd],model:m.params.model,modelProvider:m.params.modelProvider,reasoningEffort:${effortMismatch ? "'high'" : "m.params.config.model_reasoning_effort"},activePermissionProfile:{id:${permissionMismatch ? "'different-profile'" : "m.params.permissions"}}});
      }
      if(m.method==='thread/backgroundTerminals/clean') reply(m.id,{});
      if(m.method==='thread/backgroundTerminals/list') reply(m.id,{data:${dirtyTerminals ? "[{id:'still-running'}]" : "[]"},nextCursor:null});
      if(m.method==='turn/start') {
        if(!m.params.permissions.startsWith('workkeel-')||m.params.sandboxPolicy) process.exit(3);
        if(m.params.outputSchema?.additionalProperties!==false) process.exit(5);
        send({method:'fixture/turn',params:m.params});
        ${hideStarted ? "" : "send({method:'turn/started',params:{threadId:'thread-one',turn:{id:'turn-one',status:'inProgress'}}});"}
        ${delayedStart ? "setTimeout(()=>reply(m.id,{turn:{id:'turn-one',status:'inProgress'}}),1000);" : "reply(m.id,{turn:{id:'turn-one',status:'inProgress'}});"}
        ${approval ? "send({id:80,method:'item/commandExecution/requestApproval',params:{}});" : ""}
        ${reroute ? "send({method:'model/rerouted',params:{threadId:'thread-one',turnId:'turn-one',toModel:'unapproved'}});" : ""}
        ${neverComplete || approval ? "" : `send({method:'item/completed',params:{threadId:'thread-one',turnId:'turn-one',item:{type:'agentMessage',phase:'commentary',text:'Interim text is not the node result'}}});
        send({method:'item/completed',params:{threadId:'thread-one',turnId:'turn-one',item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify({outcome:${JSON.stringify(attention ? "attention" : "done")},output:'Offline fixture complete'})}}});
        send({method:'thread/tokenUsage/updated',params:{threadId:'thread-one',turnId:'turn-one',tokenUsage:{last:{inputTokens:2,outputTokens:1},total:{inputTokens:10,outputTokens:4}}}});
        send({method:'turn/completed',params:{threadId:'thread-one',turn:{id:'turn-one',status:'completed'}}});`}
      }
      if(m.method==='turn/interrupt') { send({method:'fixture/interrupt',params:{}}); reply(m.id,{}); }
    });`;
  const host = createCodexProcessHost({ command: process.execPath, args: ["--input-type=module", "-e", source, "--"],
    env: { PATH: process.env.PATH }, assertCompatible: async () => {} });
  const connect = host.connect;
  host.connect = options => connect({ ...options, onNotification: message => {
    if (message.method === "fixture/started") onStart();
    else if (message.method === "fixture/turn") onTurn(message.params);
    else if (message.method === "fixture/interrupt") onInterrupt();
    else { options.onNotification(message); if (message.method === "turn/started") onStarted(); }
  } });
  return host;
}

test("Codex start/resume uses a real local JSON-RPC process, pinned model and restricted sandbox", async t => {
  const c = await context(t); const runtime = createCodexRuntime(fixtureHost());
  const first = await runtime.start(c);
  assert.equal(first.output, "Offline fixture complete"); assert.equal(first.status, "completed");
  assert.equal(first.observed_model, null); assert.deepEqual(first.usage, { input_tokens: 10, output_tokens: 4, cost_usd: null });
  const resumed = await runtime.resume({ ...c, conversation_id: first.conversation_id });
  assert.equal(resumed.conversation_id, first.conversation_id);
  assert.deepEqual(resumed.usage, { input_tokens: null, output_tokens: null, cost_usd: null });
  const profile = await codexPermissionsForContract(c.target, c.contract);
  assert.equal(profile.filesystem[await fs.realpath(path.join(c.target, "src"))], "write");
  assert.equal(profile.filesystem[`${await fs.realpath(c.target)}/.ai-org/execution`], "deny");
  c.contract.environment.write_paths = ["."];
  c.contract.authorization = { approval_ref: "approval.md" };
  await fs.writeFile(path.join(c.target, "approval.md"), "Synthetic approval");
  const rootWrites = await codexPermissionsForContract(c.target, c.contract);
  for (const name of ["workkeel.lock", "workkeelw.mjs", "TEMPLE.md", "temple.lock", "templew.mjs", "approval.md"]) {
    assert.equal(rootWrites.filesystem[path.join(await fs.realpath(c.target), name)], "read", name);
  }
});
test("unqualified hosts and unsupported conditions fail before connecting", async t => {
  assert.throws(() => createCodexProcessHost({}), /qualified host/);
  const c = await context(t); let connections = 0;
  const runtime = createCodexRuntime({ assertCompatible: async () => { throw new Error("Unqualified host tools"); }, connect: () => { connections++; } });
  await assert.rejects(runtime.start(c), /Unqualified/);
  c.policy.limits.max_cost_usd = 1; await assert.rejects(runtime.start(c), /financial cap/);
  c.policy.limits.max_cost_usd = null; c.policy.headroom.mode = "lossless";
  await assert.rejects(runtime.start(c), /cannot be intercepted/); assert.equal(connections, 0);
});
test("rerouting and runtime approval requests never silently expand the workflow", async t => {
  const c = await context(t);
  await assert.rejects(createCodexRuntime(fixtureHost({ reroute: true })).start(c), /pinned model/);
  await assert.rejects(createCodexRuntime(fixtureHost({ approval: true })).start(c), /operator attention/);
});
test("abort terminates the owned local process and reports uncertain interruption", async t => {
  const c = await context(t); const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 200);
  try { await assert.rejects(createCodexRuntime(fixtureHost({ neverComplete: true })).start({ ...c, signal: controller.signal }), /interrupted|exited/); }
  finally { clearTimeout(timer); }
});
test("subscription routing requires existing ChatGPT login and an available explicit model/effort", async t => {
  const c = await context(t);
  c.selection.connection = { kind: "codex-subscription", model: "gpt-6-luna", effort: "low" };
  const result = await createCodexRuntime(fixtureHost()).start(c);
  assert.equal(result.runtime_model, "gpt-6-luna");
  await assert.rejects(createCodexRuntime(fixtureHost({ account: "apiKey" })).start(c), /ChatGPT login/);
  await assert.rejects(createCodexRuntime(fixtureHost({ available: false })).start(c), /unavailable/);
  await assert.rejects(createCodexRuntime(fixtureHost({ effortMismatch: true })).start(c), /differs from the request/);
});

test("usage observations replace cumulative totals, ignore unrelated turns and survive structured-result failure", async t => {
  for (const failResult of [false, true]) {
    const c = await context(t), observations = [];
    c.observe = async value => { observations.push(value); };
    const host = fixtureHost(), connect = host.connect;
    host.connect = options => connect({ ...options, onNotification: message => {
      if (message.method === "thread/tokenUsage/updated") {
        for (const inputTokens of [10, 20, 20]) options.onNotification({ ...message, params: { ...message.params,
          tokenUsage: { last: { inputTokens: 2, outputTokens: 1 }, total: { inputTokens, outputTokens: 8 } } } });
        options.onNotification({ ...message, params: { ...message.params, turnId: "unrelated",
          tokenUsage: { total: { inputTokens: 999, outputTokens: 999 } } } });
        return;
      }
      if (failResult && message.method === "item/completed" && message.params.item.phase === "final_answer") message.params.item.text = "not structured JSON";
      options.onNotification(message);
    } });
    if (failResult) await assert.rejects(createCodexRuntime(host).start(c), /structured/);
    else assert.deepEqual((await createCodexRuntime(host).start(c)).usage, { input_tokens: 20, output_tokens: 8, cost_usd: null });
    assert.equal(observations.at(-1).usage.input_tokens, 20);
    assert.equal(observations.at(-1).usage.cost_usd, null);
    assert.equal(observations.some(value => value.usage.input_tokens === 999), false);
  }
});

test("counter regression and absent resume baseline stay unknown, not underestimated", async t => {
  const c = await context(t), host = fixtureHost(), connect = host.connect;
  host.connect = options => connect({ ...options, onNotification: message => {
    if (message.method === "thread/tokenUsage/updated") {
      for (const inputTokens of [20, 10, 30]) options.onNotification({ ...message, params: { ...message.params,
        tokenUsage: { total: { inputTokens, outputTokens: 8 } } } });
    } else options.onNotification(message);
  } });
  const first = await createCodexRuntime(host).start(c);
  assert.equal(first.usage.input_tokens, null); assert.equal(first.usage.output_tokens, 8);
  const observations = [];
  await createCodexRuntime(fixtureHost()).resume({ ...c, conversation_id: "thread-one", observe: value => { observations.push(value); } });
  assert.equal(observations.at(-1).usage.input_tokens, null);
});
test("a mismatched active permission profile blocks the turn", async t => {
  await assert.rejects(createCodexRuntime(fixtureHost({ permissionMismatch: true })).start(await context(t)), /permissions.*differs/);
});
test("fatal initialization requests stop before opening a thread", async t => {
  let starts = 0;
  await assert.rejects(createCodexRuntime(fixtureHost({ earlyApproval: true, onStart: () => starts++ })).start(await context(t)), /operator attention/);
  await assert.rejects(createCodexRuntime(fixtureHost({ earlyReroute: true, onStart: () => starts++ })).start(await context(t)), /pinned model/);
  assert.equal(starts, 0);
});
test("unexpected workspace settings or uncleared terminals cannot report completion", async t => {
  const c = await context(t);
  await assert.rejects(createCodexRuntime(fixtureHost({ wrongCwd: true })).start(c), /differs from the request/);
  await assert.rejects(createCodexRuntime(fixtureHost({ dirtyTerminals: true })).start(c), /cleanup is unconfirmed/);
});
test("explicit descendants cannot override protected authority or runner-state permissions", async t => {
  const c = await context(t);
  await fs.mkdir(path.join(c.target, ".ai-org/execution/run-one"), { recursive: true });
  c.contract.environment.read_paths = [".", ".ai-org/execution/run-one"];
  await assert.rejects(codexPermissionsForContract(c.target, c.contract), /private workflow/);
  c.contract.environment.read_paths = ["."];
  c.contract.environment.write_paths = [".ai-org/execution/run-one"];
  await assert.rejects(codexPermissionsForContract(c.target, c.contract), /protected task authority/);
});
test("a completed provider turn with an attention result is a failed workflow step", async t => {
  const result = await createCodexRuntime(fixtureHost({ attention: true })).start(await context(t));
  assert.equal(result.status, "failed"); assert.equal(result.outcome, "attention");
});

test("dispatch separates numeric authorization observation from unchanged task and work", async t => {
  const c = await context(t);
  c.contract.authorization.expires_at = new Date(Date.now() + 600000).toISOString();
  const original = structuredClone(c.contract);
  let sent;
  await createCodexRuntime(fixtureHost({ onTurn: params => { sent = JSON.parse(params.input[0].text); } })).start(c);
  assert.deepEqual(sent.task, original); assert.deepEqual(c.contract, original);
  assert.deepEqual(sent.work, c.input);
  const check = sent.execution_context.authorization_check;
  assert.equal(check.expiry_status, "valid_at_dispatch");
  assert.equal(check.expires_at_utc, original.authorization.expires_at);
  assert.ok(Date.parse(check.checked_at_utc) < Date.parse(check.expires_at_utc));
  assert.equal(check.checked_at_utc, sent.execution_context.started_at_utc);
  assert.match(check.scope, /does not grant permissions/);
});

test("invalid or expired authorization blocks both start and resume before connection", async t => {
  for (const authority of [null, { approval_ref: "approval.md" }, { approval_ref: "approval.md", expires_at: "bad" },
    { approval_ref: "approval.md", expires_at: new Date(Date.now() - 1000).toISOString() }]) {
    const c = await context(t); c.contract.authorization = authority;
    let connects = 0;
    const runtime = createCodexRuntime({ assertCompatible: async () => {}, connect: () => { connects++; } });
    await assert.rejects(runtime.start(c), /authorization/);
    await assert.rejects(runtime.resume(c), /authorization/);
    assert.equal(connects, 0);
  }
});

test("authorization expiring during initialization never starts a model turn", async t => {
  const c = await context(t); let turns = 0;
  const host = fixtureHost({ onTurn: () => turns++ });
  c.contract.authorization.expires_at = new Date(Date.now() + 1000).toISOString();
  host.assertConnected = async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(c.contract.authorization.expires_at) - Date.now() + 5)));
  };
  await assert.rejects(createCodexRuntime(host).start(c), /authorization expired/);
  assert.equal(turns, 0);
});
test("cancellation binds early turn notifications and preserves unknown dispatch uncertainty", async t => {
  for (const hideStarted of [false, true]) {
    const c = await context(t), controller = new AbortController(); let enter, interrupts = 0;
    const entered = new Promise(resolve => { enter = resolve; });
    const host = fixtureHost({ delayedStart: true, hideStarted, neverComplete: true,
      ...(hideStarted ? { onTurn: enter } : { onStarted: enter }), onInterrupt: () => interrupts++ });
    const running = createCodexRuntime(host).start({ ...c, signal: controller.signal });
    await entered; controller.abort();
    await assert.rejects(running, error => hideStarted ? error.runtimeUnsettled === true : /interrupted/.test(error.message));
    assert.equal(interrupts, hideStarted ? 0 : 1);
  }
});
