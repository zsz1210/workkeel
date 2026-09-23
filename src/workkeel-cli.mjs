import path from "node:path";
import { TEMPLATE_VERSION } from "./constants.mjs";
import { readTaskContractInput } from "./task-contract.mjs";
import { initializeTaskProject, previewLegacyMigration, existsEntry } from "./workkeel-project.mjs";
import { createNativeTask, mutateNativeTask, readNativeTask, listTaskItems, diagnoseTaskProject } from "./workkeel-tasks.mjs";
import { planTaskRuntime } from "./workkeel-runtime.mjs";

const HELP = `Workkeel — repository-native task coordination for coding agents

workkeel init [target] --policy repository-policy.json
workkeel migration preview [target] --policy repository-policy.json
workkeel migration apply [target] --policy repository-policy.json --fingerprint sha256
workkeel status|doctor [target]
workkeel task create [target] --source contract.json --request request.json
workkeel task show [target] --id task-id
workkeel task claim|release|handoff|review|rework|close|cancel [target] --id task-id --request request.json
workkeel runtime plan [target] --id task-id
workkeel legacy <original Temple arguments>

All task-first commands return JSON. Requests contain operation_id, expected_version,
and actor {agent_id, principal_id}; see docs/getting-started/workkeel.md.
Native host execution is the default. Runtime plans do not launch models or grant
permissions. Existing Temple projects retain their original commands and history.
`;
function parse(args) {
  const rest = [...args]; const command = rest.shift() ?? "help";
  const action = ["task", "migration", "runtime"].includes(command) ? rest.shift() : null;
  const target = rest[0] && !rest[0].startsWith("--") ? rest.shift() : ".";
  const options = {};
  while (rest.length) {
    const key = rest.shift();
    if (key === "--json") continue;
    if (!["--policy", "--source", "--request", "--id", "--fingerprint"].includes(key) || Object.hasOwn(options, key) || !rest.length || rest[0].startsWith("--")) throw new Error("Unknown, repeated or incomplete Workkeel option");
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
  if (command === "init" || command === "migration") {
    allow(options, command === "init" || action === "preview" ? ["--policy"] : ["--policy", "--fingerprint"]);
    const policy = (await readTaskContractInput(target, required(options, "--policy"))).document;
    if (command === "init") output = await initializeTaskProject(target, policy);
    else if (action === "preview") output = await previewLegacyMigration(target, policy);
    else if (action === "apply") output = await initializeTaskProject(target, policy, { migrationFingerprint: required(options, "--fingerprint") });
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
  } else if (command === "task") {
    if (action === "show") { allow(options, ["--id"]); output = await readNativeTask(target, required(options, "--id")); }
    else {
      allow(options, action === "create" ? ["--source", "--request"] : ["--id", "--request"]);
      const request = (await readTaskContractInput(target, required(options, "--request"))).document;
      output = action === "create" ? await createNativeTask(target, (await readTaskContractInput(target, required(options, "--source"))).document, request) :
        await mutateNativeTask(target, required(options, "--id"), action, request);
    }
  } else if (command === "runtime" && action === "plan") {
    allow(options, ["--id"]);
    const item = await readNativeTask(target, required(options, "--id"));
    output = planTaskRuntime(item.contract);
  } else throw new Error("Unsupported task-first command; legacy writers cannot mutate task-first projects");
  console.log(JSON.stringify(output, null, 2));
  return output.valid === false ? 1 : 0;
}
