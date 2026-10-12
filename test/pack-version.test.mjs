import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePackVersions, listPackDefinitions } from '../src/packs.mjs';
import { TEMPLATE_VERSION } from '../src/constants.mjs';
import { compareTempleVersions, baselineMigrationState, readMigrationRegistry } from '../src/migrations.mjs';

test('pack compatibility orders Alpha, Beta and stable releases numerically', () => {
  assert.equal(comparePackVersions('0.1.0-alpha.99', '0.1.0-beta.1'), -1);
  assert.equal(comparePackVersions('0.1.0-beta.2', '0.1.0-beta.10'), -1);
  assert.equal(comparePackVersions('0.1.0-beta.10', '0.1.0'), -1);
  assert.equal(comparePackVersions('0.2.0-alpha.1', '0.1.0'), 1);
  assert.equal(comparePackVersions('0.1.0-beta.1', '0.1.0-beta.1'), 0);
  assert.equal(comparePackVersions('0.1.0-beta.1', '0.1.0-alpha.34'), 1);
  assert.equal(comparePackVersions('0.1.0-unknown.1', '0.1.0'), null);
  assert.equal(comparePackVersions('0.1.0-beta.9007199254740992', '0.1.0'), null);
});

test('migration baseline includes prior Alpha changes in Beta and preserves stable ordering', async () => {
  assert.equal(compareTempleVersions('0.1.0-alpha.99', '0.1.0-beta.1'), -1);
  assert.equal(compareTempleVersions('0.1.0-beta.2', '0.1.0-beta.10'), -1);
  assert.equal(compareTempleVersions('0.1.0-beta.10', '0.1.0'), -1);
  assert.throws(() => compareTempleVersions('0.1.0-unknown.1', '0.1.0'), /Unsupported/);
  const baseline = await baselineMigrationState('2026-10-03T00:00:00.000Z');
  const registry = await readMigrationRegistry();
  assert.equal(baseline.baseline_version, TEMPLATE_VERSION);
  assert.deepEqual(baseline.applied.map(x => x.id), registry.migrations.map(x => x.id));
});

test('bundled packs remain within their declared framework range for this release', async () => {
  const packs = await listPackDefinitions();
  assert.ok(packs.length > 0);
  for (const { manifest: pack } of packs) {
    assert.ok(comparePackVersions(TEMPLATE_VERSION, pack.compatibility.temple.min) >= 0);
    assert.equal(comparePackVersions(TEMPLATE_VERSION, pack.compatibility.temple.max_exclusive), -1);
  }
});
