import { createHash } from "node:crypto";
import { TEMPLATE_VERSION } from "./workkeel-version.mjs";
import { readTaskContractInput } from "./task-contract.mjs";
import { initializeTaskProject, existsEntry, readTaskProject, soloPolicy, updateProjectPolicy } from "./workkeel-project.mjs";
import { parseCommandLine, resolveActor, lifecycleRequestFromFlags, draftFromFlags } from "./workkeel-cli-flags.mjs";
import { createNativeTask, mutateNativeTask, readNativeTask, listTaskItems, diagnoseTaskProject } from "./workkeel-tasks.mjs";
import { planTaskRuntime } from "./workkeel-runtime.mjs";
import { previewInstructions, applyInstructions, readStartGuide } from "./workkeel-onboarding.mjs";

const HELP = `Workkeel — repository-native task coordination for coding agents

workkeel start [target]                     read-only next-step guidance
workkeel init [target] --solo               one owner with builder and reviewer Agents
workkeel task new [target] --goal text --acceptance text [--write path]
workkeel task claim|handoff|review|close [target] --id task-id --actor id [--summary text] [--evidence path] [--judgment pass|fail] [--rollback text]
workkeel status|doctor [target]
workkeel monitor [target]
workkeel help advanced                      every command, including request-file forms

Commands print JSON. A different Agent reviews; an approving Principal closes.
See docs/getting-started/workkeel.md.
`;
const ADVANCED_HELP = `Workkeel — repository-native task coordination for coding agents

workkeel start [target] [--request brief.json]
workkeel init [target] --solo [--principal id] | --team --policy repository-policy.json
workkeel policy show [target] | policy update [target] --policy repository-policy.json [--actor id]
workkeel status|doctor [target]
workkeel task new [target] --goal text --acceptance text [--acceptance text] [--write path] [--read path] [--risk tier] [--approval path] [--id id] [--actor id]
workkeel task create [target] --source contract.json --request request.json
workkeel task show [target] --id task-id
workkeel task assess [target] --id task-id [--request assessment.json]
workkeel task evidence-check [target] --id task-id --request completion-evidence.json
workkeel task metrics [target] --id task-id
workkeel task summary [target] --id task-id
workkeel task observe [target] --id task-id --request observation.json
workkeel usage bind|report|activity|close [target] --request usage-request.json
workkeel usage collect [target] --id binding-id
workkeel dispatch prepare|plan|bind [target] --request dispatch-request.json
workkeel dispatch show [target] --id execution-id
workkeel intake preview [target] --request brief.json
workkeel intake apply [target] --request brief.json --fingerprint sha256
workkeel task claim|release|handoff|review|rework|close|cancel [target] --id task-id [--actor id] [--summary text] [--evidence path] [--judgment pass|fail] [--revision sha] [--rollback text] [--expect version]
workkeel task <operation> [target] --id task-id --request request.json   (integration form)
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
workkeel model-policy show [target] --id policy-id
workkeel model-policy draft|approve|preview [target] --request policy-request.json
workkeel skill-lifecycle list [target]
workkeel skill-lifecycle candidate|evaluate|review|approve|policy|activate|suspend|rollback|revalidate|use|retrospective [target] --request request.json
workkeel autonomy show [target]
workkeel autonomy policy|enqueue|pause|resume|cancel|event|discover|resume-job [target] --request request.json
workkeel autonomy tick|serve [target]
workkeel goal list [target]
workkeel goal show|tick|serve [target] --id goal-id
workkeel goal create|pause|resume|cancel|recover|extend-admission [target] --request request.json
workkeel retention inventory|preview|archive|verify|usage [target] --request request.json
workkeel workspace create|register|remove|integration [private state directory] --request request.json
workkeel workspace show|serve [private state directory]

All task commands return JSON. Lifecycle mutation requests contain operation_id,
expected_version and actor; workflow requests use a stable run_id and active claim.
See docs/getting-started/workkeel.md and docs/operations/workkeel-workflows.md.
Native host execution is the default. Runtime plans do not launch models or grant
permissions. Workflow run explicitly launches the qualified Codex subscription host.
`;
function required(options, key) { if (!options[key]) throw new Error(`Missing ${key}`); return options[key]; }
function allow(options, keys) { if (Object.keys(options).some(k => !keys.includes(k))) throw new Error("Option is not supported by this command"); }

export async function workkeelMain(args) {
  if (!args.length || ["help", "--help", "-h"].includes(args[0])) { console.log(args[1] === "advanced" ? ADVANCED_HELP : HELP); return 0; }
  if (["version", "--version"].includes(args[0])) { console.log(TEMPLATE_VERSION); return 0; }
  const { command, action, target, options } = parseCommandLine(args);
  let output;
  if (command === "start") {
    allow(options, ["--request"]);
    output = await readStartGuide(target, { requestRef: options["--request"] ?? null });
  } else if (command === "init") {
    if (options["--solo"]) { allow(options, ["--solo", "--principal"]); output = await initializeTaskProject(target, soloPolicy(options["--principal"])); }
    else { allow(options, ["--policy", "--team"]); output = await initializeTaskProject(target, (await readTaskContractInput(target, required(options, "--policy"))).document); }
  } else if(command==='workspace') {
    const workspace=await import('./workkeel-workspace.mjs');
    if(action==='show'){allow(options,[]);output=await workspace.readWorkspaceSnapshot(target);}
    else if(action==='serve') {
      allow(options,['--request']);const config=options['--request']?(await readTaskContractInput(target,options['--request'])).document:{};
      const {startWorkspaceServer}=await import('./workkeel-workspace-server.mjs');
      const {createWorkspaceHooks}=await import('./workkeel-workspace-hooks.mjs');
      const server=await startWorkspaceServer(target,{control:config.control??null,hooks:createWorkspaceHooks({host_models:config.host_models??[]})});
      console.log(JSON.stringify({schema_version:'workkeel.workspace-server/v1',url:server.url,read_url:server.read_url,model_called:false},null,2));
      const stop=()=>void server.close();process.once('SIGINT',stop);process.once('SIGTERM',stop);return 0;
    } else {
      allow(options,['--request']);const request=(await readTaskContractInput(target,required(options,'--request'))).document;
      if(action==='create')output=await workspace.createWorkspace(target,request);
      else if(action==='register')output=await workspace.registerWorkspaceProject(target,request.project,{expectedVersion:request.expected_version});
      else if(action==='remove')output=await workspace.removeWorkspaceProject(target,request.id,{expectedVersion:request.expected_version});
      else if(action==='integration')output=await workspace.inspectWorkspaceIntegration(await workspace.readWorkspaceSnapshot(target),request);
      else throw Error('Unknown workspace action');
    }
  } else if (!await existsEntry(target, "workkeel.lock")) {
    throw new Error("Initialize the project with workkeel init before using task commands");
  } else if (command === "policy") {
    if (action === "show") { allow(options, []); output = (await readTaskProject(target)).policy; }
    else if (action === "update") {
      allow(options, ["--policy", "--actor"]);
      const project = await readTaskProject(target);
      output = await updateProjectPolicy(target, (await readTaskContractInput(target, required(options, "--policy"))).document, await resolveActor(target, project, options["--actor"]));
    } else throw new Error("Policy requires show or update");
  } else if (["status", "doctor"].includes(command)) {
    allow(options, []);
    output = command === "doctor" ? await diagnoseTaskProject(target) : {
      schema_version: "workkeel.status/v1", tasks: await listTaskItems(target), authority: "observation-only", mutation_status: "no-write"
    };
  } else if(command==='retention') {
    allow(options,['--request']);const retention=await import('./workkeel-retention.mjs');const request=(await readTaskContractInput(target,required(options,'--request'))).document;
    if(action==='inventory')output=await retention.inventoryRetention(target,request);
    else if(action==='preview')output=await retention.previewRetention(target,request);
    else if(action==='archive')output=await retention.applyRetentionArchive(target,request);
    else if(action==='verify')output=await retention.verifyRetentionArchive(target,request);
    else if(action==='usage')output=retention.summarizeRetentionUsage(request.samples);
    else throw Error('Unknown retention action');
  } else if(command==='model-policy') {
    const policy=await import('./workkeel-model-policy.mjs');
    if(action==='show'){allow(options,['--id']);output=await policy.readModelPolicy(target,required(options,'--id'));}
    else {allow(options,['--request']);const request=(await readTaskContractInput(target,required(options,'--request'))).document;
      if(action==='draft')output=await policy.saveModelPolicyDraft(target,request);
      else if(action==='approve')output=await policy.approveModelPolicy(target,request);
      else if(action==='preview')output=policy.selectModelPolicy(request.policy,request.context);
      else throw Error('Unknown model policy action');}
  } else if(command==='skill-lifecycle') {
    const learning=await import('./workkeel-learning-lifecycle.mjs');
    if(action==='list'){allow(options,[]);output=await learning.listNativeSkillLifecycle(target);}
    else {allow(options,['--request']);output=await learning.mutateNativeSkillLifecycle(target,action,(await readTaskContractInput(target,required(options,'--request'))).document);}
  } else if(command==='goal') {
    const goals=await import('./workkeel-goals.mjs');
    if(action==='list'){allow(options,[]);output=await goals.listNativeGoals(target);}
    else if(['show','tick','serve'].includes(action)){
      allow(options,['--id']);const id=required(options,'--id');
      if(action==='show')output=await goals.readNativeGoal(target,id);
      else if(action==='tick')output=await goals.runNativeGoalStep(target,id);
      else {const controller=new AbortController(),service=await goals.serveNativeGoal(target,id,{signal:controller.signal,onError:e=>console.error(JSON.stringify({error:e.message}))});const stop=()=>{controller.abort();service.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);console.log(JSON.stringify({schema_version:'workkeel.goal-service/v1',goal_id:id,state:'listening',foreground:true,inference:'sealed-approved-operations-only'}));return 0;}
    }else{allow(options,['--request']);const request=(await readTaskContractInput(target,required(options,'--request'))).document;
      if(action==='create')output=await goals.createNativeGoal(target,request);
      else if(action==='extend-admission'){const {extendGoalAdmission}=await import('./workkeel-autonomy-admission.mjs');output=await extendGoalAdmission(target,request);}
      else {const {goal_id,...control}=request;output=await goals.controlNativeGoal(target,goal_id,action,control);}}
  } else if(command==='autonomy') {
    const autonomy=await import('./workkeel-autonomy.mjs');
    if(action==='show'){allow(options,[]);output=await autonomy.readAutonomy(target);}
    else if(['tick','serve'].includes(action)){
      allow(options,[]);const {createAutonomyWorkflowAdapter}=await import('./workkeel-autonomy-workflow.mjs');const adapter=createAutonomyWorkflowAdapter(target);
      if(action==='tick')output=await autonomy.runAutonomyStep(target,{adapter});
      else {const controller=new AbortController();const service=await autonomy.serveAutonomy(target,{adapter,signal:controller.signal,onError:e=>console.error(JSON.stringify({error:e.message}))});const stop=()=>{controller.abort();service.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);console.log(JSON.stringify({schema_version:'workkeel.autonomy-service/v1',state:'listening',inference:'only-on-approved-work',foreground:true}));return 0;}
    } else {allow(options,['--request']);const request=(await readTaskContractInput(target,required(options,'--request'))).document;
      if(action==='cancel'){const {createAutonomyWorkflowAdapter}=await import('./workkeel-autonomy-workflow.mjs');output=await autonomy.cancelAutonomyJob(target,request,{adapter:createAutonomyWorkflowAdapter(target)});}
      else output=await autonomy.mutateAutonomy(target,action,request);}
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
    if (action === 'evidence-check') {
      allow(options, ['--id', '--request']);
      const {checkCompletionEvidence}=await import('./workkeel-completion-evidence.mjs');
      output=await checkCompletionEvidence(target,required(options,'--id'),(await readTaskContractInput(target,required(options,'--request'))).document);
    } else if (action === 'assess') {
      allow(options, ['--id', '--request']);
      const { assessNativeTask } = await import('./workkeel-review-assessment.mjs');
      output = await assessNativeTask(target, required(options, '--id'), options['--request']
        ? (await readTaskContractInput(target, options['--request'])).document : {});
    } else if(action==='summary'||action==='observe'){
      allow(options,action==='summary'?['--id']:['--id','--request']);
      const {readTaskSummary,recordTaskObservation}=await import('./workkeel-task-summary.mjs');
      output=action==='summary'?await readTaskSummary(target,required(options,'--id')):
        await recordTaskObservation(target,required(options,'--id'),(await readTaskContractInput(target,required(options,'--request'))).document);
    } else if (action === "metrics") {
      allow(options, ["--id"]);
      const { readTaskMeasurements } = await import("./workkeel-measurements.mjs");
      output = await readTaskMeasurements(target, required(options, "--id"));
    } else if (action === "show") { allow(options, ["--id"]); output = await readNativeTask(target, required(options, "--id")); }
    else if (action === "new" || action === "create" && !options["--source"]) {
      allow(options, ["--goal", "--acceptance", "--write", "--read", "--include", "--exclude", "--risk", "--id", "--actor", "--approval"]);
      const { draft, request } = await draftFromFlags(target, options);
      output = await createNativeTask(target, draft, request);
    } else if (options["--request"]) {
      // Integration form: an exact request document, unchanged.
      allow(options, action === "create" ? ["--source", "--request"] : ["--id", "--request"]);
      const request = (await readTaskContractInput(target, required(options, "--request"))).document;
      output = action === "create" ? await createNativeTask(target, (await readTaskContractInput(target, required(options, "--source"))).document, request) :
        await mutateNativeTask(target, required(options, "--id"), action, request);
    } else if (action === "create") {
      allow(options, ["--source", "--actor"]);
      const project = await readTaskProject(target), draft = (await readTaskContractInput(target, options["--source"])).document;
      output = await createNativeTask(target, draft, { operation_id: `cli-create-${createHash("sha256").update(JSON.stringify(draft ?? null)).digest("hex").slice(0, 24)}`, expected_version: 0, actor: await resolveActor(target, project, options["--actor"]) });
    } else {
      allow(options, ["--id", "--actor", "--revision", "--base", "--claim", "--summary", "--evidence", "--judgment", "--rollback", "--unresolved", "--mode", "--expect", "--attempt"]);
      const id = required(options, "--id");
      output = await mutateNativeTask(target, id, action, await lifecycleRequestFromFlags(target, id, action, options));
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
  } else throw new Error("Unsupported Workkeel command");
  console.log(JSON.stringify(output, null, 2));
  return output.valid === false || output.coverage_consistent === false ? 1 : 0;
}
