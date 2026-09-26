import path from "node:path";
import { TEMPLATE_VERSION } from "./constants.mjs";
import { readTaskContractInput } from "./task-contract.mjs";
import { initializeTaskProject, previewLegacyMigration, existsEntry } from "./workkeel-project.mjs";
import { createNativeTask, mutateNativeTask, readNativeTask, listTaskItems, diagnoseTaskProject } from "./workkeel-tasks.mjs";
import { planTaskRuntime } from "./workkeel-runtime.mjs";
import { previewInstructions, applyInstructions, readStartGuide } from "./workkeel-onboarding.mjs";

const HELP = `Workkeel — repository-native task coordination for coding agents

workkeel start [target] [--request brief.json]
workkeel init [target] --policy repository-policy.json
workkeel migration preview [target] --policy repository-policy.json [--retain-open retention.json]
workkeel migration apply [target] --policy repository-policy.json --fingerprint sha256 [--retain-open retention.json]
workkeel status|doctor [target]
workkeel task create [target] --source contract.json --request request.json
workkeel task show [target] --id task-id
workkeel task metrics [target] --id task-id
workkeel task summary [target] --id task-id
workkeel task observe [target] --id task-id --request observation.json
workkeel usage bind|report|activity|close [target] --request usage-request.json
workkeel usage collect [target] --id binding-id
workkeel dispatch prepare|plan|bind [target] --request dispatch-request.json
workkeel dispatch show [target] --id execution-id
workkeel intake preview [target] --request brief.json
workkeel intake apply [target] --request brief.json --fingerprint sha256
workkeel task claim|release|handoff|review|rework|close|cancel [target] --id task-id --request request.json
workkeel runtime plan [target] --id task-id
workkeel context prepare [target] --id task-id --request material-request.json
workkeel instructions preview|apply [target] [--fingerprint sha256]
workkeel workflow plan [target] --request workflow-request.json
workkeel workflow run [target] --request workflow-run.json
workkeel workflow continuation-plan|continue [target] --request continuation.json
workkeel workflow show [target] --id run-id
workkeel workflow metrics [target] --id run-id
workkeel workflow cancel|recover-lock [target] --id run-id --request actor.json
workkeel headroom view|read [target] --request tool-view-request.json
workkeel skills audit [target] --request skill-use.json
workkeel learning list [target]
workkeel learning capture|review|use|search|impact [target] --request learning-request.json
workkeel legacy <original Temple arguments>

All task commands return JSON. Lifecycle mutation requests contain operation_id,
expected_version and actor; workflow requests use a stable run_id and active claim.
See docs/getting-started/workkeel.md and docs/operations/workkeel-workflows.md.
Native host execution is the default. Runtime plans do not launch models or grant
permissions. Workflow run explicitly launches the qualified Codex subscription host.
`;
function parse(args) {
  const rest = [...args]; const command = rest.shift() ?? "help";
  const action = ["task", "usage", "dispatch", "intake", "migration", "runtime", "instructions", "workflow", "headroom", "skills", "context", "learning"].includes(command) ? rest.shift() : null;
  const target = rest[0] && !rest[0].startsWith("--") ? rest.shift() : ".";
  const options = {};
  while (rest.length) {
    const key = rest.shift();
    if (key === "--json") continue;
    if (!["--policy", "--source", "--request", "--id", "--fingerprint", "--retain-open"].includes(key) || Object.hasOwn(options, key) || !rest.length || rest[0].startsWith("--")) throw new Error("Unknown, repeated or incomplete Workkeel option");
    options[key] = rest.shift();
  }
  return { command, action, target: path.resolve(target), options };
}
function required(options, key) { if (!options[key]) throw new Error(`Missing ${key}`); return options[key]; }
function allow(options, keys) { if (Object.keys(options).some(k => !keys.includes(k))) throw new Error("Option is not supported by this command"); }

export async function workkeelMain(args) {
  if (!args.length || ["help", "--help", "-h"].includes(args[0])) { console.log(HELP); return 0; }
  if (["version", "--version"].includes(args[0])) { console.log(TEMPLATE_VERSION); return 0; }
  if (args[0] === "legacy") {
    const { main } = await import("./cli.mjs"); return main(args.slice(1));
  }
  const { command, action, target, options } = parse(args);
  let output;
  if (command === "start") {
    allow(options, ["--request"]);
    output = await readStartGuide(target, { requestRef: options["--request"] ?? null });
  } else if (command === "init" || command === "migration") {
    allow(options, command === "init" ? ["--policy"] : action === "preview" ? ["--policy", "--retain-open"] : ["--policy", "--fingerprint", "--retain-open"]);
    const policy = (await readTaskContractInput(target, required(options, "--policy"))).document;
    if (command === "init") output = await initializeTaskProject(target, policy);
    else if (action === "preview") output = await previewLegacyMigration(target, policy, { retentionRef: options["--retain-open"] ?? null });
    else if (action === "apply") output = await initializeTaskProject(target, policy, { migrationFingerprint: required(options, "--fingerprint"), retentionRef: options["--retain-open"] ?? null });
    else throw new Error("Migration requires preview or apply");
  } else if (!await existsEntry(target, "workkeel.lock")) {
    // No migration by inference. Keep the complete original CLI for old projects.
    if (!await existsEntry(target, "temple.lock")) throw new Error("Initialize the project before using task commands");
    const { main } = await import("./cli.mjs"); return main(args);
  } else if (["status", "doctor"].includes(command)) {
    allow(options, []);
    output = command === "doctor" ? await diagnoseTaskProject(target) : {
      schema_version: "workkeel.status/v1", tasks: await listTaskItems(target), authority: "observation-only", mutation_status: "no-write"
    };
  } else if (command === 'learning') {
    const learning=await import('./workkeel-learning.mjs');
    if(action==='list'){allow(options,[]);output=await learning.listNativeLearning(target);}
    else {
      const handler={capture:learning.captureNativeLearning,review:learning.reviewNativeLearning,use:learning.recordNativeLearningUse,search:learning.searchNativeLearning,impact:learning.nativeLearningImpact}[action];
      if(!handler)throw Error('Learning requires capture, review, use, list, search or impact');
      allow(options,['--request']);output=await handler(target,(await readTaskContractInput(target,required(options,'--request'))).document);
    }
  } else if (command === 'intake') {
    allow(options, action==='preview' ? ['--request'] : ['--request','--fingerprint']);
    const {previewTaskIntake,applyTaskIntake}=await import('./workkeel-intake.mjs');
    const brief=(await readTaskContractInput(target,required(options,'--request'))).document;
    if(action==='preview')output=await previewTaskIntake(target,brief);
    else if(action==='apply')output=await applyTaskIntake(target,brief,required(options,'--fingerprint'));
    else throw Error('Intake requires preview or apply');
  } else if (command === 'dispatch') {
    const {prepareDispatchTicket,readDispatchTicket,planDispatch,bindDispatchTicket}=await import('./workkeel-dispatch.mjs');
    if(action==='show'){
      allow(options,['--id']);output=await readDispatchTicket(target,required(options,'--id'));
    }else{
      allow(options,['--request']);const request=(await readTaskContractInput(target,required(options,'--request'))).document;
      if(action==='prepare')output=await prepareDispatchTicket(target,request);
      else if(action==='plan')output=planDispatch(request.policy,request.plan);
      else if(action==='bind')output=await bindDispatchTicket(target,request);
      else throw Error('Dispatch requires prepare, plan, bind or show');
    }
  } else if (command === 'usage') {
    const {bindHostUsage,reportHostUsage,reportHostActivity,collectHostUsage,closeHostUsage}=await import('./workkeel-host-usage.mjs');
    if(action==='collect'){
      allow(options,['--id']);output=await collectHostUsage(target,required(options,'--id'));
    }else{
      const handler={bind:bindHostUsage,report:reportHostUsage,activity:reportHostActivity,close:closeHostUsage}[action];
      if(typeof handler!=='function')throw Error('Usage requires bind, report, activity, collect or close');
      allow(options,['--request']);output=await handler(target,(await readTaskContractInput(target,required(options,'--request'))).document);
    }
  } else if (command === "task") {
    if(action==='summary'||action==='observe'){
      allow(options,action==='summary'?['--id']:['--id','--request']);
      const {readTaskSummary,recordTaskObservation}=await import('./workkeel-task-summary.mjs');
      output=action==='summary'?await readTaskSummary(target,required(options,'--id')):
        await recordTaskObservation(target,required(options,'--id'),(await readTaskContractInput(target,required(options,'--request'))).document);
    } else if (action === "metrics") {
      allow(options, ["--id"]);
      const { readTaskMeasurements } = await import("./workkeel-measurements.mjs");
      output = await readTaskMeasurements(target, required(options, "--id"));
    } else if (action === "show") { allow(options, ["--id"]); output = await readNativeTask(target, required(options, "--id")); }
    else {
      allow(options, action === "create" ? ["--source", "--request"] : ["--id", "--request"]);
      const request = (await readTaskContractInput(target, required(options, "--request"))).document;
      output = action === "create" ? await createNativeTask(target, (await readTaskContractInput(target, required(options, "--source"))).document, request) :
        await mutateNativeTask(target, required(options, "--id"), action, request);
    }
  } else if (command === "context" && action === "prepare") {
    allow(options, ["--id", "--request"]);
    const { prepareTaskMaterial } = await import("./workkeel-material.mjs");
    const item = await readNativeTask(target, required(options, "--id"));
    output = await prepareTaskMaterial(target, item.contract, (await readTaskContractInput(target, required(options, "--request"))).document);
  } else if (command === "runtime" && action === "plan") {
    allow(options, ["--id"]);
    const item = await readNativeTask(target, required(options, "--id"));
    output = planTaskRuntime(item.contract);
  } else if (command === "skills" && action === "audit") {
    allow(options, ["--request"]);
    const { auditSkillUse } = await import("./workkeel-skill-audit.mjs");
    output = await auditSkillUse(target, (await readTaskContractInput(target, required(options, "--request"))).document);
  } else if (command === "instructions") {
    allow(options, action === "preview" ? [] : ["--fingerprint"]);
    if (action === "preview") output = await previewInstructions(target);
    else if (action === "apply") output = await applyInstructions(target, required(options, "--fingerprint"));
    else throw new Error("Instructions requires preview or apply");
  } else if (command === "workflow") {
    const { planWorkflow, readWorkflowRun, cancelWorkflow, recoverWorkflowLock } = await import("./workkeel-workflows.mjs");
    if (action === "metrics") {
      allow(options, ["--id"]);
      const { readWorkflowMeasurements } = await import("./workkeel-measurements.mjs");
      output = await readWorkflowMeasurements(target, required(options, "--id"));
    } else if (action === "show") { allow(options, ["--id"]); output = await readWorkflowRun(target, required(options, "--id")); }
    else {
      allow(options, ["plan", "run", "continuation-plan", "continue"].includes(action) ? ["--request"] : ["--id", "--request"]);
      const request = (await readTaskContractInput(target, required(options, "--request"))).document;
      if (action === "plan") output = await planWorkflow(target, request);
      else if (action === "continuation-plan") {
        const { planContinuation } = await import("./workkeel-continuation.mjs");
        output = await planContinuation(target, request);
      } else if (["run", "continue"].includes(action)) {
        const { executeWorkflow } = await import("./workkeel-workflows.mjs");
        const { continueWorkflow } = await import("./workkeel-continuation.mjs");
        const { createLocalCodexSubscriptionRuntime } = await import("./workkeel-codex-host.mjs");
        const { exactKeys } = await import("./workkeel-execution-policy.mjs");
        exactKeys(request, ["run"], ["approvals", "reconciliations"]);
        const runtime = await createLocalCodexSubscriptionRuntime(target);
        const controller = new AbortController(); const stop = () => controller.abort();
        process.once("SIGINT", stop); process.once("SIGTERM", stop);
        try { output = await (action === "continue" ? continueWorkflow : executeWorkflow)(target, request.run, { adapters: [runtime], approvals: request.approvals,
          reconciliations: request.reconciliations, signal: controller.signal }); }
        finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
      }
      else if (action === "cancel") output = await cancelWorkflow(target, required(options, "--id"), request);
      else if (action === "recover-lock") output = await recoverWorkflowLock(target, required(options, "--id"), request);
      else throw new Error("Workflow requires plan, run, show, metrics, cancel or recover-lock");
    }
  } else if (command === "headroom") {
    allow(options, ["--request"]);
    const request = (await readTaskContractInput(target, required(options, "--request"))).document;
    const { workkeelToolView, workkeelOriginal } = await import("./workkeel-headroom.mjs");
    if (action === "view") output = await workkeelToolView(target, request);
    else if (action === "read") output = await workkeelOriginal(target, request);
    else throw new Error("Headroom requires view or read");
  } else throw new Error("Unsupported task-first command; legacy writers cannot mutate task-first projects");
  console.log(JSON.stringify(output, null, 2));
  return output.valid === false ? 1 : 0;
}
