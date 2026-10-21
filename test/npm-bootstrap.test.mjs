import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { checkPublishedPackage } from '../scripts/check-published-npm.mjs';

const packageDocument = { name: '@zsz1210/workkeel', version: '0.1.0-beta.1' };
const asset = Buffer.from('frozen qualified archive bytes');
const digest = algorithm => createHash(algorithm).update(asset).digest(algorithm === 'sha512' ? 'base64' : 'hex');
const tarball = 'https://registry.npmjs.org/@zsz1210/workkeel/-/workkeel-0.1.0-beta.1.tgz';
const metadata = () => ({ ...packageDocument, dist: { integrity: `sha512-${digest('sha512')}`, shasum: digest('sha1'), tarball } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
function check(responses, options = {}) {
  let calls = 0, endpoint = 0;
  return checkPublishedPackage({ packageDocument, asset, channel: 'next', wait: async () => assert.fail('unexpected wait'), ...options,
    request: async (url, settings) => {
      assert.equal(settings.redirect, 'error');
      assert.equal(url, [
        'https://registry.npmjs.org/%40zsz1210%2Fworkkeel/0.1.0-beta.1',
        tarball,
        'https://registry.npmjs.org/%40zsz1210%2Fworkkeel'
      ][endpoint]);
      const response = responses[calls++];
      if (response instanceof Error) throw response;
      assert.ok(response, 'unexpected extra request');
      if (endpoint !== 0 || response.status !== 404) endpoint++;
      return response;
    }
  });
}
const channel = () => json({ name: packageDocument.name, 'dist-tags': { next: packageDocument.version } });

test('bootstrap skips only exact identity, two hashes, archive bytes and channel', async () => {
  const result = await check([json(metadata()), new Response(asset), channel()]);
  assert.equal(result.action, 'skip');
  assert.equal(result.archive_sha256, digest('sha256'));
});
test('absent version permits publish intent but cannot satisfy required publication', async () => {
  const waits = [], wait = async delay => { waits.push(delay); };
  assert.equal((await check([json({ error: 'Not found' }, 404)], { wait })).action, 'publish');
  assert.deepEqual(waits, []);
  await assert.rejects(check(Array.from({ length: 9 }, () => json({}, 404)), { requirePublished: true, wait }), /absent/);
  assert.deepEqual(waits, [5000, 10000, 20000, 40000, 60000, 60000, 60000, 45000]);
  assert.equal(waits.reduce((total, delay) => total + delay, 0), 300000);
});
test('required publication waits for metadata acquisition then verifies the exact archive and channel', async () => {
  const waits = [];
  const result = await check([json({}, 404), json({}, 404), json(metadata()), new Response(asset), channel()], {
    requirePublished: true, wait: async delay => { waits.push(delay); }
  });
  assert.equal(result.action, 'skip');
  assert.equal(result.archive_sha256, digest('sha256'));
  assert.deepEqual(waits, [5000, 10000]);
});
test('acquisition stops waiting immediately on a non-404 failure after a 404', async () => {
  const waits = [];
  await assert.rejects(check([json({}, 404), json({}, 500)], {
    requirePublished: true, wait: async delay => { waits.push(delay); }
  }), /HTTP 500/);
  assert.deepEqual(waits, [5000]);
});
for (const requirePublished of [false, true]) {
test(`authentication, throttling, server and network failures fail closed (required=${requirePublished})`, async () => {
  for (const status of [401, 403, 429, 500]) await assert.rejects(check([json({}, status)], { requirePublished }), /HTTP/);
  await assert.rejects(check([new Error('offline')], { requirePublished }), /offline/);
  await assert.rejects(check([new Response('invalid JSON')], { requirePublished }), /JSON/);
});
test(`same version with different metadata or integrity never skips (required=${requirePublished})`, async () => {
  for (const mutate of [m => { m.name = '@other/package'; }, m => { m.version = '0.1.0-beta.2'; },
    m => { m.dist.integrity = 'sha512-wrong'; }, m => { m.dist.shasum = 'wrong'; },
    m => { delete m.dist.integrity; }, m => { m.dist.tarball += '?redirect=1'; },
    m => { m.dist.tarball = 'https://example.com/archive.tgz'; }]) {
    const value = metadata(); mutate(value);
    await assert.rejects(check([json(value)], { requirePublished }), /mismatch/);
  }
});
test(`metadata hashes cannot substitute for comparing downloaded bytes (required=${requirePublished})`, async () => {
  for (const bytes of [Buffer.alloc(asset.length), asset.subarray(1), Buffer.concat([asset, Buffer.from('x')])]) {
    await assert.rejects(check([json(metadata()), new Response(bytes)], { requirePublished }), /bytes mismatch|bound/);
  }
  await assert.rejects(check([json(metadata()), json({}, 403)], { requirePublished }), /archive failed/);
});
test(`existing exact archive still requires the intended dist-tag (required=${requirePublished})`, async () => {
  await assert.rejects(check([json(metadata()), new Response(asset), json({ name: packageDocument.name, 'dist-tags': { next: '0.1.0-beta.2' } })], { requirePublished }), /channel mismatch/);
  await assert.rejects(check([json(metadata()), new Response(asset), json({}, 500)], { requirePublished }), /channel failed/);
});
}
