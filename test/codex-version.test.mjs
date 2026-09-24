import test from 'node:test';
import assert from 'node:assert/strict';
import {codexVersionAtLeast} from '../src/workkeel-codex-host.mjs';

test('accepts minimum and newer semantic versions', () => {
  for (const value of [
    'codex-cli 0.155.0-alpha.9.2',
    'codex-cli 0.155.0-alpha.9.2+build.1',
    'codex-cli 0.155.0-alpha.9.3',
    'codex-cli 0.155.0-alpha.10.0',
    'codex-cli 0.155.0-alpha.16.3',
    'codex-cli 0.155.0-beta.1',
    'codex-cli 0.155.0',
    'codex-cli 0.156.0-alpha.0',
  ]) assert.equal(codexVersionAtLeast(value), true, value);
});

test('rejects older, malformed and unrelated version strings', () => {
  for (const value of [
    'codex-cli 0.155.0-alpha.9.1',
    'codex-cli 0.155.0-alpha.9',
    'codex-cli 0.155.0-alpha.8.100',
    'codex-cli 0.154.999',
    'codex-cli 0.155.0-alpha.09.2',
    'codex-cli 0.155.0-alpha.9.2 extra',
    'other-cli 0.155.0-alpha.16.3',
    '',
  ]) assert.equal(codexVersionAtLeast(value), false, value);
});
