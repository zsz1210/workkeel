#!/usr/bin/env node
import { workkeelMain } from "../src/workkeel-cli.mjs";
try { process.exitCode = await workkeelMain(process.argv.slice(2)); }
catch (error) {
  console.error(JSON.stringify({ schema_version: "workkeel.operation-error/v1", message: error.message,
    mutation_status: "inspect-before-retry", next_action: "Inspect task state and operation history before retrying the same operation ID." }));
  process.exitCode = 1;
}
