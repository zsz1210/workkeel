import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateRoots = new Set([
  '.ai-org', '.codex', '.workkeel-private', '.temple-tmp', 'output', 'coverage',
  'private', 'backups', 'workkeel.md', 'workkeel.lock', 'workkeelw.mjs',
  'temple.md', 'temple.lock', 'templew.mjs'
]);
const privateFiles = /^(?:\.env(?:\..*)?|\.npmrc|id_rsa|id_ed25519|credentials(?:\..*)?|.*\.(?:log|jsonl|bundle|tgz|zip))$/i;

// Check names only: never read private contents or follow a data symlink.
export function checkSourceCheckout(cwd = root) {
  const failures = fs.readdirSync(cwd).filter(name =>
    privateRoots.has(name.toLowerCase()) || privateFiles.test(name)
  ).sort().map(name => ({path: name, rule: 'private-state-in-public-checkout'}));
  return {
    schema_version: 'workkeel.source-checkout-check/v1',
    passed: failures.length === 0,
    failures,
    limitations: ['Known root paths only; review all public content and outgoing Git history separately.']
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw Error('Usage: check-source-checkout.mjs');
    const report = checkSourceCheckout();
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error('Source checkout check failed: ' + error.message);
    process.exitCode = 1;
  }
}
