#!/usr/bin/env node
import fs from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("usage: validate-test-observation.mjs <observation.json>");
  process.exit(2);
}

let document;
try {
  document = JSON.parse(fs.readFileSync(target, "utf8"));
} catch (error) {
  console.error(`invalid JSON: ${error.message}`);
  process.exit(1);
}

const valid =
  document?.schema_version === "temple.test-observation/v1" &&
  typeof document.revision === "string" && document.revision.length > 0 &&
  Array.isArray(document.command) && document.command.length > 0 && document.command.every((entry) => typeof entry === "string" && entry.length > 0) &&
  ["pass", "fail"].includes(document.result) &&
  Number.isInteger(document.exit_code) &&
  ((document.result === "pass") === (document.exit_code === 0)) &&
  !Number.isNaN(Date.parse(document.started_at)) &&
  !Number.isNaN(Date.parse(document.completed_at)) &&
  Date.parse(document.completed_at) >= Date.parse(document.started_at) &&
  Array.isArray(document.artifact_refs) && document.artifact_refs.every((entry) => typeof entry === "string" && entry.length > 0);

if (!valid) {
  console.error("invalid temple.test-observation/v1 document");
  process.exit(1);
}

console.log("valid test observation (validation only; command not executed)");
