#!/usr/bin/env node
import { workkeelMain } from "../src/workkeel-cli.mjs";
import { parseCommandLine } from "../src/workkeel-cli-flags.mjs";
try {
  process.exitCode = await workkeelMain(process.argv.slice(2));
}
catch (error) {
  let command = process.argv[2], action = process.argv[3];
  try {
    ({ command, action } = parseCommandLine(process.argv.slice(2)));
  } catch { /* Invalid arguments still receive the original error envelope. */ }
  const taskLifecycle = command === "task" &&
    ["new", "create", "claim", "release", "handoff", "review", "rework", "close", "cancel"].includes(action);
  console.error(JSON.stringify({ schema_version: "workkeel.operation-error/v1", message: error.message,
    mutation_status: "inspect-before-retry", next_action: taskLifecycle
      ? "Inspect task state and operation history before retrying the same operation ID."
      : "Read the message, fix the cause, then rerun the command." }));
  process.exitCode = 1;
}
