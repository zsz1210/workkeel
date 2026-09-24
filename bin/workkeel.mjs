#!/usr/bin/env node
import { workkeelMain } from "../src/workkeel-cli.mjs";
try {
  const args=process.argv.slice(2);
  if(args[0]==="monitor") {
    const {monitorMain}=await import("../src/workkeel-monitor.mjs");
    process.exitCode=await monitorMain(args.slice(1));
  } else {
    if(!args.length||["help","--help","-h"].includes(args[0]))console.log("workkeel monitor [task-first project] — optional foreground, read-only task monitor\n");
    process.exitCode = await workkeelMain(args);
  }
}
catch (error) {
  console.error(JSON.stringify({ schema_version: "workkeel.operation-error/v1", message: error.message,
    mutation_status: "inspect-before-retry", next_action: "Inspect task state and operation history before retrying the same operation ID." }));
  process.exitCode = 1;
}
