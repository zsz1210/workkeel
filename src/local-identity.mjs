import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { durableAtomicWrite, formatJson, pathExists, readJson } from "./files.mjs";

export const LOCAL_ACTOR_BINDING_SCHEMA = "temple.local-actor-binding/v1";
export const LOCAL_ACTOR_VERIFICATION_CLASSES = ["self-asserted", "external-evidence", "step-up-evidence"];

function bindingError(code, message, nextAction, details = {}) {
  return Object.assign(new Error(message), { code, mutation_status: "not-started", next_action: nextAction, details });
}

function nonEmpty(value, maximum = 240) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}

function timestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function gitCommonDirectory(target) {
  const result = spawnSync("git", ["-C", target, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  if (result.status !== 0) throw bindingError("TEMPLE_ACTOR_GIT_REQUIRED", `Local actor binding requires a Git repository: ${result.stderr.trim() || target}`,
    "Use explicit ordinary attribution, or initialize a Git clone when verified local binding is required.");
  const value = result.stdout.trim();
  if (!value) throw new Error("Git returned an empty common directory");
  return path.resolve(target, value);
}

export function resolveLocalActorBindingPath(target) {
  return path.join(gitCommonDirectory(path.resolve(target)), "temple", "identity.json");
}

export function validateLocalActorBinding(document, projectId = null) {
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, errors: ["binding must be an object"] };
  if (document.schema_version !== LOCAL_ACTOR_BINDING_SCHEMA) errors.push("invalid schema_version");
  if (!nonEmpty(document.project_id) || (projectId && document.project_id !== projectId)) errors.push("project_id is missing or does not match");
  if (!(document.principal_id === "human" || /^principal-[a-z0-9][a-z0-9-]*$/.test(document.principal_id ?? ""))) {
    errors.push("principal_id is invalid");
  }
  if (!LOCAL_ACTOR_VERIFICATION_CLASSES.includes(document.verification_class)) errors.push("verification_class is invalid");
  if (!timestamp(document.observed_at)) errors.push("observed_at is invalid");
  if (document.expires_at !== null && !timestamp(document.expires_at)) errors.push("expires_at is invalid");
  if (document.expires_at && Date.parse(document.expires_at) <= Date.parse(document.observed_at)) {
    errors.push("expires_at must follow observed_at");
  }
  if (document.credential_stored !== false) errors.push("credential_stored must be false");
  if (["external-evidence", "step-up-evidence"].includes(document.verification_class)) {
    if (!nonEmpty(document.provider?.id, 80) || !nonEmpty(document.provider?.subject, 200)) {
      errors.push("external verification evidence requires provider id and subject");
    }
    if (!nonEmpty(document.evidence_ref, 500)) errors.push("external verification evidence requires evidence_ref");
  }
  if (document.provider?.handle !== null && document.provider?.handle !== undefined && !nonEmpty(document.provider.handle, 160)) {
    errors.push("provider handle is invalid");
  }
  return { valid: errors.length === 0, errors };
}

async function projectAndCollaboration(target) {
  const [project, collaboration] = await Promise.all([
    readJson(path.join(target, ".ai-org/project/project.json")),
    readJson(path.join(target, ".ai-org/project/collaboration.json"))
  ]);
  return { project, collaboration };
}

function activePrincipal(collaboration, principalId) {
  if (collaboration.profile === "solo" && principalId === "human") return true;
  return (collaboration.principals ?? []).some((entry) => {
    const status = entry.status ?? (entry.active === false ? "inactive" : "active");
    return entry.id === principalId && status === "active";
  });
}

export async function readLocalActorBinding(target, options = {}) {
  const bindingPath = resolveLocalActorBindingPath(target);
  if (!(await pathExists(bindingPath))) {
    if (options.required) throw bindingError("TEMPLE_ACTOR_BINDING_REQUIRED", "No local actor binding exists for this Git clone",
      "Supply required verification provenance, or inspect whether the project permits ordinary attribution.");
    return { path: bindingPath, binding: null, status: "missing" };
  }
  const project = await readJson(path.join(target, ".ai-org/project/project.json"));
  let binding;
  try { binding = await readJson(bindingPath); }
  catch (error) { throw bindingError("TEMPLE_ACTOR_BINDING_INVALID", `Invalid local actor binding: ${error.message}`,
    "Inspect or clear the invalid local binding before continuing."); }
  const validation = validateLocalActorBinding(binding, project.id);
  if (!validation.valid) throw bindingError("TEMPLE_ACTOR_BINDING_INVALID", `Invalid local actor binding: ${validation.errors.join("; ")}`,
    "Inspect or clear the invalid local binding before continuing.", { errors: validation.errors });
  const expired = Boolean(binding.expires_at && Date.parse(binding.expires_at) <= Date.now());
  return { path: bindingPath, binding, status: expired ? "expired" : "current" };
}

export async function assertLocalActorBinding(target, expectedPrincipalId, options = {}) {
  const result = await readLocalActorBinding(target, { required: true });
  if (result.status !== "current") throw bindingError("TEMPLE_ACTOR_BINDING_EXPIRED", "The local actor binding is expired",
    "Renew the verification provenance or clear the expired binding for ordinary attribution.");
  if (result.binding.principal_id !== expectedPrincipalId) {
    throw bindingError("TEMPLE_ACTOR_BINDING_MISMATCH", `This Git clone is bound to ${result.binding.principal_id}, not ${expectedPrincipalId}`,
      "Inspect or clear the conflicting binding before selecting the intended Principal.", { expected_principal_id: expectedPrincipalId, binding_principal_id: result.binding.principal_id });
  }
  const accepted = options.acceptedVerificationClasses ?? ["external-evidence", "step-up-evidence"];
  if (!accepted.includes(result.binding.verification_class)) {
    throw bindingError("TEMPLE_ACTOR_VERIFICATION_REQUIRED", `This operation requires local actor verification: ${accepted.join(" or ")}`,
      "Supply the required external verification provenance; self-description does not authenticate a provider.");
  }
  return result;
}

export async function writeLocalActorBinding(target, options) {
  const { project, collaboration } = await projectAndCollaboration(target);
  const principalId = String(options.principalId ?? "").trim();
  const verificationClass = String(options.verificationClass ?? "").trim();
  if (!activePrincipal(collaboration, principalId)) throw new Error(`Unknown active Human Principal: ${principalId || "missing"}`);
  if (!LOCAL_ACTOR_VERIFICATION_CLASSES.includes(verificationClass)) {
    throw new Error(`--verification-class must be ${LOCAL_ACTOR_VERIFICATION_CLASSES.join(", ")}`);
  }
  if (collaboration.profile !== "solo" && verificationClass === "self-asserted") {
    throw new Error("Collaborative and High-Assurance actor binding requires externally supplied verification evidence");
  }
  const observedAt = new Date().toISOString();
  const providerId = String(options.providerId ?? "").trim();
  const providerSubject = String(options.providerSubject ?? "").trim();
  const providerHandle = String(options.providerHandle ?? "").trim() || null;
  const evidenceRef = String(options.evidenceRef ?? "").trim() || null;
  const binding = {
    schema_version: LOCAL_ACTOR_BINDING_SCHEMA,
    project_id: project.id,
    principal_id: principalId,
    verification_class: verificationClass,
    provider:
      verificationClass === "self-asserted"
        ? null
        : { id: providerId, subject: providerSubject, handle: providerHandle },
    evidence_ref: evidenceRef,
    observed_at: observedAt,
    expires_at: String(options.expiresAt ?? "").trim() || null,
    credential_stored: false
  };
  const validation = validateLocalActorBinding(binding, project.id);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  const bindingPath = resolveLocalActorBindingPath(target);
  await durableAtomicWrite(bindingPath, formatJson(binding));
  await fs.chmod(bindingPath, 0o600);
  return { path: bindingPath, binding, status: "current" };
}

export async function clearLocalActorBinding(target) {
  const bindingPath = resolveLocalActorBindingPath(target);
  if (!(await pathExists(bindingPath))) return { path: bindingPath, removed: false };
  await fs.unlink(bindingPath);
  return { path: bindingPath, removed: true };
}
