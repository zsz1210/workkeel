import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { formatJson, sha256 } from './files.mjs';
import { readTaskContractInput } from './task-contract.mjs';
import { existsEntry, safeDirectory } from './workkeel-project.mjs';

// Read-only access to 0.1.0-beta.1 projects for statistics only. Lifecycle
// commands keep their version check; nothing here writes, migrates or upgrades.
export const LEGACY_PROJECT_SCHEMA = 'workkeel.project/v1';
export const LEGACY_CLI_VERSION = '0.1.0-beta.1';
const TASK_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.json$/;
const digest = value => sha256(formatJson(value));

/**
 * Backup rule for a directory or file name. `backup` or `backups` (any case) is a
 * backup directory. A name that ends with `.bak` or `.backup` (any case), with or
 * without a trailing `.`, `_` or `-` label such as `.bak-2026`, or that ends with
 * `~`, is a backup copy. Other names, such as `WK-backup-check`, do not match.
 * Returns the matched rule or null.
 */
export function backupRule(name) {
  if (/^backups?$/i.test(name)) return 'backup-directory';
  if (/\.(?:bak|backup)(?:[._-][A-Za-z0-9._-]*)?$/i.test(name) || name.endsWith('~')) return 'backup-suffix';
  return null;
}
/** The rule for a task store entry. A `<task-id>.json` file is always a task record. */
export function backupEntryRule(name) { return TASK_FILE.test(name) ? null : backupRule(name); }
export function backupPathRule(file) {
  for (const segment of path.resolve(file).split(path.sep)) { const rule = backupRule(segment); if (rule) return rule; }
  return null;
}

/** True when workkeel.lock is the 0.1.0-beta.1 project schema. Never throws. */
export async function isLegacyStatsProject(target) {
  try { return (await readTaskContractInput(target, 'workkeel.lock')).document?.schema_version === LEGACY_PROJECT_SCHEMA; }
  catch { return false; }
}

// The 0.1.0-beta.1 record format, frozen from that release's task-contract.mjs
// and workkeel-tasks.mjs. Every object rejects fields that release did not write.
const text = { type: 'string', minLength: 1, pattern: '\\S' };
const strings = { type: 'array', items: text, uniqueItems: true };
const nonempty = { ...strings, minItems: 1 };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const choice = (...values) => ({ enum: values });
const object = (properties, optional = []) => ({ type: 'object', properties, additionalProperties: false,
  required: Object.keys(properties).filter(key => !optional.includes(key)) });
const identifier = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const identifiers = { type: 'array', items: identifier, uniqueItems: true };
const revision = { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const time = { type: 'string', format: 'date-time' };
const contractActor = object({ agent_id: identifier, principal_id: nullable(identifier) });
const contractSchema = object({
  schema_version: { const: 'workkeel.task-contract/v1' }, id: identifier, goal: text,
  scope: object({ include: nonempty, exclude: strings }), actor: nullable(contractActor),
  state: choice('intake', 'spec', 'design', 'build', 'test', 'eval', 'independent_qa', 'release_gate', 'done', 'concluded', 'blocked', 'cancelled'),
  dependencies: identifiers,
  acceptance: object({ criteria: nonempty, evidence: strings }),
  verification: object({
    risk_tier: nullable(choice('low', 'standard', 'high', 'critical')),
    separation: choice('unresolved', 'distinct-agent', 'distinct-principal', 'none'),
    implementer: nullable(contractActor), reviewer: nullable(contractActor), candidate_revision: nullable(revision)
  }),
  handoff: nullable(object({
    from_actor: nullable(contractActor), to_actor: nullable(contractActor), revision,
    summary: nullable(text), evidence: nonempty, unresolved: strings, next_action: nullable(text)
  })),
  environment: nullable(object({
    cwd: text, read_paths: strings, write_paths: strings, tools: identifiers, resources: identifiers,
    network: object({ mode: choice('none', 'allowlist'), hosts: strings }),
    external_actions: identifiers,
    data: object({ classification: choice('public', 'internal', 'sensitive'), model_access: choice('none', 'approved-connection'), policy_refs: nonempty })
  })),
  authorization: nullable(object({
    approved_by: identifier, approval_ref: text,
    operations: { type: 'array', uniqueItems: true, items: choice('read', 'write', 'execute', 'network', 'external'), minItems: 1 },
    expires_at: nullable(time)
  })),
  skills: strings,
  execution: object({
    runtime: object({ kind: choice('host-owned', 'adapter'), adapter_id: nullable(identifier), required_features: identifiers }),
    model_connection: { oneOf: [object({ kind: { const: 'native' } }), object({ kind: { const: 'policy' }, policy_ref: text }),
      object({ kind: { const: 'codex-subscription' }, model: identifier, effort: choice('low', 'medium', 'high', 'xhigh', 'max', 'ultra') }),
      object({ kind: { const: 'gateway' }, provider: choice('litellm', 'openai-compatible'), base_url: text, model: text, selection: { const: 'fixed' },
        credential_env: { type: 'string', pattern: '^[A-Z_][A-Z0-9_]*$' } })] }
  }),
  legacy: nullable(object({ schema_version: { const: 'temple.work-item/v1' }, source_ref: text, source_sha256: sha, owner_position: nullable(text), assigned_agent_id: nullable(text) }))
});
const actor = object({ agent_id: identifier, principal_id: identifier });
const pins = { type: 'array', minItems: 1, items: object({ path: text, sha256: sha }) };
const claim = object({ id: text, actor, at: time });
const delivery = object({ revision, summary: text, implementer: actor, claim_id: text, evidence: pins });
const review = object({ actor, revision, judgment: choice('pass', 'fail'), summary: text, evidence: pins });
const STATES = ['intake', 'build', 'test', 'release_gate', 'done', 'cancelled'];
const event = object({ sequence: { type: 'integer', minimum: 1 }, action: choice('create', 'claim', 'release', 'handoff', 'review', 'rework', 'close', 'cancel'),
  operation_id: text, request_sha256: sha, actor, at: time, state: choice(...STATES), revision: nullable(revision),
  previous_hash: nullable(sha), record_sha256: sha, hash: sha, summary: text, judgment: choice('pass', 'fail') }, ['summary', 'judgment']);
const recordSchema = object({
  schema_version: { const: 'workkeel.work-item/v1' }, id: identifier, version: { type: 'integer', minimum: 1 }, state: choice(...STATES),
  contract: contractSchema, contract_sha256: sha, policy_sha256: sha, authority_pins: pins, claim: nullable(claim),
  base_revision: nullable(revision),
  dependency_pins: nullable({ type: 'array', items: object({ id: identifier, version: { type: 'integer', minimum: 1 }, revision, record_sha256: sha }) }),
  delivery: nullable(delivery), review: nullable(review),
  closeout: nullable({ oneOf: [
    object({ actor, revision, summary: text, rollback: text, evidence: pins, external_release: { const: 'not-performed' } }),
    object({ actor, summary: text, evidence: pins, external_release: { const: 'not-performed' } })] }),
  attempts: { type: 'array', items: { oneOf: [
    object({ kind: { const: 'rejected' }, base_revision: nullable(revision), delivery, review, summary: text }),
    object({ kind: { const: 'released' }, claim, base_revision: nullable(revision), summary: text })] } },
  history: { type: 'array', minItems: 1, items: event }
});
const ajv = new Ajv({ strict: true, allErrors: true, ownProperties: true });
addFormats(ajv);
const validateRecord = ajv.compile(recordSchema);
const describe = error => `${error.instancePath || '/'} ${error.message}${error.params?.additionalProperty ? ` (${error.params.additionalProperty})` : ''}`;

/**
 * Checks one legacy record against the 0.1.0-beta.1 format and returns the
 * fields stats needs. Throws a specific message for any part it does not
 * understand; it never fills gaps.
 */
export function legacyStatsTask(item, id) {
  if (!validateRecord(item)) throw Error(`Legacy task record does not match the ${LEGACY_CLI_VERSION} format: ${validateRecord.errors.slice(0, 3).map(describe).join('; ')}`);
  if (item.id !== id || item.contract.id !== id) throw Error('Legacy task record ID does not match its file name');
  if (digest(item.contract) !== item.contract_sha256) throw Error('Legacy task contract digest does not match');
  if (!item.contract.actor?.principal_id || !item.contract.verification.risk_tier) throw Error('Legacy task contract has no readable actor or risk tier');
  if (item.history.length !== item.version) throw Error('Legacy task history length does not match its version');
  let previous = null;
  for (const [index, entry] of item.history.entries()) {
    const { hash, ...body } = entry;
    if (entry.sequence !== index + 1 || entry.previous_hash !== previous || hash !== digest(body)) throw Error('Legacy task history integrity failure');
    if (Object.hasOwn(entry, 'judgment') !== (entry.action === 'review')) throw Error(`Legacy history entry ${index + 1} has a review judgment that does not match its action`);
    previous = hash;
  }
  const { history, ...rest } = item;
  if (history.at(-1).record_sha256 !== digest(rest)) throw Error('Legacy task state differs from its recorded operation');
  if (history.at(-1).state !== item.state) throw Error('Legacy task state differs from its last history entry');
  // Only the fields the stats observation reads.
  return { id, state: item.state, contract: { actor: item.contract.actor, verification: { risk_tier: item.contract.verification.risk_tier } },
    delivery: item.delivery, review: item.review, attempts: item.attempts, history };
}

/**
 * Lists a legacy project's task records for stats. Backup entries are skipped
 * and reported; any other unknown entry is an error, not a guess.
 */
export async function readLegacyStatsSource(target, read = fn => fn()) {
  const lock = (await read(() => readTaskContractInput(target, 'workkeel.lock'))).document;
  if (lock?.schema_version !== LEGACY_PROJECT_SCHEMA || lock.cli?.package_name !== '@zsz1210/workkeel' || lock.cli?.version !== LEGACY_CLI_VERSION)
    throw Error(`Legacy project pin is not ${LEGACY_CLI_VERSION}; it is not read for stats`);
  const result = { cli_version: lock.cli.version, items: [], errors: [], excluded: [] };
  if (await existsEntry(target, '.ai-org/goals')) result.errors.push({ source: '.ai-org/goals', message: 'Legacy goal state is not read for stats; check history is unknown' });
  if (!await existsEntry(target, '.ai-org/work-items')) return result;
  const dir = await safeDirectory(target, '.ai-org/work-items');
  for (const entry of (await read(() => fs.readdir(dir))).sort()) {
    const rule = backupEntryRule(entry);
    if (rule) { result.excluded.push({ path: `.ai-org/work-items/${entry}`, rule }); continue; }
    if (!TASK_FILE.test(entry)) { result.errors.push({ path: `.ai-org/work-items/${entry}`, message: 'Unexpected file in legacy task store' }); continue; }
    const id = entry.slice(0, -5);
    try { result.items.push(legacyStatsTask((await read(() => readTaskContractInput(target, `.ai-org/work-items/${entry}`))).document, id)); }
    catch (error) { result.errors.push({ task_id: id, message: error.message }); }
  }
  return result;
}
