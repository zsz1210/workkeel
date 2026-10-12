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
  let calls = 0;
  return checkPublishedPackage({ packageDocument, asset, channel: 'next', ...options,
    request: async (url, settings) => {
      assert.equal(settings.redirect, 'error');
      assert.equal(url, [
        'https://registry.npmjs.org/%40zsz1210%2Fworkkeel/0.1.0-beta.1',
        tarball,
        'https://registry.npmjs.org/%40zsz1210%2Fworkkeel'
      ][calls]);
      const response = responses[calls++];
      if (response instanceof Error) throw response;
      assert.ok(response, 'unexpected extra request');
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
  assert.equal((await check([json({ error: 'Not found' }, 404)])).action, 'publish');
  await assert.rejects(check([json({}, 404)], { requirePublished: true }), /absent/);
});
test('authentication, throttling, server and network failures fail closed', async () => {
  for (const status of [401, 403, 429, 500]) await assert.rejects(check([json({}, status)]), /HTTP/);
  await assert.rejects(check([new Error('offline')]), /offline/);
  await assert.rejects(check([new Response('invalid JSON')]), /JSON/);
});
test('same version with different metadata or integrity never skips', async () => {
  for (const mutate of [m => { m.name = '@other/package'; }, m => { m.version = '0.1.0-beta.2'; },
    m => { m.dist.integrity = 'sha512-wrong'; }, m => { m.dist.shasum = 'wrong'; },
    m => { delete m.dist.integrity; }, m => { m.dist.tarball += '?redirect=1'; },
    m => { m.dist.tarball = 'https://example.com/archive.tgz'; }]) {
    const value = metadata(); mutate(value);
    await assert.rejects(check([json(value)]), /mismatch/);
  }
});
test('metadata hashes cannot substitute for comparing downloaded bytes', async () => {
  for (const bytes of [Buffer.alloc(asset.length), asset.subarray(1), Buffer.concat([asset, Buffer.from('x')])]) {
    await assert.rejects(check([json(metadata()), new Response(bytes)]), /bytes mismatch|bound/);
  }
  await assert.rejects(check([json(metadata()), json({}, 403)]), /archive failed/);
});
test('existing exact archive still requires the intended dist-tag', async () => {
  await assert.rejects(check([json(metadata()), new Response(asset), json({ name: packageDocument.name, 'dist-tags': { next: '0.1.0-beta.2' } })]), /channel mismatch/);
  await assert.rejects(check([json(metadata()), new Response(asset), json({}, 500)]), /channel failed/);
});
