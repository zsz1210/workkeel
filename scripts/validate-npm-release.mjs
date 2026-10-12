import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MINIMUM_NPM_VERSION = "11.5.1";

// Release packing only; consumer engines and ordinary development stay independent.
export const RELEASE_TOOLCHAIN = Object.freeze({
  node: "24.20.0",
  npm: "11.19.0",
  zlib: "1.3.2.1-motley-42c2f19"
});

export class ReleaseValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseValidationError";
  }
}

function fail(message) {
  throw new ReleaseValidationError(message);
}

export function validateReleaseToolchain({ versions = process.versions, npmVersion,
  platform = process.platform, arch = process.arch }) {
  const observed = { node: versions.node, npm: npmVersion, zlib: versions.zlib };
  const mismatches = Object.keys(RELEASE_TOOLCHAIN).filter((key) => observed[key] !== RELEASE_TOOLCHAIN[key]);
  if (mismatches.length) {
    fail(`Release packaging toolchain mismatch (${mismatches.join(", ")}). ` +
      `Expected ${JSON.stringify(RELEASE_TOOLCHAIN)}; observed ${JSON.stringify(observed)}. ` +
      `Use the checksum-verified official Node ${RELEASE_TOOLCHAIN.node} distribution; ` +
      "see docs/operations/npm-release.md. No release archive was created.");
  }
  return { ...observed, platform, arch };
}

function parseBoolean(value, label) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  fail(`${label} must be true or false`);
}

function parseVersion(value, label) {
  const match = String(value ?? "").match(SEMVER_PATTERN);
  if (!match) fail(`${label} must be a semantic version`);
  return {
    value: match[0],
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null
  };
}

function compareVersions(left, right) {
  const leftVersion = parseVersion(left, "npm CLI version");
  const rightVersion = parseVersion(right, "minimum npm CLI version");
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion.parts[index] !== rightVersion.parts[index]) {
      return leftVersion.parts[index] - rightVersion.parts[index];
    }
  }
  return 0;
}

function repositoryUrl(repository) {
  if (typeof repository === "string") return repository;
  return repository?.url;
}

async function requireRegularFile(filename, label) {
  const stats = await fs.lstat(filename).catch(() => null);
  if (!stats?.isFile()) fail(`${label} must be one regular file: ${filename}`);
  return stats;
}

async function sha256(filename) {
  const body = await fs.readFile(filename);
  return crypto.createHash("sha256").update(body).digest("hex");
}

function normalizeOutputValue(value, label) {
  const normalized = String(value);
  if (normalized.includes("\n") || normalized.includes("\r")) {
    fail(`${label} cannot contain a line break`);
  }
  return normalized;
}

async function writeOutputs(filename, outputs) {
  if (!filename) return;
  const lines = Object.entries(outputs).map(
    ([key, value]) => `${key}=${normalizeOutputValue(value, key)}`
  );
  await fs.appendFile(filename, `${lines.join("\n")}\n`, "utf8");
}

export async function validateReleasePreparation({
  packageDocument,
  packResult,
  packDirectory,
  tagName,
  releasePrerelease,
  githubRepository,
  npmVersion
}) {
  const version = parseVersion(packageDocument?.version, "package version");
  const prerelease = parseBoolean(releasePrerelease, "GitHub Release prerelease flag");

  if (tagName !== `v${version.value}`) {
    fail(`Release tag ${tagName} must equal v${version.value}`);
  }
  if (Boolean(version.prerelease) !== prerelease) {
    fail(
      prerelease
        ? "a GitHub prerelease must contain a semantic prerelease package version"
        : "a stable GitHub Release cannot contain a semantic prerelease package version"
    );
  }

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepository ?? "")) {
    fail("GitHub repository must use owner/repository form");
  }
  const expectedRepositoryUrl = `git+https://github.com/${githubRepository}.git`;
  if (repositoryUrl(packageDocument?.repository) !== expectedRepositoryUrl) {
    fail(`package repository URL must equal ${expectedRepositoryUrl}`);
  }
  if (packageDocument?.publishConfig?.access !== "public") {
    fail("publishConfig.access must remain public");
  }
  if (packageDocument?.publishConfig?.tag !== "next") {
    fail("publishConfig.tag must remain the conservative next default");
  }
  if (compareVersions(npmVersion, MINIMUM_NPM_VERSION) < 0) {
    fail(`npm CLI ${MINIMUM_NPM_VERSION} or newer is required for trusted publishing`);
  }

  if (!Array.isArray(packResult) || packResult.length !== 1) {
    fail("npm pack must describe exactly one archive");
  }
  const [packed] = packResult;
  if (packed.name !== packageDocument.name || packed.version !== version.value) {
    fail("npm pack name and version must match package.json");
  }
  if (!packed.filename || path.basename(packed.filename) !== packed.filename) {
    fail("npm pack must return one basename-only archive filename");
  }

  const archivePath = path.resolve(packDirectory, packed.filename);
  await requireRegularFile(archivePath, "fresh package archive");

  return {
    package_name: packageDocument.name,
    package_version: version.value,
    dist_tag: prerelease ? "next" : "latest",
    archive_filename: packed.filename,
    fresh_archive_path: archivePath
  };
}

export async function verifyReleaseAsset({ freshArchive, releaseArchive }) {
  const freshStats = await requireRegularFile(freshArchive, "fresh package archive");
  const releaseStats = await requireRegularFile(releaseArchive, "GitHub Release archive");
  if (freshStats.size !== releaseStats.size) {
    fail("GitHub Release archive size differs from the fresh package archive");
  }

  const [freshBytes, releaseBytes] = await Promise.all([
    fs.readFile(freshArchive),
    fs.readFile(releaseArchive)
  ]);
  if (!crypto.timingSafeEqual(freshBytes, releaseBytes)) {
    fail("GitHub Release archive bytes differ from the fresh package archive");
  }

  return {
    archive_sha256: await sha256(releaseArchive),
    archive_size: releaseStats.size
  };
}

function parseArguments(argumentsList) {
  const [command, ...tokens] = argumentsList;
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index];
    const value = tokens[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail(`invalid argument near ${key ?? "end"}`);
    options[key.slice(2)] = value;
  }
  return { command, options };
}

async function readJson(filename, label) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

async function main(argumentsList) {
  const { command, options } = parseArguments(argumentsList);
  if (command === "prepare") {
    const result = await validateReleasePreparation({
      packageDocument: await readJson(options["package-json"], "package.json"),
      packResult: await readJson(options["pack-result"], "npm pack result"),
      packDirectory: options["pack-dir"],
      tagName: options["tag-name"],
      releasePrerelease: options.prerelease,
      githubRepository: options.repository,
      npmVersion: options["npm-version"]
    });
    await writeOutputs(options["github-output"], result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "verify-asset") {
    const result = await verifyReleaseAsset({
      freshArchive: options.fresh,
      releaseArchive: options.release
    });
    await writeOutputs(options["github-output"], result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  fail("usage: validate-npm-release.mjs prepare|verify-asset [options]");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    assert.ok(error instanceof Error);
    process.stderr.write(`npm release validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
