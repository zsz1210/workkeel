#!/usr/bin/env node
import { workkeelMain } from "../src/workkeel-cli.mjs";
try {
  process.exitCode = await workkeelMain(process.argv.slice(2));
}
catch (error) {
  const taskLifecycle = process.argv[2] === "task" &&
    ["new", "create", "claim", "release", "handoff", "review", "rework", "close", "cancel"].includes(process.argv[3]);
  console.error(JSON.stringify({ schema_version: "workkeel.operation-error/v1", message: error.message,
    mutation_status: "inspect-before-retry", next_action: taskLifecycle
      ? "Inspect task state and operation history before retrying the same operation ID."
      : "Read the message, fix the cause, then rerun the command." }));
  process.exitCode = 1;
}
