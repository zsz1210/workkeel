import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KNOWN_PACKAGE_NAMES, PACKAGE_NAME, REPOSITORY_ROOT, TEMPLATE_REPOSITORY, TEMPLATE_VERSION } from "./constants.mjs";

const execFileAsync = promisify(execFile);
export const CLI_BOOTSTRAP_SCHEMA = "temple.cli-bootstrap/v1";
export const SUPPORTED_NODE_RANGE = ">=24.0.0";

async function gitSource() {
  try {
    const [{ stdout: revisionOutput }, { stdout: statusOutput }] = await Promise.all([
      execFileAsync("git", ["-C", REPOSITORY_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }),
      execFileAsync("git", ["-C", REPOSITORY_ROOT, "status", "--porcelain"], { encoding: "utf8" })
    ]);
    const revision = revisionOutput.trim();
    if (!/^[a-f0-9]{40}$/.test(revision)) return { revision: null, clean: false };
    return { revision, clean: statusOutput.trim().length === 0 };
  } catch {
    return { revision: null, clean: false };
  }
}

export async function buildCliBootstrapMetadata() {
  const source = await gitSource();
  return {
    schema_version: CLI_BOOTSTRAP_SCHEMA,
    version: TEMPLATE_VERSION,
    node: SUPPORTED_NODE_RANGE,
    launcher: "templew.mjs",
    package_spec: `${PACKAGE_NAME}@${TEMPLATE_VERSION}`,
    repository_spec:
      source.clean && source.revision
        ? `git+https://github.com/${TEMPLATE_REPOSITORY}.git#${source.revision}`
        : null,
    source_revision: source.revision,
    source_clean: source.clean,
    invocation: "node ./templew.mjs <command> ."
  };
}

export function validateCliBootstrapMetadata(document, templateVersion = TEMPLATE_VERSION) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return { valid: false, errors: ["bootstrap metadata must be an object"] };
  }
  const errors = [];
  if (document.schema_version !== CLI_BOOTSTRAP_SCHEMA) errors.push(`schema_version must be ${CLI_BOOTSTRAP_SCHEMA}`);
  if (document.version !== templateVersion) errors.push("bootstrap version must match the installed template version");
  if (document.node !== SUPPORTED_NODE_RANGE) {
    errors.push(`bootstrap node requirement must be ${SUPPORTED_NODE_RANGE}`);
  }
  if (document.launcher !== "templew.mjs") errors.push("bootstrap launcher must be templew.mjs");
  if (![...KNOWN_PACKAGE_NAMES].some(name => document.package_spec === `${name}@${templateVersion}`)) {
    errors.push("bootstrap package_spec must pin the installed package version");
  }
  if (!(document.repository_spec === null || (
    typeof document.repository_spec === "string" &&
    /^git\+https:\/\/github\.com\/.+#[a-f0-9]{40}$/.test(document.repository_spec)
  ))) {
    errors.push("bootstrap repository_spec must be null or an exact Git revision");
  }
  if (!(document.source_revision === null || (
    typeof document.source_revision === "string" && /^[a-f0-9]{40}$/.test(document.source_revision)
  ))) {
    errors.push("bootstrap source_revision must be null or a Git commit");
  }
  if (typeof document.source_clean !== "boolean") errors.push("bootstrap source_clean must be boolean");
  if (document.source_clean === true && !document.repository_spec) {
    errors.push("a clean bootstrap source must provide repository_spec");
  }
  if (typeof document.invocation !== "string" || !document.invocation.includes("templew.mjs")) {
    errors.push("bootstrap invocation must identify the repository launcher");
  }
  return { valid: errors.length === 0, errors };
}
