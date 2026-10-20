import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import {execFileSync} from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function workflowStep(workflow, id) {
  const start = workflow.indexOf(`      - id: ${id}\n`);
  assert.ok(start >= 0, `missing workflow step ${id}`);
  const end = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, end === -1 ? workflow.length : end);
}

test('framework checks preserve private failed evidence while public source boundaries still reject it',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-source-scope-')),clone=path.join(directory,'source');t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','clone','--quiet','--no-hardlinks',root,clone],{stdio:['ignore','pipe','pipe']});
  await fs.copyFile(path.join(root,'scripts/check-repo.mjs'),path.join(clone,'scripts/check-repo.mjs'));
  await fs.symlink(path.join(root,'node_modules'),path.join(clone,'node_modules'),'dir');
  await fs.mkdir(path.join(clone,'.workkeel-private'));
  await fs.writeFile(path.join(clone,'.workkeel-private/review.md'),'Synthetic observed label: 交付需要恢復\n');
  await fs.writeFile(path.join(clone,'.workkeel-private/failed-stdout.json'),'');
  const check=()=>execFileSync(process.execPath,[path.join(clone,'scripts/check-repo.mjs')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  assert.match(check(),/Repository checks passed/);
  await fs.copyFile(path.join(root,'scripts/check-source-checkout.mjs'),path.join(clone,'scripts/check-source-checkout.mjs'));
  const inspect=script=>execFileSync(process.execPath,[script],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const privateRejected=error=>error.status!==0&&JSON.parse(String(error.stdout)).failures.some(f=>f.rule==='private-state-in-public-checkout'&&f.path.startsWith('.workkeel-private'));
  assert.throws(()=>inspect(path.join(clone,'scripts/check-source-checkout.mjs')),privateRejected,'private evidence is still forbidden in a public source checkout');
  const alias=path.join(directory,'source-alias');await fs.symlink(clone,alias,'dir');
  assert.throws(()=>inspect(path.join(alias,'scripts/check-source-checkout.mjs')),privateRejected,'an aliased CLI entry must run the check rather than silently exit zero');
  await fs.writeFile(path.join(clone,'docs/nonlocalized-probe.md'),'Synthetic public prose: 資料\n');
  assert.throws(check,error=>error.status!==0&&String(error.stderr).includes('nonlocalized-probe.md'));
  await fs.rm(path.join(clone,'docs/nonlocalized-probe.md'));await fs.writeFile(path.join(clone,'invalid-source.json'),'');
  assert.throws(check,error=>error.status!==0&&String(error.stderr).includes('invalid JSON: invalid-source.json'));
  assert.equal(await fs.readFile(path.join(clone,'.workkeel-private/failed-stdout.json'),'utf8'),'','retain the original failed evidence unchanged');
});

test("CI is one bounded Node.js 24 gate requiring verify and the publication checks", async () => {
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
  assert.match(workflowStep(workflow, "verify"), /npm run verify\n/);
  for (const check of ["check:source-checkout", "check:publication", "check:public-history"])
    assert.match(workflowStep(workflow, "doctor"), new RegExp(`npm run ${check}(\\n|$)`), check);
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
  assert.match(workflow, /push:\n    branches:\n      - main\n      - 'workkeel\/\*\*'\n/);
  assert.match(workflowStep(workflow, "doctor"), /node \.\/bin\/workkeel\.mjs start \./);
  assert.match(workflowStep(workflow, "doctor"), /npm run check:public-history/);
  assert.doesNotMatch(workflowStep(workflow, "doctor"), /workkeelw\.mjs/, "A clean source clone has no initialized local launcher");
  for (const id of ["install", "doctor", "verify"]) {
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
  assert.equal(packageDocument.scripts["test:browser"], "node scripts/verify-workkeel-monitor.mjs");
  assert.match(testingGuide, /npm run verify/);
  assert.match(testingGuide, /npm run test:browser/);
  assert.match(testingGuide, /local/i);
  const release = await fs.readFile(path.join(root, ".github/workflows/publish-npm.yml"), "utf8");
  assert.match(release, /npm run verify/);
});
