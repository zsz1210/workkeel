import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  defaultEvidenceProfiles,
  ensureEvidenceProfiles,
  EVIDENCE_PROFILES_RELATIVE_PATH,
  validateEvidenceProfiles
} from "../src/evidence-profiles.mjs";
import { buildPublicationAudit } from "../src/publication-audit.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "bin/temple.mjs");

function git(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

async function repositoryFixture(context, name) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), `temple-publication-${name}-`));
  context.after(() => fs.rm(target, { recursive: true, force: true }));
  git(target, ["init", "-q"]);
  git(target, ["config", "user.email", "publication@example.invalid"]);
  git(target, ["config", "user.name", "Publication Fixture"]);
  await ensureEvidenceProfiles(target);
  const policyPath = path.join(target, EVIDENCE_PROFILES_RELATIVE_PATH);
  const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
  policy.active_profile = "public";
  await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  return { target, policyPath, policy };
}

test("Evidence Profiles default safely and reject weakened profile floors", async (context) => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "temple-evidence-profile-"));
  context.after(() => fs.rm(target, { recursive: true, force: true }));
  const policy = defaultEvidenceProfiles();
  assert.equal(policy.active_profile, "private");
  assert.deepEqual(policy.profiles.map((entry) => entry.id), ["private", "public", "restricted"]);
  assert.deepEqual(validateEvidenceProfiles(policy), { valid: true, errors: [] });

  const weakened = structuredClone(policy);
  weakened.profiles.find((entry) => entry.id === "public").local_environment = "review-required";
  assert.equal(validateEvidenceProfiles(weakened).valid, false);
  const bypass = structuredClone(policy);
  bypass.synthetic_usernames.push("maintainer");
  assert.equal(validateEvidenceProfiles(bypass).valid, false);
  const unsafeFixture = structuredClone(policy);
  unsafeFixture.reviewed_adapter_fixtures.push({
    path: "test/example.mjs",
    manifest_path: ".ai-org/adapters/example/v1/manifest.json",
    rule_id: "private-key-header",
    line: 1,
    occurrence_count: 1,
    source_sha256: "a".repeat(64),
    approved_by: "human",
    approved_at: "2026-09-04T00:00:00Z",
    rationale: "Unsafe test entry"
  });
  assert.equal(validateEvidenceProfiles(unsafeFixture).valid, false);

  const results = await Promise.all(Array.from({ length: 6 }, () => ensureEvidenceProfiles(target)));
  assert.equal(results.filter((entry) => entry.created).length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target, EVIDENCE_PROFILES_RELATIVE_PATH), "utf8")), policy);
});

test("public audit redacts values, counts legacy occurrences, and blocks new duplicates and secrets", async (context) => {
  const { target, policyPath, policy } = await repositoryFixture(context, "legacy");
  const legacyPath = ["/Users", "maintainer", "workspace"].join("/");
  await fs.writeFile(path.join(target, "notes.md"), `Legacy location: ${legacyPath}\n`);
  git(target, ["add", "."]);
  git(target, ["commit", "-qm", "reviewed baseline"]);
  const baseline = git(target, ["rev-parse", "HEAD"]);

  policy.reviewed_legacy_baseline = {
    revision: baseline,
    approved_by: "human",
    approved_at: "2026-09-04T00:00:00.000Z",
    rationale: "Reviewed test baseline"
  };
  await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  const credential = `sk-${"A".repeat(24)}`;
  await fs.writeFile(path.join(target, "notes.md"), `Legacy location: ${legacyPath}\nDuplicated location: ${legacyPath}\nCredential: ${credential}\n`);
  await fs.writeFile(path.join(target, "image.bin"), Buffer.from([0, 1, 2, 3]));
  await fs.writeFile(path.join(target, ".env.staging"), "SAFE_LOOKING_VALUE=still-not-for-publication\n");
  git(target, ["add", "."]);

  const result = await buildPublicationAudit(target, { surface: "repository" });
  assert.equal(result.status, "blocked");
  assert.equal(result.authority.publication_authorized, false);
  assert.equal(result.summary.binary_files_requiring_review, 1);
  const findings = result.surfaces[0].findings;
  assert.ok(findings.some((entry) => entry.rule_id === "maintainer-home-path-posix" && entry.disposition === "retained-legacy" && entry.classification === "review-required"));
  assert.ok(findings.some((entry) => entry.rule_id === "maintainer-home-path-posix" && entry.disposition === "new" && entry.classification === "blocked"));
  assert.ok(findings.some((entry) => entry.rule_id === "openai-api-key" && entry.classification === "blocked"));
  assert.ok(findings.some((entry) => entry.rule_id === "sensitive-dotenv" && entry.classification === "blocked"));
  assert.ok(findings.some((entry) => entry.rule_id === "binary-review" && entry.classification === "review-required"));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(legacyPath), false);
  assert.equal(serialized.includes(credential), false);
});

test("private profile still blocks credentials while treating local environment details as review-required", async (context) => {
  const { target } = await repositoryFixture(context, "private");
  const privateIp = ["192", "168", "7", "9"].join(".");
  const credential = `ghp_${"B".repeat(24)}`;
  await fs.writeFile(path.join(target, "notes.md"), `Endpoint ${privateIp}\nToken ${credential}\n`);
  git(target, ["add", "."]);

  const result = await buildPublicationAudit(target, { profileId: "private", surface: "repository" });
  assert.equal(result.status, "blocked");
  assert.ok(result.surfaces[0].findings.some((entry) => entry.rule_id === "private-ipv4" && entry.classification === "review-required"));
  assert.ok(result.surfaces[0].findings.some((entry) => entry.rule_id === "github-token" && entry.classification === "blocked"));
});

test("package surface never inherits a repository legacy exception", async (context) => {
  const { target, policyPath, policy } = await repositoryFixture(context, "package");
  const privateIp = ["10", "8", "0", "4"].join(".");
  await fs.writeFile(path.join(target, "README.md"), `Internal endpoint ${privateIp}\n`);
  await fs.writeFile(path.join(target, "package.json"), `${JSON.stringify({ name: "publication-fixture", version: "1.0.0", files: ["README.md"] }, null, 2)}\n`);
  git(target, ["add", "."]);
  git(target, ["commit", "-qm", "reviewed package baseline"]);
  const baseline = git(target, ["rev-parse", "HEAD"]);
  policy.reviewed_legacy_baseline = {
    revision: baseline,
    approved_by: "human",
    approved_at: "2026-09-04T00:00:00.000Z",
    rationale: "Reviewed test baseline"
  };
  await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  git(target, ["add", policyPath]);

  const result = await buildPublicationAudit(target, { surface: "package" });
  assert.equal(result.status, "blocked");
  assert.equal(result.legacy_baseline, null);
  assert.ok(result.surfaces[0].findings.some((entry) => entry.rule_id === "private-ipv4" && entry.disposition === "new"));
});

test("reviewed adapter fixture requires exact installed provenance and remains repository-only", async (context) => {
  const { target, policyPath, policy } = await repositoryFixture(context, "adapter-fixture");
  const adapterRoot = ".ai-org/adapters/example/v1";
  const sourcePath = `${adapterRoot}/example/test/security.test.mjs`;
  const manifestPath = `${adapterRoot}/manifest.json`;
  const privateIp = [192, 168, 4, 9].join(".");
  const source = `const blockedFixture = "${privateIp}";\n`;
  const digest = crypto.createHash("sha256").update(source).digest("hex");
  await fs.mkdir(path.join(target, adapterRoot, "example", "test"), { recursive: true });
  await fs.writeFile(path.join(target, sourcePath), source);
  await fs.writeFile(path.join(target, manifestPath), `${JSON.stringify({ files: [{ path: sourcePath, sha256: digest }] }, null, 2)}\n`);
  policy.reviewed_adapter_fixtures = [{
    path: sourcePath,
    manifest_path: manifestPath,
    rule_id: "private-ipv4",
    line: 1,
    occurrence_count: 1,
    source_sha256: digest,
    approved_by: "human",
    approved_at: "2026-09-04T00:00:00Z",
    rationale: "Exact private-address rejection fixture"
  }];
  await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  git(target, ["add", "."]);

  const repository = await buildPublicationAudit(target, { surface: "repository" });
  assert.equal(repository.status, "allowed");
  assert.equal(repository.summary.reviewed_adapter_fixtures, 1);
  assert.ok(repository.surfaces[0].findings.some((entry) =>
    entry.path === sourcePath && entry.classification === "allowed" && entry.disposition === "reviewed-adapter-fixture"
  ));

  const packageResult = await buildPublicationAudit(target, {
    surface: "package",
    filesBySurface: { package: [sourcePath] }
  });
  assert.equal(packageResult.status, "blocked");
  assert.equal(packageResult.summary.reviewed_adapter_fixtures, 0);

  await fs.appendFile(path.join(target, sourcePath), "// drift\n");
  const drifted = await buildPublicationAudit(target, { surface: "repository" });
  assert.equal(drifted.status, "blocked");
  assert.ok(drifted.surfaces[0].findings.some((entry) => entry.rule_id === "reviewed-adapter-fixture-drift"));
});

test("reviewed adapter fixture never excuses secret material", async (context) => {
  const { target, policyPath, policy } = await repositoryFixture(context, "adapter-secret");
  const adapterRoot = ".ai-org/adapters/example/v1";
  const sourcePath = `${adapterRoot}/example/test/security.test.mjs`;
  const manifestPath = `${adapterRoot}/manifest.json`;
  const source = `const values = ["${[10, 2, 3, 4].join(".")}", "sk-${"S".repeat(24)}"];\n`;
  const digest = crypto.createHash("sha256").update(source).digest("hex");
  await fs.mkdir(path.join(target, adapterRoot, "example", "test"), { recursive: true });
  await fs.writeFile(path.join(target, sourcePath), source);
  await fs.writeFile(path.join(target, manifestPath), `${JSON.stringify({ files: [{ path: sourcePath, sha256: digest }] }, null, 2)}\n`);
  policy.reviewed_adapter_fixtures = [{
    path: sourcePath,
    manifest_path: manifestPath,
    rule_id: "private-ipv4",
    line: 1,
    occurrence_count: 1,
    source_sha256: digest,
    approved_by: "human",
    approved_at: "2026-09-04T00:00:00Z",
    rationale: "Exact private-address rejection fixture"
  }];
  await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  git(target, ["add", "."]);

  const result = await buildPublicationAudit(target, { surface: "repository" });
  assert.equal(result.status, "blocked");
  assert.ok(result.surfaces[0].findings.some((entry) => entry.rule_id === "openai-api-key" && entry.classification === "blocked"));
});

test("publication CLI is read-only and rejects an unknown surface", async (context) => {
  const { target } = await repositoryFixture(context, "cli");
  await fs.writeFile(path.join(target, "README.md"), "Public fixture\n");
  git(target, ["add", "."]);
  const before = git(target, ["status", "--porcelain=v1"]);

  const result = runCli(["publication", "audit", target, "--surface", "repository", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "allowed");
  assert.equal(report.authority.canonical_state_changed, false);
  assert.equal(git(target, ["status", "--porcelain=v1"]), before);

  const invalid = runCli(["publication", "audit", target, "--surface", "remote"]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown publication surface/);
});

test("oversized current text streams exact matches, lines, UTF-8, and CIDR exceptions", async (context) => {
  const { target } = await repositoryFixture(context, "stream-text");
  const token = `sk-${"A".repeat(120000)}`;
  const privateIp = [192, 168, 7, 9].join(".");
  const keyHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const content = [
    "safe".repeat(530000),
    `prefix ${token}`,
    `日本語 ${privateIp}/24 and ${privateIp}`,
    `location ${["", "Users", "maintainer", "workspace"].join("/")}`,
    keyHeader,
    ["-----BEGIN", "PRIVATE KEY-----"].join("\n"),
    "end"
  ].join("\n");
  assert.ok(Buffer.byteLength(content) > 2097152);
  await fs.writeFile(path.join(target, "large.txt"), content);
  git(target, ["add", "."]);

  const result = await buildPublicationAudit(target, { surface: "repository", profileId: "public" });
  const findings = result.surfaces[0].findings.filter((entry) => entry.path === "large.txt");
  assert.deepEqual(findings.map((entry) => [entry.rule_id, entry.line, entry.count]), [
    ["maintainer-home-path-posix", 4, 1],
    ["openai-api-key", 2, 1],
    ["private-ipv4", 3, 1],
    ["private-key-header", 5, 1]
  ]);
  assert.equal(result.summary.text_files >= 1, true);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("streamed files fail closed on late binary content and explicit byte and line bounds", async (context) => {
  const { target } = await repositoryFixture(context, "stream-limits");
  await fs.writeFile(path.join(target, "late-binary.bin"), Buffer.concat([
    Buffer.from("safe\n".repeat(420000)), Buffer.from([0])
  ]));
  await fs.writeFile(path.join(target, "long-line.txt"), `safe\n${"x".repeat(4 * 1024 * 1024 + 1)}`);
  const file = await fs.open(path.join(target, "too-large.txt"), "w");
  await file.truncate(64 * 1024 * 1024 + 1);
  await file.close();
  git(target, ["add", "."]);

  const result = await buildPublicationAudit(target, { surface: "repository" });
  const findings = result.surfaces[0].findings;
  assert.ok(findings.some((entry) => entry.path === "late-binary.bin" && entry.rule_id === "binary-review"));
  assert.equal(findings.some((entry) => entry.path === "late-binary.bin" && entry.rule_id === "stream-limit-exceeded"), false);
  assert.ok(findings.some((entry) => entry.path === "long-line.txt" && entry.rule_id === "stream-limit-exceeded" && entry.classification === "blocked"));
  assert.ok(findings.some((entry) => entry.path === "too-large.txt" && entry.rule_id === "stream-limit-exceeded" && entry.classification === "blocked"));
});

test("streamed inspection blocks a file changed between metadata and open", async (context) => {
  const { target } = await repositoryFixture(context, "stream-drift");
  const filename = path.join(target, "changing.txt");
  await fs.writeFile(filename, "safe\n".repeat(420000));
  git(target, ["add", "."]);
  const originalOpen = fs.open;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === filename) await fs.appendFile(filename, "changed\n");
    return handle;
  };
  try {
    const result = await buildPublicationAudit(target, { surface: "repository" });
    assert.ok(result.surfaces[0].findings.some((entry) =>
      entry.path === "changing.txt" && entry.rule_id === "tracked-file-drift" && entry.classification === "blocked"
    ));
  } finally {
    fs.open = originalOpen;
  }
});

test("streamed inspection blocks excessive findings without truncating the report", async (context) => {
  const { target } = await repositoryFixture(context, "stream-findings");
  const privateIp = [192, 168, 7, 9].join(".");
  await fs.writeFile(path.join(target, "many.txt"), `${"safe".repeat(530000)}\n${(`value ${privateIp}\n`).repeat(10001)}`);
  git(target, ["add", "."]);
  const result = await buildPublicationAudit(target, { surface: "repository" });
  assert.ok(result.surfaces[0].findings.some((entry) =>
    entry.path === "many.txt" && entry.rule_id === "stream-limit-exceeded" && entry.classification === "blocked"
  ));
  assert.equal(result.surfaces[0].findings.some((entry) => entry.path === "many.txt" && entry.rule_id === "private-ipv4"), false);
});

test("small-file reads block growth after initial size inspection", async (context) => {
  const { target } = await repositoryFixture(context, "small-drift");
  const filename = path.join(target, "changing.txt");
  await fs.writeFile(filename, "safe\n");
  git(target, ["add", "."]);
  const originalOpen = fs.open;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === filename) await fs.appendFile(filename, "changed\n");
    return handle;
  };
  try {
    const result = await buildPublicationAudit(target, { surface: "repository" });
    assert.ok(result.surfaces[0].findings.some((entry) =>
      entry.path === "changing.txt" && entry.rule_id === "tracked-file-drift" && entry.classification === "blocked"
    ));
  } finally {
    fs.open = originalOpen;
  }
});
