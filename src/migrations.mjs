import path from "node:path";
import { PROJECT_OVERLAY_ROOT, TEMPLATE_VERSION } from "./constants.mjs";
import { pathExists, readJson } from "./files.mjs";

export const MIGRATION_REGISTRY_SCHEMA = "temple.migrations/v1";
export const MIGRATION_REGISTRY_RELATIVE_PATH = ".ai-org/core/migrations.json";

function versionParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/.exec(String(value));
  if (!match) throw new Error(`Unsupported Temple version in migration state: ${value}`);
  const parts = match.slice(1, 4).map(Number);
  parts.push(match[4] === undefined ? 2 : match[4] === 'beta' ? 1 : 0, Number(match[5] ?? 0));
  if (!parts.every(Number.isSafeInteger)) throw new Error(`Unsupported Temple version in migration state: ${value}`);
  return parts;
}

export function compareTempleVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

export async function readMigrationRegistry(target = null) {
  const installedPath = target ? path.join(target, MIGRATION_REGISTRY_RELATIVE_PATH) : null;
  const registryPath = installedPath && await pathExists(installedPath)
    ? installedPath
    : path.join(PROJECT_OVERLAY_ROOT, MIGRATION_REGISTRY_RELATIVE_PATH);
  const registry = await readJson(registryPath);
  if (registry.schema_version !== MIGRATION_REGISTRY_SCHEMA || !Array.isArray(registry.migrations)) {
    throw new Error("Invalid Temple migration registry");
  }
  return registry;
}

export async function baselineMigrationState(installedAt) {
  const registry = await readMigrationRegistry();
  return {
    registry_schema: registry.schema_version,
    baseline_version: TEMPLATE_VERSION,
    applied: registry.migrations
      .filter((entry) => compareTempleVersions(entry.introduced_in, TEMPLATE_VERSION) <= 0)
      .map((entry) => ({ id: entry.id, applied_at: installedAt, mode: "baseline" }))
  };
}

export async function buildMigrationPlan(target, lock = null) {
  const currentLock = lock ?? await readJson(path.join(target, "temple.lock"));
  const registry = await readMigrationRegistry();
  const applied = new Set((currentLock.migrations?.applied ?? []).map((entry) => entry.id));
  const pending = registry.migrations.filter(
    (entry) =>
      compareTempleVersions(entry.introduced_in, currentLock.template.version) > 0 &&
      compareTempleVersions(entry.introduced_in, TEMPLATE_VERSION) <= 0 &&
      !applied.has(entry.id)
  );
  return {
    schema_version: "temple.migration-plan/v1",
    project_id: currentLock.project_id,
    from_version: currentLock.template.version,
    to_version: TEMPLATE_VERSION,
    registry_schema: registry.schema_version,
    pending,
    project_owned_content_changed: false,
    external_action_performed: false
  };
}

export function applyMigrationPlanToLock(lock, plan, appliedAt) {
  const existing = lock.migrations?.applied ?? [];
  return {
    registry_schema: plan.registry_schema,
    baseline_version: lock.migrations?.baseline_version ?? lock.template.version,
    applied: [
      ...existing,
      ...plan.pending.map((entry) => ({ id: entry.id, applied_at: appliedAt, mode: entry.mode }))
    ]
  };
}
