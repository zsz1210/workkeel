import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sha256 } from '../src/files.mjs';
import { initializeTaskProject } from '../src/workkeel-project.mjs';
import { createNativeTask, mutateNativeTask, readNativeTask, inspectTaskCandidate } from '../src/workkeel-tasks.mjs';
import { assessNativeTask } from '../src/workkeel-review-assessment.mjs';

const cli = fileURLToPath(new URL('../bin/workkeel.mjs', import.meta.url));
const builder = { agent_id: 'builder', principal_id: 'owner' };
const reviewer = { agent_id: 'reviewer', principal_id: 'qa-owner' };
const request = (version, extra = {}, actor = builder) => ({ expected_version: version, operation_id: `op-${version}`, actor, ...extra });
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function write(root, ref, value) {
  await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
  await fs.writeFile(path.join(root, ref), typeof value === 'string' ? value : JSON.stringify(value));
}
const input = extra => ({ schema_version: 'workkeel.review-assessment-input/v1', impact_ref: 'approval.json', ...extra });
async function fixture(t, { separation = 'distinct-agent', impact = 'none', prose = false, delivered = true, dependencies = [], expiresAt = null } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workkeel-assess-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  const policy = { schema_version: 'workkeel.task-policy/v1', principals: ['owner', 'qa-owner'], agents: [builder, reviewer], approvers: ['owner'], review_separation: separation };
  await write(root, 'approval.json', { schema_version: 'workkeel.review-impact/v1', task_id: 'WK-one', approved_by: 'owner', irreversible_impact: impact });
  await write(root, 'src/value.mjs', 'export const value = 1;\n');
  await write(root, 'docs/note.md', 'Speling\n');
  await write(root, 'checks/test.mjs', 'assert(value === 2);\n');
  await write(root, 'checks/oracle.json', '{"value":2}\n');
  await write(root, 'checks/input.json', '{}\n');
  await write(root, 'capture.log', 'Synthetic fixture capture, exit 0; not a real product measurement.\n');
  await initializeTaskProject(root, policy);
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  const contract = { schema_version: 'workkeel.task-contract/v2', id: 'WK-one', goal: 'Correct value', state: 'intake',
    scope: { include: ['value'], exclude: ['publication'] }, actor: builder, dependencies,
    acceptance: { criteria: ['Value equals two'], evidence: [] }, handoff: null,
    verification: { risk_tier: 'standard', separation, implementer: null, reviewer: null, candidate_revision: null },
    environment: { cwd: '.', read_paths: ['.'], write_paths: ['src', 'docs'], tools: ['node'], resources: [],
      network: { mode: 'none', hosts: [] }, external_actions: [], data: { classification: 'internal', model_access: 'none', policy_refs: ['approval.json'] } },
    authorization: { approved_by: 'owner', approval_ref: 'approval.json', operations: ['read', 'write', 'execute'], expires_at: expiresAt }, skills: [],
    execution: { runtime: { kind: 'host-owned', adapter_id: null, required_features: [] }, model_connection: { kind: 'native' } } };
  await createNativeTask(root, contract, request(0));
  const claim = await mutateNativeTask(root, 'WK-one', 'claim', request(1, { base_revision: git(root, 'rev-parse', 'HEAD') }));
  await write(root, prose ? 'docs/note.md' : 'src/value.mjs', prose ? 'Spelling\n' : 'export const value = 2;\n');
  git(root, 'add', 'src', 'docs'); git(root, 'commit', '-qm', 'candidate');
  const revision = git(root, 'rev-parse', 'HEAD');
  const evidence = '.ai-org/artifacts/WK-one/developer.md';
  if (delivered) {
    await write(root, evidence, 'Fixture evidence\n');
    await mutateNativeTask(root, 'WK-one', 'handoff', request(2, { claim_id: claim.claim.id, revision, summary: 'Candidate ready', evidence: [evidence], unresolved: [] }));
  }
  return { root, revision, evidence, contract };
}
async function reusable(root) {
  const pin = async ref => ({ path: ref, sha256: sha256(await fs.readFile(path.join(root, ref))) });
  const current = { tests: [await pin('checks/test.mjs')], oracles: [await pin('checks/oracle.json')], inputs: [await pin('checks/input.json')],
    runtime: [{ name: 'node', version: process.versions.node }], tools: [{ name: 'fixture-runner', version: '1' }], packages: [],
    command: 'node checks/test.mjs', configuration: [] };
  const report = await assessNativeTask(root, 'WK-one', input());
  const measurement = { id: 'green', dimensions: { ...report.repository_observed.dimensions, ...structuredClone(current) },
    coverage: [{ criterion: 'Value equals two', extent: 'complete' }], status: 'pass',
    provenance: { kind: 'captured', source: 'offline fixture declaration', actor: builder,
      files: [await pin('capture.log')], completed: true, exit_code: 0 } };
  return input({ current, measurements: [measurement] });
}
async function snapshot(root) {
  const result = {};
  const visit = async ref => {
    for (const entry of await fs.readdir(path.join(root, ref), { withFileTypes: true })) {
      const next = path.join(ref, entry.name);
      if (entry.isDirectory()) await visit(next);
      else result[next] = sha256(await fs.readFile(path.join(root, next)));
    }
  };
  await visit(''); return result;
}

test('actual diff and v1 stricter review floor survive, with a byte-for-byte no-write CLI snapshot', async t => {
  const { root, revision } = await fixture(t, { separation: 'distinct-principal' });
  const before = await snapshot(root);
  const report = await assessNativeTask(root, 'WK-one', input());
  assert.equal(report.route, 'focused-independent-review');
  assert.equal(report.current_review_floor.separation, 'distinct-principal');
  assert.equal(report.current_review_floor.mechanical_owner_acceptance, 'unsupported-in-v1');
  assert.equal(report.repository_observed.dimensions.candidate_revision, revision);
  assert.deepEqual(report.repository_observed.changes.map(c => c.path), ['src/value.mjs']);
  assert.equal(report.execution_authorized, false);
  const run = spawnSync(process.execPath, [cli, 'task', 'assess', root, '--id', 'WK-one'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).route, 'blocked');
  assert.deepEqual(await snapshot(root), before);
});

test('unknown impact remains unresolved; pinned material impact selects elevated review; prose never waives review', async t => {
  const ordinary = await fixture(t, { prose: true });
  const unknown = await assessNativeTask(ordinary.root, 'WK-one');
  assert.equal(unknown.route, 'blocked');
  assert(unknown.reasons.some(r => r.code === 'irreversible-impact-unknown'));
  const prose = await assessNativeTask(ordinary.root, 'WK-one', input());
  assert.equal(prose.route, 'focused-independent-review');
  assert(prose.reasons.some(r => r.code === 'prose-semantics-unresolved'));
  const material = await fixture(t, { impact: 'material' });
  assert.equal((await assessNativeTask(material.root, 'WK-one', input())).route, 'elevated-independent-review');
  await write(ordinary.root, 'unapproved.json', { schema_version: 'workkeel.review-impact/v1', task_id: 'WK-one', approved_by: 'owner', irreversible_impact: 'none' });
  assert.equal((await assessNativeTask(ordinary.root, 'WK-one', input({ impact_ref: 'unapproved.json' }))).route, 'blocked');
});

test('same-tree HEAD can assess delivered A but cannot assess or transplant A measurements to B', async t => {
  const { root, revision } = await fixture(t);
  const measurements = await reusable(root);
  git(root, 'commit', '--allow-empty', '-qm', 'same tree B');
  const b = git(root, 'rev-parse', 'HEAD');
  const a = await assessNativeTask(root, 'WK-one', measurements);
  assert.equal(a.route, 'focused-independent-review');
  assert.equal(a.repository_observed.dimensions.candidate_revision, revision);
  assert.equal(a.repository_observed.head_revision, b);
  assert.equal(a.measurements[0].reuse, 'candidate-for-independent-confirmation');
  const changed = await assessNativeTask(root, 'WK-one', { ...measurements, candidate_revision: b });
  assert.equal(changed.route, 'blocked');
  assert(changed.measurements[0].reasons.includes('candidate_revision-mismatch'));
  await write(root, 'src/value.mjs', 'export const value = 3;\n');
  assert.equal((await assessNativeTask(root, 'WK-one', input())).route, 'blocked');
});

test('handoff assessment still requires current HEAD and actual write bounds', async t => {
  const { root, revision } = await fixture(t, { delivered: false });
  assert.equal((await assessNativeTask(root, 'WK-one', input())).route, 'focused-independent-review');
  git(root, 'commit', '--allow-empty', '-qm', 'B');
  assert.equal((await assessNativeTask(root, 'WK-one', input({ candidate_revision: revision }))).route, 'blocked');
  await write(root, 'outside.mjs', 'outside\n'); git(root, 'add', 'outside.mjs'); git(root, 'commit', '-qm', 'outside');
  const result = await assessNativeTask(root, 'WK-one', input());
  assert(result.reasons.some(r => r.code === 'outside-write-scope'));
});

test('all measurement dimensions invalidate reuse independently and claimed provenance is never trusted proof', async t => {
  const { root } = await fixture(t);
  const good = await reusable(root);
  const result = await assessNativeTask(root, 'WK-one', good);
  assert.equal(result.measurements[0].reuse, 'candidate-for-independent-confirmation');
  assert.match(result.coverage[0].status, /awaiting-independent-confirmation/);
  const edits = {
    candidate_revision: d => d.candidate_revision = 'a'.repeat(40), contract_sha256: d => d.contract_sha256 = 'a'.repeat(64),
    policy_sha256: d => d.policy_sha256 = 'b'.repeat(64), dependency_snapshot_sha256: d => d.dependency_snapshot_sha256 = 'c'.repeat(64),
    tests: d => d.tests[0].sha256 = 'a'.repeat(64), oracles: d => d.oracles[0].sha256 = 'a'.repeat(64),
    inputs: d => d.inputs[0].sha256 = 'a'.repeat(64), runtime: d => d.runtime[0].version = 'other',
    tools: d => d.tools[0].version = 'other', packages: d => d.packages.push({ name: 'new', version: '1' }),
    command: d => d.command = 'other command', configuration: d => d.configuration.push(d.tests[0])
  };
  for (const [dimension, edit] of Object.entries(edits)) {
    const changed = structuredClone(good); edit(changed.measurements[0].dimensions);
    const report = await assessNativeTask(root, 'WK-one', changed);
    assert.equal(report.measurements[0].reuse, 'ineligible', dimension);
    assert(report.measurements[0].reasons.includes(`${dimension}-mismatch`), dimension);
  }
  for (const change of [m => m.status = 'incomplete', m => m.provenance.kind = 'asserted', m => m.provenance.completed = false,
    m => m.provenance.exit_code = null, m => m.provenance.files = [], m => m.coverage[0].extent = 'partial']) {
    const changed = structuredClone(good); change(changed.measurements[0]);
    assert.equal((await assessNativeTask(root, 'WK-one', changed)).measurements[0].reuse, 'ineligible');
  }
  const unknown = structuredClone(good); unknown.current.runtime[0].version = 'unknown'; unknown.measurements[0].dimensions.runtime[0].version = 'unknown';
  assert((await assessNativeTask(root, 'WK-one', unknown)).measurements[0].reasons.includes('runtime-version-unknown'));
});

test('current red defeats old green and failed independent judgment cannot be relabeled', async t => {
  const { root, revision } = await fixture(t);
  const both = await reusable(root);
  both.measurements.push({ ...structuredClone(both.measurements[0]), id: 'red', status: 'fail' });
  const report = await assessNativeTask(root, 'WK-one', both);
  assert.equal(report.route, 'blocked');
  assert(report.measurements.every(m => m.reuse === 'ineligible'));
  assert.equal(report.coverage[0].status, 'failure-reported');
  assert.deepEqual(report.coverage[0].reuse_candidates, []);
  assert.deepEqual(report.coverage[0].failed_measurements, ['red']);
  assert.deepEqual(report.coverage[0].historical_failed_measurements, []);
  assert.equal(report.measurements[1].candidate_revision, revision);
  assert.equal(report.measurements[1].candidate_status, 'current');
  const ref = '.ai-org/artifacts/WK-one/review.md'; await write(root, ref, 'Independent failure\n');
  await mutateNativeTask(root, 'WK-one', 'review', request(3, { revision, judgment: 'fail', summary: 'Counterexample', evidence: [ref] }, reviewer));
  assert((await assessNativeTask(root, 'WK-one', input())).reasons.some(r => r.code === 'failed-independent-review'));
});

test('historical red stays visible without replacing current green coverage', async t => {
  const { root, revision } = await fixture(t);
  const both = await reusable(root), base = git(root, 'rev-parse', `${revision}^`);
  const historical = { ...structuredClone(both.measurements[0]), id: 'old-red', status: 'fail' };
  historical.dimensions.candidate_revision = base;
  both.measurements.push(historical);
  const report = await assessNativeTask(root, 'WK-one', both);
  assert.equal(report.route, 'focused-independent-review');
  assert.equal(report.coverage[0].status, 'declared-coverage-awaiting-independent-confirmation');
  assert.deepEqual(report.coverage[0].failed_measurements, []);
  assert.deepEqual(report.coverage[0].historical_failed_measurements, ['old-red']);
  assert.equal(report.measurements[0].reuse, 'candidate-for-independent-confirmation');
  assert.equal(report.measurements[1].reuse, 'ineligible');
  assert.equal(report.measurements[1].candidate_revision, base);
  assert.equal(report.measurements[1].candidate_status, 'historical');
  assert.equal(report.measurements[1].status, 'fail');
});

test('padded and mixed-case reserved versions are unknown across every declared dimension', async t => {
  const { root } = await fixture(t), good = await reusable(root);
  for (const dimension of ['runtime', 'tools', 'packages']) {
    for (const version of [' unknown ', 'latest ', '* ', '\tunresolved\n', ' UnKnOwN ', '\tLaTeSt\n', ' UNRESOLVED ']) {
      const parameters = structuredClone(good);
      parameters.current[dimension] = [{ name: 'fixture', version }];
      parameters.measurements[0].dimensions[dimension] = [{ name: 'fixture', version }];
      const report = await assessNativeTask(root, 'WK-one', parameters);
      assert.equal(report.measurements[0].reuse, 'ineligible', `${dimension}: ${JSON.stringify(version)}`);
      assert(report.measurements[0].reasons.includes(`${dimension}-version-unknown`));
      assert.equal(report.declarations.current_measurement_environment[dimension][0].version, version);
      assert.equal(report.measurements[0].declared_dimensions[dimension][0].version, version);
    }
  }
});

test('missing evidence, changed policy and capture bytes remain explicit blockers; edited evidence and approval do not', async t => {
  const { root, evidence } = await fixture(t);
  const measurements = await reusable(root);
  await write(root, 'capture.log', 'changed\n');
  assert((await assessNativeTask(root, 'WK-one', measurements)).measurements[0].reasons.includes('capture-bytes-changed:capture.log'));
  const kept = await fs.readFile(path.join(root, evidence));
  await write(root, evidence, 'altered\n');
  assert(!(await assessNativeTask(root, 'WK-one', input())).reasons.some(r => r.code.startsWith('delivery-evidence')));
  await fs.rm(path.join(root, evidence));
  assert((await assessNativeTask(root, 'WK-one', input())).reasons.some(r => r.code === 'delivery-evidence-unavailable'));
  await fs.writeFile(path.join(root, evidence), kept);
  await write(root, 'approval.json', 'changed\n');
  assert(!(await assessNativeTask(root, 'WK-one', input())).reasons.some(r => r.code.startsWith('authority-')));
  await fs.rm(path.join(root, 'approval.json'));
  assert((await assessNativeTask(root, 'WK-one', input())).reasons.some(r => r.code === 'authority-unavailable'));
  await write(root, 'approval.json', 'changed\n');
  const policy = JSON.parse(await fs.readFile(path.join(root, 'workkeel.lock'), 'utf8')); policy.policy.review_separation = 'distinct-principal';
  await write(root, 'workkeel.lock', policy);
  assert((await assessNativeTask(root, 'WK-one', input())).reasons.some(r => r.code === 'policy-changed'));
});

test('malformed/unsupported input and unsafe source paths never produce affirmative findings', async t => {
  const { root } = await fixture(t);
  for (const bad of [null, [], { schema_version: 'v2' }, { unknown: true }, { blockers: [] }, input({ measurements: [{ id: 'bad' }] })]) {
    await assert.rejects(assessNativeTask(root, 'WK-one', bad), /Invalid bounded/);
  }
  const measurements = await reusable(root);
  measurements.measurements[0].dimensions.tests[0].path = '../outside';
  assert.equal((await assessNativeTask(root, 'WK-one', measurements)).measurements[0].reuse, 'ineligible');
  await fs.symlink('approval.json', path.join(root, 'linked.json'));
  assert.equal((await assessNativeTask(root, 'WK-one', input({ impact_ref: 'linked.json' }))).route, 'blocked');
  for (const source of ['../outside', 'linked.json']) {
    const run = spawnSync(process.execPath, [cli, 'task', 'assess', root, '--id', 'WK-one', '--request', source], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
  }
  const unknownCoverage = await reusable(root); unknownCoverage.measurements[0].coverage[0].criterion = 'Unapproved goal';
  await assert.rejects(assessNativeTask(root, 'WK-one', unknownCoverage), /exact approved criteria/);
});

test('accepted dependencies are observed recursively and missing dependency evidence blocks the dependent', async t => {
  const { root, revision, contract } = await fixture(t);
  const ref = '.ai-org/artifacts/WK-one/review.md'; await write(root, ref, 'Independent acceptance\n');
  await mutateNativeTask(root, 'WK-one', 'review', request(3, { revision, judgment: 'pass', summary: 'Accepted', evidence: [ref] }, reviewer));
  await mutateNativeTask(root, 'WK-one', 'close', request(4, { revision, summary: 'Accepted', rollback: 'Revert', evidence: [ref] }));
  await write(root, 'docs/dependent.json', { schema_version: 'workkeel.review-impact/v1', task_id: 'WK-two', approved_by: 'owner', irreversible_impact: 'none' });
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'accepted prerequisite');
  const second = structuredClone(contract); second.id = 'WK-two'; second.dependencies = ['WK-one'];
  second.authorization.approval_ref = 'docs/dependent.json'; second.environment.data.policy_refs = ['docs/dependent.json'];
  await createNativeTask(root, second, request(0));
  await mutateNativeTask(root, 'WK-two', 'claim', request(1, { base_revision: git(root, 'rev-parse', 'HEAD') }));
  const parameters = input({ impact_ref: 'docs/dependent.json' });
  const report = await assessNativeTask(root, 'WK-two', parameters);
  assert.equal(report.route, 'focused-independent-review');
  assert.equal(report.repository_observed.dependencies[0].id, 'WK-one');
  await write(root, ref, 'edited dependency evidence\n');
  assert.equal((await assessNativeTask(root, 'WK-two', parameters)).route, 'focused-independent-review');
  await fs.rm(path.join(root, ref));
  const missing = await assessNativeTask(root, 'WK-two', parameters);
  assert.equal(missing.route, 'blocked');
  assert(missing.reasons.some(r => r.code === 'dependency-evidence-unavailable'));
});

test('supplied commands and Git external diff drivers are not executed', async t => {
  const { root } = await fixture(t);
  const parameters = await reusable(root);
  parameters.current.command = `touch ${path.join(root, 'unexpected-execution')}`;
  parameters.measurements[0].dimensions.command = parameters.current.command;
  git(root, 'config', 'diff.external', parameters.current.command);
  const report = await assessNativeTask(root, 'WK-one', parameters);
  assert.equal(report.route, 'focused-independent-review');
  await assert.rejects(fs.stat(path.join(root, 'unexpected-execution')), { code: 'ENOENT' });
});

test('shared candidate API and assessor API/CLI suppress fsmonitor and preserve every project and Git byte', async t => {
  const { root, revision } = await fixture(t);
  await write(root, '.git/qa-fsmonitor', '#!/bin/sh\nprintf "hook-ran\\n" >> .git/qa-hook-observed\nprintf "token\\000"\n');
  await fs.chmod(path.join(root, '.git/qa-fsmonitor'), 0o755);
  git(root, 'config', 'core.fsmonitor', '.git/qa-fsmonitor');
  // Control: this repository really does execute the configured hook without
  // the hardened reader; the marker is removed before taking the baseline.
  git(root, 'diff', '--name-only', revision);
  assert.match(await fs.readFile(path.join(root, '.git/qa-hook-observed'), 'utf8'), /hook-ran/);
  await fs.unlink(path.join(root, '.git/qa-hook-observed'));
  const before = await snapshot(root), item = await readNativeTask(root, 'WK-one');
  const inspected = await inspectTaskCandidate(root, 'WK-one', { action: 'review',
    request: request(item.version, { revision, evidence: [] }, reviewer) });
  assert.equal(inspected.candidate_files_passed, true);
  assert.equal((await assessNativeTask(root, 'WK-one', input())).route, 'focused-independent-review');
  assert.deepEqual(await snapshot(root), before);
  const run = spawnSync(process.execPath, [cli, 'task', 'assess', root, '--id', 'WK-one'], {
    encoding: 'utf8', env: { ...process.env, GIT_DIR: '/nonexistent-workkeel-git',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: '.git/qa-fsmonitor' }
  });
  assert.equal(run.status, 0, run.stderr);
  const cliReport = JSON.parse(run.stdout);
  assert.equal(cliReport.repository_observed.candidate_inspection.candidate_files_passed, true);
  assert.deepEqual(await snapshot(root), before);
});

test('local and included clean/process filters fail closed before API/CLI worktree inspection can execute them', async t => {
  for (const filter of ['clean', 'process', 'included-clean']) {
    const { root, revision } = await fixture(t);
    await write(root, '.git/qa-filter', '#!/bin/sh\nprintf "filter-ran\\n" >> .git/qa-filter-observed\ncat\n');
    await fs.chmod(path.join(root, '.git/qa-filter'), 0o755);
    await write(root, '.git/info/attributes', 'src/value.mjs filter=qa\n');
    if (filter === 'included-clean') {
      await write(root, '.git/qa-include', '[filter "qa"]\n\tclean = .git/qa-filter\n');
      git(root, 'config', 'include.path', 'qa-include');
    } else git(root, 'config', `filter.qa.${filter}`, '.git/qa-filter');
    await write(root, 'src/value.mjs', 'export const value = 300;\n');
    if (filter !== 'process') {
      git(root, 'diff', '--no-ext-diff', '--no-textconv', '--name-only', revision);
      assert.match(await fs.readFile(path.join(root, '.git/qa-filter-observed'), 'utf8'), /filter-ran/);
      await fs.unlink(path.join(root, '.git/qa-filter-observed'));
    }
    const before = await snapshot(root), item = await readNativeTask(root, 'WK-one');
    await assert.rejects(inspectTaskCandidate(root, 'WK-one', { action: 'review',
      request: request(item.version, { revision, evidence: [] }, reviewer) }), /configured clean\/process filters/);
    const report = await assessNativeTask(root, 'WK-one', input());
    assert.equal(report.route, 'blocked');
    assert(report.reasons.some(r => r.code === 'candidate-unresolved' && /configured clean\/process filters/.test(r.detail)));
    assert.deepEqual(await snapshot(root), before);
    const run = spawnSync(process.execPath, [cli, 'task', 'assess', root, '--id', 'WK-one'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert(JSON.parse(run.stdout).reasons.some(r => r.code === 'candidate-unresolved' && /configured clean\/process filters/.test(r.detail)));
    assert.deepEqual(await snapshot(root), before);
  }
});

test('shared Git observation refuses submodule worktrees instead of invoking their configuration', async t => {
  const { root, revision } = await fixture(t);
  git(root, 'update-index', '--add', '--cacheinfo', `160000,${revision},vendor/submodule`);
  const before = await snapshot(root);
  const report = await assessNativeTask(root, 'WK-one', input());
  assert.equal(report.route, 'blocked');
  assert(report.reasons.some(r => /cannot safely inspect submodule worktrees/.test(r.detail)));
  assert.deepEqual(await snapshot(root), before);
});

test('expired authority and a committed symlink cannot obtain an affirmative route', async t => {
  const expires = Date.now() + 60000;
  const { root } = await fixture(t, { expiresAt: new Date(expires).toISOString(), delivered: false });
  await fs.unlink(path.join(root, 'src/value.mjs'));
  await fs.symlink('../docs/note.md', path.join(root, 'src/value.mjs'));
  git(root, 'add', 'src/value.mjs'); git(root, 'commit', '-qm', 'symlink');
  const symlink = await assessNativeTask(root, 'WK-one', input());
  assert.equal(symlink.route, 'blocked');
  assert(symlink.reasons.some(r => r.code === 'unsupported-candidate-file-type'));
  t.mock.timers.enable({ apis: ['Date'], now: expires + 1 });
  const expired = await assessNativeTask(root, 'WK-one', input());
  assert(expired.reasons.some(r => r.code === 'authority-unresolved' && r.detail.includes('authorization.expired')));
});

test('documented inline API example runs and reports unknown execution without project writes', async t => {
  const { root } = await fixture(t);
  const docs = await fs.readFile(new URL('../docs/operations/workkeel-review-assessment.md', import.meta.url), 'utf8');
  const script = docs.match(/node --input-type=module - \/absolute\/path\/to\/project <<'JS'\n([\s\S]*?)\nJS/)[1].replaceAll('WK-example', 'WK-one');
  const before = await snapshot(root);
  const run = spawnSync(process.execPath, ['--input-type=module', '-', root], {
    cwd: path.dirname(path.dirname(cli)), input: script, encoding: 'utf8'
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.measurements[0].reuse, 'ineligible');
  assert(report.measurements[0].reasons.includes('measurement-unknown'));
  assert.deepEqual(await snapshot(root), before);
});
