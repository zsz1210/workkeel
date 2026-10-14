import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readAllowlist} from './check-publication.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateRoots = new Set([
  '.ai-org', '.codex', '.workkeel-private', '.temple-tmp', '.git', 'node_modules', 'output', 'coverage',
  'private', 'backups', 'workkeel.md', 'workkeel.lock', 'workkeelw.mjs',
  'temple.md', 'temple.lock', 'templew.mjs'
]);
const privateFiles = /^(?:\.env(?:\..*)?|\.npmrc|id_rsa|id_ed25519|credentials(?:\..*)?|.*\.(?:log|jsonl|bundle|tgz|zip))$/i;

// Check names recursively: never read private contents or follow a data symlink.
export function checkSourceCheckout(cwd = root) {
  const allowed = readAllowlist(cwd), publicDirectories = new Set(), failures = [];
  for (const file of allowed) {
    let parent = path.posix.dirname(file);
    while (parent !== '.') {
      publicDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  let entriesRead = 0;
  function walk(directory = '', insidePrivatePath = false, depth = 0) {
    if (depth > 64) throw Error('Checkout directory depth exceeds inspection limit');
    for (const entry of fs.readdirSync(path.join(cwd, directory), {withFileTypes: true})) {
      const relative = directory ? directory + '/' + entry.name : entry.name;
      // Git metadata and installed root dependencies are not publication inputs.
      if (!directory && ['.git', 'node_modules'].includes(entry.name)) continue;
      if (++entriesRead > 100000) throw Error('Checkout entry count exceeds inspection limit');
      if (entry.isSymbolicLink()) {
        failures.push({path: relative, rule: 'symlink-in-public-checkout'});
        continue;
      }
      const privatePath = insidePrivatePath || privateRoots.has(entry.name.toLowerCase()) || privateFiles.test(entry.name);
      const reviewed = entry.isDirectory() ? publicDirectories.has(relative) : allowed.has(relative);
      if (privatePath && !reviewed) {
        failures.push({path: relative, rule: 'private-state-in-public-checkout'});
        continue;
      }
      if (entry.isDirectory()) walk(relative, privatePath, depth + 1);
    }
  }
  walk();
  failures.sort((a, b) => a.path.localeCompare(b.path));
  return {
    schema_version: 'workkeel.source-checkout-check/v1',
    passed: failures.length === 0,
    failures,
    limitations: ['Known private path names and symlinks outside Git metadata and root dependencies; review content and outgoing Git history separately.']
  };
}

let directInvocation=false;
try{directInvocation=!!process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url));}catch{}
if (directInvocation) {
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
