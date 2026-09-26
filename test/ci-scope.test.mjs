import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function workflowStep(workflow, id) {
  const start = workflow.indexOf(`      - id: ${id}\n`);
  assert.ok(start >= 0, `missing workflow step ${id}`);
  const end = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, end === -1 ? workflow.length : end);
}

test("CI is one bounded Node.js 24 repository gate", async () => {
  const workflow = await fs.readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n"));
  const jobNames = [...jobs.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map((match) => match[1]);

  assert.deepEqual(jobNames, ["verify"]);
  const timeout = Number(workflow.match(/timeout-minutes:\s*(\d+)/)?.[1]);
  assert.ok(timeout > 0 && timeout <= 15, "ordinary CI must retain a bounded timeout");
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /cache: npm/);
  assert.match(workflow, /cache-dependency-path: package-lock\.json/);
  assert.match(workflowStep(workflow, "install"), /npm ci --ignore-scripts/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.doesNotMatch(workflow, /matrix:/);
  assert.doesNotMatch(workflow, /Node\.js 22|node-version:\s*22/);
  assert.doesNotMatch(workflow, /npm run test:full/);
  assert.doesNotMatch(workflow, /npm run test:browser/);
  assert.doesNotMatch(workflow, /ci-scope\.mjs/);
  assert.match(workflow, /npm run test:fast/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /Enforce aggregated verification result/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);

  const actionReferences = [...workflow.matchAll(/^\s+- uses: ([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(actionReferences.length > 0);
  for (const reference of actionReferences) {
    assert.match(reference, /^[^@]+@[a-f0-9]{40}$/, reference);
  }

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:\n    branches:\n      - main/);
  assert.match(workflowStep(workflow, "doctor"), /WORKKEEL_CLI_PATH=\.\/bin\/workkeel\.mjs node \.\/workkeelw\.mjs doctor/);
  assert.doesNotMatch(workflowStep(workflow, "doctor"), /templew\.mjs/, "This repository uses native Workkeel; legacy Doctor belongs to compatibility fixtures");
  assert.doesNotMatch(workflow, /templew\.mjs schema validate/, "Doctor already validates schemas");
  for (const id of ["install", "governance", "doctor", "behavior"]) {
    assert.match(workflowStep(workflow, id), /if:.*always\(\)/, id);
  }
});

test("complete and browser verification remain explicit commands; publishing verifies the full Release source", async () => {
  const packageDocument = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const testingGuide = await fs.readFile(path.join(root, "docs/getting-started/testing.md"), "utf8");

  assert.equal(packageDocument.scripts.test, "node scripts/test-groups.mjs full");
  assert.equal(packageDocument.scripts["test:full"], "node scripts/test-groups.mjs full");
  assert.equal(packageDocument.scripts["test:daily"], "node scripts/test-groups.mjs daily");
  assert.equal(packageDocument.scripts.verify, "npm run check && npm run test:full");
  assert.equal(packageDocument.scripts["verify:daily"], "npm run check && npm run test:daily");
  assert.equal(packageDocument.scripts["test:browser"], "node scripts/verify-console-browser.mjs");
  assert.match(testingGuide, /npm run verify/);
  assert.match(testingGuide, /npm run test:browser/);
  assert.match(testingGuide, /local/i);
  const release = await fs.readFile(path.join(root, ".github/workflows/publish-npm.yml"), "utf8");
  assert.match(release, /npm run verify/);
});
