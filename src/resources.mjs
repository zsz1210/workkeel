import path from "node:path";
import { atomicCreate, atomicWrite, formatJson, pathExists, readJson, sha256 } from "./files.mjs";
import { appendEvent, uniqueStrings } from "./project.mjs";

export const RESOURCE_REGISTRY_RELATIVE_PATH = ".ai-org/project/resources.json";
export const RESOURCE_REGISTRY_SCHEMA = "temple.resources/v1";
const RESOURCE_ID = /^[a-z][a-z0-9-]{0,63}$/;

export function emptyResourceRegistry() {
  return { schema_version: RESOURCE_REGISTRY_SCHEMA, resources: [], reservations: [] };
}

export function validateResourceRegistry(document) {
  const errors = [];
  if (document?.schema_version !== RESOURCE_REGISTRY_SCHEMA) errors.push(`schema_version must be ${RESOURCE_REGISTRY_SCHEMA}`);
  if (!Array.isArray(document?.resources)) errors.push("resources must be an array");
  if (!Array.isArray(document?.reservations)) errors.push("reservations must be an array");
  const resourceIds = new Set();
  for (const [index, resource] of (document?.resources ?? []).entries()) {
    const label = `resources[${index}]`;
    if (!RESOURCE_ID.test(resource?.id ?? "") || resourceIds.has(resource?.id)) errors.push(`${label}.id is invalid or duplicated`);
    resourceIds.add(resource?.id);
    if (typeof resource?.display_name !== "string" || !resource.display_name.trim()) errors.push(`${label}.display_name is required`);
    if (!Number.isInteger(resource?.capacity) || resource.capacity < 1 || resource.capacity > 100) {
      errors.push(`${label}.capacity must be an integer from 1 to 100`);
    }
    if (typeof resource?.description !== "string") errors.push(`${label}.description must be a string`);
    if (typeof resource?.active !== "boolean") errors.push(`${label}.active must be boolean`);
  }
  const reservationIds = new Set();
  const reservationOwners = new Set();
  for (const [index, reservation] of (document?.reservations ?? []).entries()) {
    const label = `reservations[${index}]`;
    if (typeof reservation?.id !== "string" || !reservation.id || reservationIds.has(reservation.id)) {
      errors.push(`${label}.id is invalid or duplicated`);
    }
    reservationIds.add(reservation?.id);
    if (!RESOURCE_ID.test(reservation?.resource_id ?? "") || !resourceIds.has(reservation?.resource_id)) {
      errors.push(`${label}.resource_id is unknown`);
    }
    if (typeof reservation?.worker_id !== "string" || !reservation.worker_id.startsWith("worker-")) {
      errors.push(`${label}.worker_id is invalid`);
    }
    if (typeof reservation?.work_item_id !== "string" || !reservation.work_item_id) errors.push(`${label}.work_item_id is required`);
    if (!Number.isInteger(reservation?.units) || reservation.units < 1) errors.push(`${label}.units must be positive`);
    if (!["active", "released"].includes(reservation?.status)) errors.push(`${label}.status is invalid`);
    if (typeof reservation?.reserved_at !== "string" || Number.isNaN(Date.parse(reservation.reserved_at))) {
      errors.push(`${label}.reserved_at must be an ISO date`);
    }
    if (!(reservation?.released_at === null || (typeof reservation.released_at === "string" && !Number.isNaN(Date.parse(reservation.released_at))))) {
      errors.push(`${label}.released_at must be null or an ISO date`);
    }
    if (reservation?.status === "active" && reservation?.released_at !== null) errors.push(`${label} active reservation cannot be released`);
    if (reservation?.status === "released" && !reservation?.released_at) errors.push(`${label} released reservation requires released_at`);
    if (!(reservation?.release_reason === undefined || typeof reservation.release_reason === "string")) {
      errors.push(`${label}.release_reason must be a string when present`);
    }
    const ownerKey = `${reservation?.worker_id ?? ""}:${reservation?.resource_id ?? ""}`;
    if (reservationOwners.has(ownerKey)) errors.push(`${label} duplicates a worker resource reservation`);
    reservationOwners.add(ownerKey);
  }
  for (const resource of document?.resources ?? []) {
    const activeUnits = (document?.reservations ?? [])
      .filter((entry) => entry.resource_id === resource.id && entry.status === "active")
      .reduce((total, entry) => total + entry.units, 0);
    if (activeUnits > resource.capacity) errors.push(`active reservations exceed capacity for ${resource.id}`);
  }
  return { valid: errors.length === 0, errors: uniqueStrings(errors) };
}

export async function ensureResourceRegistry(target) {
  const registryPath = path.join(target, RESOURCE_REGISTRY_RELATIVE_PATH);
  if (await pathExists(registryPath)) return { path: registryPath, created: false, afterHash: null };
  const content = formatJson(emptyResourceRegistry());
  try {
    await atomicCreate(registryPath, content);
    return { path: registryPath, created: true, afterHash: sha256(content) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { path: registryPath, created: false, afterHash: null };
  }
}

export async function readResourceRegistry(target) {
  const registryPath = path.join(target, RESOURCE_REGISTRY_RELATIVE_PATH);
  if (!(await pathExists(registryPath))) throw new Error(`${RESOURCE_REGISTRY_RELATIVE_PATH} is missing; run temple upgrade`);
  const document = await readJson(registryPath);
  const validation = validateResourceRegistry(document);
  if (!validation.valid) throw new Error(`Invalid shared resource registry:\n- ${validation.errors.join("\n- ")}`);
  return document;
}

async function writeResourceRegistry(target, document) {
  const validation = validateResourceRegistry(document);
  if (!validation.valid) throw new Error(`Invalid shared resource registry:\n- ${validation.errors.join("\n- ")}`);
  await atomicWrite(path.join(target, RESOURCE_REGISTRY_RELATIVE_PATH), formatJson(document));
}

export async function defineResource(target, options) {
  const id = String(options.resourceId ?? "").trim();
  const displayName = String(options.displayName ?? "").trim();
  const capacity = Number(options.capacity);
  const description = String(options.description ?? "").trim();
  if (!RESOURCE_ID.test(id)) throw new Error("--resource-id must be a lowercase slug");
  if (!displayName) throw new Error("--name is required");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) throw new Error("--capacity must be an integer from 1 to 100");
  const registry = await readResourceRegistry(target);
  const existing = (registry.resources ?? []).find((entry) => entry.id === id);
  if (existing) throw new Error(`Shared resource already exists: ${id}`);
  const resource = { id, display_name: displayName, capacity, description, active: true };
  const updated = { ...registry, resources: [...registry.resources, resource].sort((left, right) => left.id.localeCompare(right.id)) };
  await writeResourceRegistry(target, updated);
  await appendEvent(target, {
    timestamp: new Date().toISOString(),
    event_type: "shared_resource_defined",
    actor: options.actor ?? "human",
    resource_id: id,
    capacity,
    refs: [RESOURCE_REGISTRY_RELATIVE_PATH]
  });
  return resource;
}

export async function resourceAvailability(target, requirements = []) {
  const registry = await readResourceRegistry(target);
  const resources = new Map((registry.resources ?? []).filter((entry) => entry.active !== false).map((entry) => [entry.id, entry]));
  const activeUnits = new Map();
  for (const reservation of (registry.reservations ?? []).filter((entry) => entry.status === "active")) {
    activeUnits.set(reservation.resource_id, (activeUnits.get(reservation.resource_id) ?? 0) + reservation.units);
  }
  const details = requirements.map((requirement) => {
    const resource = resources.get(requirement.resource_id);
    const used = activeUnits.get(requirement.resource_id) ?? 0;
    return {
      resource_id: requirement.resource_id,
      units: requirement.units,
      defined: Boolean(resource),
      capacity: resource?.capacity ?? null,
      active_units: used,
      available: Boolean(resource) && used + requirement.units <= resource.capacity
    };
  });
  return {
    defined: details.every((entry) => entry.defined),
    available: details.every((entry) => entry.available),
    details
  };
}

export async function reserveResources(target, options) {
  const registry = await readResourceRegistry(target);
  const requirements = options.requirements ?? [];
  const availability = await resourceAvailability(target, requirements);
  if (!availability.defined) {
    throw new Error(`Undefined shared resources: ${availability.details.filter((entry) => !entry.defined).map((entry) => entry.resource_id).join(", ")}`);
  }
  if (!availability.available) {
    throw new Error(`Shared resource capacity unavailable: ${availability.details.filter((entry) => !entry.available).map((entry) => entry.resource_id).join(", ")}`);
  }
  const timestamp = options.timestamp ?? new Date().toISOString();
  const reservations = requirements.map((requirement, index) => ({
    id: `reservation-${options.workerId}-${String(index + 1).padStart(2, "0")}`,
    resource_id: requirement.resource_id,
    units: requirement.units,
    worker_id: options.workerId,
    work_item_id: options.workItemId,
    status: "active",
    reserved_at: timestamp,
    released_at: null
  }));
  const updated = { ...registry, reservations: [...(registry.reservations ?? []), ...reservations] };
  await writeResourceRegistry(target, updated);
  return reservations;
}

export async function releaseWorkerResources(target, workerId, reason = "worker_terminal") {
  const registry = await readResourceRegistry(target);
  const timestamp = new Date().toISOString();
  let changed = false;
  const reservations = (registry.reservations ?? []).map((entry) => {
    if (entry.worker_id !== workerId || entry.status !== "active") return entry;
    changed = true;
    return { ...entry, status: "released", released_at: timestamp, release_reason: reason };
  });
  if (changed) await writeResourceRegistry(target, { ...registry, reservations });
  return reservations.filter((entry) => entry.worker_id === workerId);
}
