import fs from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { pathExists, readJson } from "./files.mjs";
import { validateValidationProgramManifest } from "./validation-program.mjs";
import { validateUsagePolicy } from "./usage-policy.mjs";
import { validateEvidenceProfiles } from "./evidence-profiles.mjs";
import {
  readExecutionPolicy,
  validateExecutionPolicy,
  validateExecutionRequest,
  validateExecutionRoute
} from "./execution-routing.mjs";
import { validateLearningRepository } from "./learning.mjs";
import {
  validateModelOnboardingInput,
  validateModelOnboardingPlan
} from "./model-onboarding.mjs";

export const SCHEMA_VALIDATION_SCHEMA = "temple.schema-validation/v1";
export const SCHEMA_CATALOG_RELATIVE_PATH = ".ai-org/core/schemas/schema-catalog.json";

async function matchingDocuments(target, pattern) {
  if (!pattern.includes("*")) return (await pathExists(path.join(target, pattern))) ? [pattern] : [];
  const directory = path.posix.dirname(pattern);
  const namePattern = path.posix.basename(pattern);
  if (namePattern !== "*.json") throw new Error(`Unsupported schema catalog pattern: ${pattern}`);
  const absoluteDirectory = path.join(target, directory);
  if (!(await pathExists(absoluteDirectory))) return [];
  return (await fs.readdir(absoluteDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => `${directory}/${entry.name}`)
    .sort();
}

function normalizeAjvErrors(document, schemaPath, errors = []) {
  return errors.map((error) => ({
    document,
    schema: schemaPath,
    instance_path: error.instancePath,
    schema_path: error.schemaPath,
    keyword: error.keyword,
    message: error.message,
    params: error.params
  }));
}

function createCompiler() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  return ajv;
}

// Restrict reuse to self-contained schemas. Other dialects, identities and
// references keep the original isolated compiler and resolution behavior.
function canReuseCompiler(schema) {
  const draft = "https://json-schema.org/draft/2020-12/schema";
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || schema.$schema !== draft) return false;
  const pending = [schema];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Object.hasOwn(value, "$id") && (value !== schema || typeof value.$id !== "string" ||
      /^https?:\/\/json-schema\.org\//i.test(value.$id))) return false;
    if (Object.hasOwn(value, "$schema") && value.$schema !== draft) return false;
    for (const key of ["$ref", "$dynamicRef", "$recursiveRef"]) {
      if (Object.hasOwn(value, key) && (typeof value[key] !== "string" || !value[key].startsWith("#"))) return false;
    }
    for (const child of Object.values(value)) if (child && typeof child === "object") pending.push(child);
  }
  return true;
}

export async function validateProjectSchemas(target) {
  const catalog = await readJson(path.join(target, SCHEMA_CATALOG_RELATIVE_PATH));
  if (catalog.schema_version !== "temple.schema-catalog/v1" || !Array.isArray(catalog.documents)) {
    throw new Error("Invalid runtime schema catalog");
  }
  const errors = [];
  const checked = [];
  let executionPolicy = null;
  let sharedCompiler;
  for (const entry of catalog.documents) {
    const schemaPath = `.ai-org/core/schemas/${entry.schema}`;
    const schema = await readJson(path.join(target, schemaPath));
    const ajv = canReuseCompiler(schema) ? (sharedCompiler ??= createCompiler()) : createCompiler();
    // Retain built-in meta-schemas, never a previous project's/user schema.
    if (ajv === sharedCompiler) ajv.removeSchema();
    let validate;
    try {
      validate = ajv.compile(schema);
    } catch (error) {
      errors.push({ document: null, schema: schemaPath, instance_path: "", schema_path: "", keyword: "compile", message: error.message, params: {} });
      continue;
    }
    const documents = await matchingDocuments(target, entry.path);
    if (entry.required && documents.length === 0) {
      errors.push({ document: entry.path, schema: schemaPath, instance_path: "", schema_path: "", keyword: "required", message: "required document is missing", params: {} });
      continue;
    }
    for (const documentPath of documents) {
      try {
        const document = await readJson(path.join(target, documentPath));
        const jsonSchemaValid = validate(document);
        let semantic = { valid: true, errors: [] };
        if (jsonSchemaValid) {
          if (entry.id === "validation-program") semantic = validateValidationProgramManifest(document);
          else if (entry.id === "usage-policy") semantic = validateUsagePolicy(document);
          else if (entry.id === "evidence-profiles") semantic = validateEvidenceProfiles(document);
          else if (entry.id === "execution-policy") semantic = validateExecutionPolicy(document);
          else if (entry.id === "execution-requests") {
            executionPolicy ??= (await readExecutionPolicy(target)).policy;
            semantic = validateExecutionRequest(document, executionPolicy);
          }
          else if (entry.id === "execution-routes") semantic = validateExecutionRoute(document);
          else if (entry.id === "model-onboarding-inputs") {
            executionPolicy ??= (await readExecutionPolicy(target)).policy;
            semantic = validateModelOnboardingInput(document, executionPolicy);
          }
          else if (entry.id === "model-onboarding-plan") semantic = validateModelOnboardingPlan(document);
        }
        const valid = jsonSchemaValid && semantic.valid;
        checked.push({ document: documentPath, schema: schemaPath, valid });
        if (!jsonSchemaValid) errors.push(...normalizeAjvErrors(documentPath, schemaPath, validate.errors));
        if (!semantic.valid) {
          errors.push(...semantic.errors.map((message) => ({
            document: documentPath,
            schema: schemaPath,
            instance_path: "",
            schema_path: "semantic",
            keyword: "semantic",
            message,
            params: {}
          })));
        }
      } catch (error) {
        checked.push({ document: documentPath, schema: schemaPath, valid: false });
        errors.push({ document: documentPath, schema: schemaPath, instance_path: "", schema_path: "", keyword: "parse", message: error.message, params: {} });
      }
    }
  }
  const skillProposals = await validateLearningRepository(target);
  for (const proposal of skillProposals.checked) {
    checked.push({
      document: proposal.document,
      schema: "runtime:temple.skill-proposal/v1",
      valid: proposal.valid
    });
  }
  errors.push(...skillProposals.errors.map((message) => ({
    document: message.split(": ")[0],
    schema: "runtime:temple.skill-proposal/v1",
    instance_path: "",
    schema_path: "semantic",
    keyword: "semantic",
    message,
    params: {}
  })));
  return {
    schema_version: SCHEMA_VALIDATION_SCHEMA,
    generated_at: new Date().toISOString(),
    valid: errors.length === 0,
    documents_checked: checked.length,
    schemas_checked: catalog.documents.length,
    checked,
    errors
  };
}
