import path from "node:path";
import { atomicCreate, atomicWrite, formatJson, pathExists, readJson, sha256 } from "./files.mjs";
import { buildRetrievalCorpus, createRepositoryRetrievalProvider } from "./context.mjs";

export const RETRIEVAL_CONFIG_RELATIVE_PATH = ".ai-org/project/retrieval.json";
export const RETRIEVAL_EVALUATION_VIEW = ".ai-org/views/retrieval-evaluation.json";

export function emptyRetrievalConfig() {
  return {
    schema_version: "temple.retrieval-config/v1",
    selected_provider: "repository-deterministic",
    deterministic: { enabled: true, provider_id: "repository-deterministic" },
    local_hybrid: {
      status: "available_not_configured",
      provider_id: null,
      command: null,
      privacy: "local-only",
      deterministic_fallback: true
    },
    installs_model: false,
    installs_embeddings: false,
    installs_vector_database: false,
    installs_daemon: false,
    remote_search_enabled: false
  };
}

export function validateRetrievalConfig(config) {
  const errors = [];
  if (config?.schema_version !== "temple.retrieval-config/v1") errors.push("invalid schema_version");
  if (config?.selected_provider !== "repository-deterministic") errors.push("only repository-deterministic may be selected without explicit evaluated configuration");
  if (config?.deterministic?.enabled !== true || config?.deterministic?.provider_id !== "repository-deterministic") errors.push("deterministic provider must remain enabled");
  if (!['available_not_configured', 'configured_unvalidated', 'validated'].includes(config?.local_hybrid?.status)) errors.push("local_hybrid.status is invalid");
  if (config?.local_hybrid?.privacy !== "local-only" || config?.local_hybrid?.deterministic_fallback !== true) errors.push("local hybrid must be local-only with deterministic fallback");
  for (const field of ["installs_model", "installs_embeddings", "installs_vector_database", "installs_daemon", "remote_search_enabled"]) {
    if (config?.[field] !== false) errors.push(`${field} must be false in the default contract`);
  }
  return { valid: errors.length === 0, errors };
}

export async function ensureRetrievalConfig(target) {
  const configPath = path.join(target, RETRIEVAL_CONFIG_RELATIVE_PATH);
  if (await pathExists(configPath)) return { path: configPath, created: false, afterHash: null };
  const content = formatJson(emptyRetrievalConfig());
  try {
    await atomicCreate(configPath, content);
    return { path: configPath, created: true, afterHash: sha256(content) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { path: configPath, created: false, afterHash: null };
  }
}

export async function readRetrievalConfig(target) {
  const configPath = path.join(target, RETRIEVAL_CONFIG_RELATIVE_PATH);
  return await pathExists(configPath) ? readJson(configPath) : emptyRetrievalConfig();
}

function validateEvaluationFixture(fixture) {
  const errors = [];
  if (fixture?.schema_version !== "temple.retrieval-evaluation/v1") errors.push("invalid schema_version");
  if (!Array.isArray(fixture?.cases) || fixture.cases.length === 0) return { valid: false, errors: [...errors, "cases must be non-empty"] };
  const ids = new Set();
  for (const [index, item] of fixture.cases.entries()) {
    const label = `cases[${index}]`;
    if (typeof item?.id !== "string" || !item.id || ids.has(item.id)) errors.push(`${label}.id is invalid or duplicated`);
    ids.add(item?.id);
    if (!["context-route", "learning", "capability"].includes(item?.kind)) errors.push(`${label}.kind is invalid`);
    if (typeof item?.query !== "string" || !item.query.trim()) errors.push(`${label}.query is required`);
    if (!Array.isArray(item?.expected_ids) || item.expected_ids.length === 0 || item.expected_ids.some((value) => typeof value !== "string" || !value)) errors.push(`${label}.expected_ids is invalid`);
    if (!Number.isInteger(item?.limit) || item.limit < 1 || item.limit > 50) errors.push(`${label}.limit must be from 1 to 50`);
  }
  return { valid: errors.length === 0, errors };
}

export async function evaluateRetrieval(target, fixturePath, options = {}) {
  if (typeof fixturePath !== "string" || path.isAbsolute(fixturePath) || fixturePath.includes("\\") || path.posix.normalize(fixturePath) !== fixturePath || fixturePath.startsWith("../")) {
    throw new Error("--fixture must be a safe repository-relative path");
  }
  const fixture = await readJson(path.join(target, fixturePath));
  const validation = validateEvaluationFixture(fixture);
  if (!validation.valid) throw new Error(`Invalid retrieval evaluation fixture: ${validation.errors.join("; ")}`);
  const provider = options.provider ?? createRepositoryRetrievalProvider();
  const cases = [];
  for (const item of fixture.cases) {
    const documents = await buildRetrievalCorpus(target, item.kind);
    const results = await provider.search({ query: item.query, position: item.position ?? null, work_item_id: item.work_item_id ?? null, pinned_ids: [], documents, limit: item.limit });
    const resultIds = results.map((result) => result.id);
    const ranks = item.expected_ids.map((id) => {
      const index = resultIds.indexOf(id);
      return index < 0 ? null : index + 1;
    });
    const firstRank = ranks.filter((rank) => rank !== null).sort((left, right) => left - right)[0] ?? null;
    cases.push({
      id: item.id,
      kind: item.kind,
      query: item.query,
      expected_ids: item.expected_ids,
      result_ids: resultIds,
      ranks,
      hit: ranks.every((rank) => rank !== null),
      reciprocal_rank: firstRank === null ? 0 : 1 / firstRank
    });
  }
  const report = {
    schema_version: "temple.retrieval-evaluation-result/v1",
    generated_at: new Date().toISOString(),
    fixture: fixturePath,
    provider: { id: provider.id, mode: provider.mode, semantic: provider.semantic },
    summary: {
      cases: cases.length,
      passed: cases.filter((item) => item.hit).length,
      hit_rate_at_limit: cases.filter((item) => item.hit).length / cases.length,
      mean_reciprocal_rank: cases.reduce((sum, item) => sum + item.reciprocal_rank, 0) / cases.length
    },
    cases,
    large_repository_validation: "not_run",
    external_action_performed: false
  };
  if (options.write !== false) await atomicWrite(path.join(target, RETRIEVAL_EVALUATION_VIEW), formatJson(report));
  return report;
}
