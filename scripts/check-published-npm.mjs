import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org';
const hash = (algorithm, bytes, encoding) => createHash(algorithm).update(bytes).digest(encoding);

async function boundedBody(response, limit) {
  if (!response.body) throw Error('Registry response has no body');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw Error('Registry response exceeds expected bound');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function checkPublishedPackage({ packageDocument, asset, channel, requirePublished = false, request = fetch }) {
  const { name, version } = packageDocument;
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name ?? '') ||
      !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version ?? '') ||
      !['next', 'latest'].includes(channel) || !Buffer.isBuffer(asset) || !asset.length) throw Error('Invalid publication check input');
  const get = url => request(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  const response = await get(`${registry}/${encodeURIComponent(name)}/${version}`);
  if (response.status === 404) {
    if (requirePublished) throw Error('Required published version is absent');
    return { action: 'publish', package_name: name, package_version: version, registry_status: 'version-absent' };
  }
  if (response.status !== 200) throw Error(`Registry metadata failed: HTTP ${response.status}`);
  const metadata = JSON.parse((await boundedBody(response, 4 * 1024 * 1024)).toString('utf8'));
  if (metadata.name !== name || metadata.version !== version) throw Error('Registry package identity mismatch');
  const integrity = `sha512-${hash('sha512', asset, 'base64')}`, shasum = hash('sha1', asset, 'hex');
  if (metadata.dist?.integrity !== integrity || metadata.dist?.shasum !== shasum) throw Error('Registry integrity mismatch');
  const tarball = `${registry}/${name}/-/${name.split('/')[1]}-${version}.tgz`;
  if (metadata.dist?.tarball !== tarball) throw Error('Registry tarball URL mismatch');
  const archiveResponse = await get(tarball);
  if (archiveResponse.status !== 200) throw Error(`Registry archive failed: HTTP ${archiveResponse.status}`);
  const downloaded = await boundedBody(archiveResponse, asset.length);
  if (!downloaded.equals(asset)) throw Error('Registry archive bytes mismatch');
  const packageResponse = await get(`${registry}/${encodeURIComponent(name)}`);
  if (packageResponse.status !== 200) throw Error(`Registry channel failed: HTTP ${packageResponse.status}`);
  const current = JSON.parse((await boundedBody(packageResponse, 4 * 1024 * 1024)).toString('utf8'));
  if (current.name !== name || current['dist-tags']?.[channel] !== version) throw Error('Registry channel mismatch');
  return { action: 'skip', package_name: name, package_version: version, channel, registry_status: 'exact-published-asset', archive_sha256: hash('sha256', asset, 'hex'), integrity };
}

async function main(args) {
  const allowed = new Set(['--package-json', '--asset', '--channel', '--github-output']);
  const options = {}; let requirePublished = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--require-published' && !requirePublished) { requirePublished = true; continue; }
    if (!allowed.has(args[i]) || options[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Invalid publication check arguments');
    options[args[i]] = args[++i];
  }
  if (!options['--package-json'] || !options['--asset'] || !options['--channel']) throw Error('Package, asset and channel are required');
  const result = await checkPublishedPackage({ packageDocument: JSON.parse(await fs.readFile(options['--package-json'], 'utf8')), asset: await fs.readFile(options['--asset']), channel: options['--channel'], requirePublished });
  if (options['--github-output']) await fs.appendFile(options['--github-output'], `action=${result.action}\n`);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(`Publication verification failed: ${error.message}`); process.exitCode = 1; }
}
