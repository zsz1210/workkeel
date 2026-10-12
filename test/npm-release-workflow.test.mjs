import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  ReleaseValidationError,
  RELEASE_TOOLCHAIN,
  validateReleaseToolchain,
  validateReleasePreparation,
  verifyReleaseAsset
} from "../scripts/validate-npm-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function packageDocument(version = "0.2.0-alpha.1") {
  return {
    name: "@zsz1210/workkeel",
    version,
    repository: {
      type: "git",
      url: "git+https://github.com/zsz1210/workkeel.git"
    },
    publishConfig: { access: "public", tag: "next" }
  };
}

async function preparationFixture(version = "0.2.0-alpha.1") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "temple-npm-release-"));
  const filename = `zsz1210-workkeel-${version}.tgz`;
  await fs.writeFile(path.join(directory, filename), "qualified package bytes");
  return {
    packageDocument: packageDocument(version),
    packResult: [
      {
        name: "@zsz1210/workkeel",
        version,
        filename
      }
    ],
    packDirectory: directory,
    tagName: `v${version}`,
    releasePrerelease: version.includes("-"),
    githubRepository: "zsz1210/workkeel",
    npmVersion: "11.5.1"
  };
}

test("prerelease metadata routes only to npm next", async (t) => {
  const fixture = await preparationFixture();
  t.after(() => fs.rm(fixture.packDirectory, { recursive: true, force: true }));
  const result = await validateReleasePreparation(fixture);
  assert.equal(result.package_version, "0.2.0-alpha.1");
  assert.equal(result.dist_tag, "next");
});

test("stable Release metadata routes only to npm latest", async (t) => {
  const fixture = await preparationFixture("0.2.0");
  t.after(() => fs.rm(fixture.packDirectory, { recursive: true, force: true }));
  const result = await validateReleasePreparation(fixture);
  assert.equal(result.package_version, "0.2.0");
  assert.equal(result.dist_tag, "latest");
});

test("tag, release channel, repository, package policy, npm CLI, and pack identity fail closed", async (t) => {
  const fixture = await preparationFixture();
  t.after(() => fs.rm(fixture.packDirectory, { recursive: true, force: true }));

  for (const override of [
    { tagName: "v0.2.0-alpha.2" },
    { releasePrerelease: false },
    { githubRepository: "another/project" },
    { packageDocument: { ...fixture.packageDocument, publishConfig: { access: "public", tag: "latest" } } },
    { npmVersion: "11.5.0" },
    { packResult: [{ ...fixture.packResult[0], version: "0.2.0-alpha.2" }] }
  ]) {
    await assert.rejects(
      validateReleasePreparation({ ...fixture, ...override }),
      ReleaseValidationError
    );
  }
});

test("Release asset must be a byte-identical regular file", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "temple-npm-asset-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const fresh = path.join(directory, "fresh.tgz");
  const release = path.join(directory, "release.tgz");
  await fs.writeFile(fresh, "same bytes");
  await fs.writeFile(release, "same bytes");

  const result = await verifyReleaseAsset({ freshArchive: fresh, releaseArchive: release });
  assert.equal(result.archive_size, 10);
  assert.match(result.archive_sha256, /^[a-f0-9]{64}$/);

  await fs.writeFile(release, "other data");
  await assert.rejects(
    verifyReleaseAsset({ freshArchive: fresh, releaseArchive: release }),
    /differ/
  );
});

test("release tooling rejects a different compressor even with identical Node and npm", () => {
  const good = { versions: { node: RELEASE_TOOLCHAIN.node, zlib: RELEASE_TOOLCHAIN.zlib }, npmVersion: RELEASE_TOOLCHAIN.npm };
  assert.equal(validateReleaseToolchain(good).zlib, RELEASE_TOOLCHAIN.zlib);
  for (const change of [
    { versions: { ...good.versions, zlib: "1.2.12" } },
    { versions: { ...good.versions, node: "24.19.0" } },
    { npmVersion: "11.18.0" }, { versions: {} }
  ]) assert.throws(() => validateReleaseToolchain({ ...good, ...change }), /official Node.*No release archive was created/);
});

test("equal decompressed payloads never weaken the exact compressed-asset gate", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "temple-gzip-gate-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const payload = Buffer.from("repeatable package content ".repeat(1000));
  const fresh = path.join(directory, "fresh.tgz"), release = path.join(directory, "release.tgz");
  const a = gzipSync(payload, { level: 1 }), b = gzipSync(payload, { level: 9 });
  assert.deepEqual(gunzipSync(a), gunzipSync(b));
  assert.notDeepEqual(a, b);
  await fs.writeFile(fresh, a); await fs.writeFile(release, b);
  await assert.rejects(verifyReleaseAsset({ freshArchive: fresh, releaseArchive: release }), /differs|differ/);
});

test("release pack command rejects invalid output without changing the source", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "temple-pack-command-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source"); await fs.mkdir(source);
  await fs.writeFile(path.join(source, "package.json"), JSON.stringify(packageDocument()));
  const helper = path.join(root, "scripts/pack-npm-release.mjs");
  for (const args of [[], ["--output", source], ["--output", path.join(source, "nested")], ["--unknown", "x"]]) {
    const result = spawnSync(process.execPath, [helper, ...args], { cwd: source, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.deepEqual(await fs.readdir(source), ["package.json"]);
  }
});

test("pack helper refuses an incompatible compressor before npm pack or output creation", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "temple-toolchain-refusal-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source"); await fs.mkdir(source);
  const output = path.join(directory, "candidate");
  const npmCli = path.join(directory, "npm-cli.cjs");
  await fs.writeFile(npmCli, `if(process.argv[2]==='--version')console.log(${JSON.stringify(RELEASE_TOOLCHAIN.npm)});else{require('node:fs').writeFileSync('unexpected-pack','called');process.exit(9);}`);
  const preload = "data:text/javascript," + encodeURIComponent("Object.defineProperty(process.versions,'zlib',{value:'1.2.12'});");
  const result = spawnSync(process.execPath, ["--import", preload, path.join(root, "scripts/pack-npm-release.mjs"), "--output", output], {
    cwd: source, env: { ...process.env, npm_execpath: npmCli }, encoding: "utf8", timeout: 10000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /toolchain mismatch \(.*zlib.*\)/);
  assert.equal(await fs.stat(output).catch(() => null), null);
  assert.deepEqual(await fs.readdir(source), []);
});

// Execute the workflow's actual shell bodies with disposable npm/gh transports.
// The Node validator is real; no network, installation, expensive suite or publish.
test("workflow stops before full tests on asset mismatch and retains the final publication gate", async (t) => {
  const workflow = await fs.readFile(path.join(root, ".github/workflows/publish-npm.yml"), "utf8");
  const runBodies = workflow.split(/^      - /m).flatMap((step) => {
    const match = step.match(/^        run: (.*)\n?([\s\S]*)$/m);
    if (!match) return [];
    return [match[1] === "|" ? match[2].split("\n").filter((line) => line.startsWith("          ")).map((line) => line.slice(10)).join("\n") : match[1]];
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "temple-workflow-order-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin"); await fs.mkdir(bin);
  const transport = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const args=process.argv.slice(2), name=path.basename(process.argv[1]);
const out=process.env.RUNNER_TEMP, mode=process.env.TEST_RELEASE_MODE;
const log=(s)=>fs.appendFileSync(path.join(out,'calls'),s+'\\n');
if(name==='node') {
 if(args[0]==='scripts/check-published-npm.mjs') {
  const post=args.includes('--require-published');log(post?'registry-after':'registry-before');
  if(mode==='registry-failure')process.exit(1);
  if(!post)fs.appendFileSync(process.env.GITHUB_OUTPUT,'action='+ (mode==='already-published'?'skip':'publish')+'\\n');
  process.exit(0);
 }
 const r=cp.spawnSync(process.execPath,[process.env.TEST_RELEASE_VALIDATOR,...args.slice(1)],{stdio:'inherit'});process.exit(r.status??1);
}
if(name==='gh') {const dir=args[args.indexOf('--dir')+1];fs.copyFileSync(path.join(out,'attached'),path.join(dir,process.env.ARCHIVE_FILENAME));process.exit(0);}
if(args[0]==='--version') {console.log(${JSON.stringify(RELEASE_TOOLCHAIN.npm)});process.exit(0);}
if(args[0]==='ci') {log('install');process.exit(0);}
if(args[0]==='publish') {log('publish');process.exit(0);}
if(args[1]==='verify') {log('verify');process.exit(mode==='test-failure'?1:0);}
if(args[1]==='release:pack') {
 const dir=args[args.indexOf('--output')+1];fs.mkdirSync(dir);const final=dir.endsWith('verified-package');log(final?'final-pack':'early-pack');
 fs.writeFileSync(path.join(dir,process.env.ARCHIVE_FILENAME),final&&mode==='late-drift'?'changed':'qualified');
 fs.writeFileSync(path.join(dir,'pack-result.json'),JSON.stringify([{name:'@zsz1210/workkeel',version:'0.2.0-alpha.1',filename:process.env.ARCHIVE_FILENAME}]));process.exit(0);
}
throw Error('Unexpected command '+name+' '+args.join(' '));
`;
  for (const name of ["node", "npm", "gh"]) await fs.writeFile(path.join(bin, name), transport, { mode: 0o755 });
  for (const mode of ["early-mismatch", "test-failure", "late-drift", "registry-failure", "already-published", "pass"]) {
    const cwd = path.join(directory, mode); await fs.mkdir(cwd);
    await fs.writeFile(path.join(cwd, "package.json"), JSON.stringify(packageDocument()));
    await fs.writeFile(path.join(cwd, "attached"), mode === "early-mismatch" ? "different" : "qualified");
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, RUNNER_TEMP: cwd,
      ARCHIVE_FILENAME: "fixture.tgz", RELEASE_TAG: "v0.2.0-alpha.1", RELEASE_PRERELEASE: "true",
      GITHUB_REPOSITORY: "zsz1210/workkeel", GITHUB_OUTPUT: path.join(cwd, "outputs"),
      EXPECTED_REPOSITORY_ID: "12345", ACTUAL_REPOSITORY_ID: "12345",
      DIST_TAG: "next", TEST_RELEASE_MODE: mode, TEST_RELEASE_VALIDATOR: path.join(root, "scripts/validate-npm-release.mjs") };
    let failed = false;
    for (const body of runBodies) {
      if (body.includes('npm publish') && (await fs.readFile(env.GITHUB_OUTPUT, 'utf8')).includes('action=skip')) continue;
      const result = spawnSync("/bin/bash", ["-e", "-c", body], { cwd, env, encoding: "utf8", timeout: 10000 });
      if (result.status !== 0) { failed = true; break; }
    }
    const calls = (await fs.readFile(path.join(cwd, "calls"), "utf8")).trim().split("\n");
    const expected = {
      "early-mismatch": ["install", "early-pack"],
      "test-failure": ["install", "early-pack", "verify"],
      "late-drift": ["install", "early-pack", "verify", "final-pack"],
      "registry-failure": ["install", "early-pack", "verify", "final-pack", "registry-before"],
      "already-published": ["install", "early-pack", "verify", "final-pack", "registry-before", "registry-after"],
      pass: ["install", "early-pack", "verify", "final-pack", "registry-before", "publish", "registry-after"]
    };
    assert.deepEqual(calls, expected[mode], mode);
    assert.equal(failed, !["pass", "already-published"].includes(mode), mode);
  }
});

test("npm publication workflow has one Release-only OIDC boundary", async () => {
  const workflow = await fs.readFile(path.join(root, ".github/workflows/publish-npm.yml"), "utf8");
  const trigger = workflow.slice(workflow.indexOf("on:\n"), workflow.indexOf("\nconcurrency:\n"));

  assert.match(trigger, /^on:\n  release:\n    types: \[published\]$/m);
  assert.doesNotMatch(trigger, /push:|pull_request:|workflow_dispatch:|schedule:/);
  assert.match(workflow, /^permissions:\n  contents: read\n  id-token: write$/m);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, new RegExp(`node-version: ${RELEASE_TOOLCHAIN.node.replaceAll(".", "\\.")}(?:\\n|$)`));
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /gh release download/);
  assert.match(workflow, /verify-asset/);
  assert.match(workflow, /npm publish .* --access public --tag "\$DIST_TAG"/);
  assert.match(workflow, /if: \$\{\{ steps\.registry\.outputs\.action == 'publish' \}\}/);
  assert.match(workflow, /--require-published/);
  assert.match(workflow, /vars\.NPM_TRUST_REPOSITORY_ID/);
  assert.match(workflow, /github\.repository_id/);
  assert.match(workflow, /\[ -z "\$EXPECTED_REPOSITORY_ID" \]/);
  assert.match(workflow, /"\$EXPECTED_REPOSITORY_ID" != "\$ACTUAL_REPOSITORY_ID"/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);
  assert.doesNotMatch(workflow, /continue-on-error|retry|fallback/i);

  const actionReferences = [...workflow.matchAll(/^\s+uses: ([^\s#]+)/gm)].map((match) => match[1]);
  assert.equal(actionReferences.length, 2);
  for (const reference of actionReferences) {
    assert.match(reference, /^[^@]+@[a-f0-9]{40}$/);
  }
});

test("release identity gate refuses absent or mismatched repository IDs", async () => {
  const workflow = await fs.readFile(path.join(root, ".github/workflows/publish-npm.yml"), "utf8");
  const step = workflow.split("      - name: Require the approved npm trust repository identity\n")[1]
    .split("\n      - name:")[0];
  const body = step.split("        run: |\n")[1].split("\n")
    .filter((line) => line.startsWith("          ")).map((line) => line.slice(10)).join("\n");
  for (const [expected, actual, status] of [["", "123", 1], ["456", "123", 1], ["123", "123", 0]]) {
    const result = spawnSync("/bin/bash", ["-e", "-c", body], {
      env: { EXPECTED_REPOSITORY_ID: expected, ACTUAL_REPOSITORY_ID: actual }, encoding: "utf8"
    });
    assert.equal(result.status, status);
  }
});
