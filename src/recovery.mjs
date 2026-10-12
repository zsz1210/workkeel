import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { GENERATED_PATHS, PROJECT_OWNED_PATHS, TEMPLATE_VERSION } from "./constants.mjs";
import {
  durableAtomicCreate,
  durableAtomicWrite,
  durableChmod,
  durableRename,
  durableUnlink,
  formatJson,
  pathExists,
  readJson,
  sha256,
  sha256File,
  toPosix
} from "./files.mjs";
import { compareTempleVersions } from "./migrations.mjs";

export const BACKUP_MANIFEST_SCHEMA = "temple.backup-manifest/v1";
export const BACKUP_SET_INSPECTION_SCHEMA = "temple.backup-set-inspection/v1";
export const BACKUP_RETENTION_PLAN_SCHEMA = "temple.backup-retention-plan/v1";
export const BACKUP_RETENTION_RESULT_SCHEMA = "temple.backup-retention-result/v1";
export const RESTORE_PLAN_SCHEMA = "temple.restore-plan/v1";
export const RECOVERY_LEDGER_SCHEMA = "temple.restore-transaction/v1";

const MAX_FILE_COUNT = 100_000;
const MAX_SINGLE_FILE_SIZE = 256 * 1024 * 1024;
const MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024;
const TERMINAL_TRANSACTION_RETENTION = 20;
const SAFE_BACKUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const PROJECT_DIRECTORIES = [
  ".ai-org/project",
  ".ai-org/learning",
  ".ai-org/work-items",
  ".ai-org/decisions",
  ".ai-org/events",
  ".ai-org/artifacts",
  ".ai-org/adapters"
];
const BACKUP_BOUNDARY = ["temple.lock", "AGENTS.md", ...PROJECT_DIRECTORIES.map((entry) => `${entry}/**`), ".agents/skills/** unless managed by temple.lock"];
const BACKUP_EXCLUSIONS = [
  ...GENERATED_PATHS,
  "framework-managed core, templates, Skills, Position configurations, TEMPLE.md, and templew.mjs",
  "application source, dependencies, Git objects, external systems, and control-plane telemetry outside the worktree"
];

function isInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function rootsOverlap(leftPath, rightPath) {
  return leftPath === rightPath || isInside(leftPath, rightPath) || isInside(rightPath, leftPath);
}

async function canonicalExistingPath(targetPath) {
  const absolutePath = path.resolve(targetPath);
  return (await pathExists(absolutePath)) ? fs.realpath(absolutePath) : absolutePath;
}

function assertSafeBackupName(name) {
  if (typeof name !== "string" || !SAFE_BACKUP_NAME.test(name)) {
    throw new Error(`Unsafe backup-set entry name: ${name}`);
  }
  return name;
}

async function explicitBackupRoot(backupRoot) {
  if (typeof backupRoot !== "string" || backupRoot.trim().length === 0) {
    throw new Error("An explicit backup root is required");
  }
  const requestedRoot = path.resolve(backupRoot);
  const rootStat = await lstatOrNull(requestedRoot);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Backup root must be an existing real directory: ${requestedRoot}`);
  }
  return fs.realpath(requestedRoot);
}

function assertSafeRelativePath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    throw new Error(`Unsafe backup path: ${relativePath}`);
  }
  return relativePath;
}

async function lstatOrNull(targetPath) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function strictWalk(rootPath, { allowMissing = false } = {}) {
  const rootStat = await lstatOrNull(rootPath);
  if (!rootStat) {
    if (allowMissing) return [];
    throw new Error(`Required directory is missing: ${rootPath}`);
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Expected a real directory, not a link or special file: ${rootPath}`);
  }
  const files = [];
  async function visit(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const stat = await fs.lstat(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in backup state: ${absolutePath}`);
      if (stat.isDirectory()) await visit(absolutePath);
      else if (stat.isFile()) files.push(toPosix(path.relative(rootPath, absolutePath)));
      else throw new Error(`Special files are not allowed in backup state: ${absolutePath}`);
    }
  }
  await visit(rootPath);
  return files;
}

async function addExactFile(target, relativePath, output) {
  const absolutePath = path.join(target, relativePath);
  const stat = await lstatOrNull(absolutePath);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Project-owned backup entry must be a regular file: ${relativePath}`);
  }
  output.add(assertSafeRelativePath(relativePath));
}

async function addDirectoryFiles(target, relativeDirectory, output) {
  const absoluteDirectory = path.join(target, relativeDirectory);
  for (const childPath of await strictWalk(absoluteDirectory, { allowMissing: true })) {
    output.add(assertSafeRelativePath(path.posix.join(relativeDirectory, childPath)));
  }
}

async function readInstalledState(target) {
  const lockPath = path.join(target, "temple.lock");
  if (!(await pathExists(lockPath))) throw new Error("temple.lock is missing; initialize Temple before creating a backup");
  const lock = await readJson(lockPath);
  const projectPath = path.join(target, ".ai-org/project/project.json");
  const project = (await pathExists(projectPath)) ? await readJson(projectPath) : null;
  const projectId = project?.id ?? lock.project_id;
  if (!projectId || (project?.id && lock.project_id && project.id !== lock.project_id)) {
    throw new Error("Temple project identity is missing or inconsistent");
  }
  return { lock, project, projectId };
}

export async function collectBackupFiles(target) {
  const { lock } = await readInstalledState(target);
  const output = new Set();
  await addExactFile(target, "temple.lock", output);
  await addExactFile(target, "AGENTS.md", output);
  for (const relativeDirectory of PROJECT_DIRECTORIES) await addDirectoryFiles(target, relativeDirectory, output);

  const managedFiles = new Set((lock.managed_files ?? []).map((entry) => entry.path));
  const skillsRoot = path.join(target, ".agents/skills");
  for (const childPath of await strictWalk(skillsRoot, { allowMissing: true })) {
    const relativePath = assertSafeRelativePath(path.posix.join(".agents/skills", childPath));
    if (!managedFiles.has(relativePath)) output.add(relativePath);
  }
  return [...output].sort();
}

function gitValue(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function gitMetadata(target) {
  const revision = gitValue(target, ["rev-parse", "HEAD"]);
  const status = gitValue(target, ["status", "--porcelain", "--untracked-files=all"]);
  return { revision, dirty: status === null ? null : status.length > 0 };
}

function entryDigest(entries) {
  return sha256(JSON.stringify(entries));
}

function manifestDigest(manifest) {
  return sha256(formatJson(manifest));
}

function validateEntryShape(entry) {
  assertSafeRelativePath(entry.path);
  if (!Number.isInteger(entry.size) || entry.size < 0 || entry.size > MAX_SINGLE_FILE_SIZE) {
    throw new Error(`Invalid or oversized backup entry: ${entry.path}`);
  }
  if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) {
    throw new Error(`Invalid file mode in backup entry: ${entry.path}`);
  }
  if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) throw new Error(`Invalid SHA-256 in backup entry: ${entry.path}`);
}

async function validateManifest(manifest, backupDirectory) {
  if (manifest.schema_version !== BACKUP_MANIFEST_SCHEMA) {
    throw new Error(`Unsupported backup manifest schema: ${manifest.schema_version ?? "missing"}`);
  }
  if (!manifest.project?.id || !manifest.temple?.version || !Array.isArray(manifest.files)) {
    throw new Error("Backup manifest is missing project, Temple version, or file entries");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.temple.version)) {
    throw new Error(`Backup declares an invalid Temple version: ${manifest.temple.version}`);
  }
  if (!Array.isArray(manifest.boundary) || !Array.isArray(manifest.exclusions)) {
    throw new Error("Backup manifest is missing its inclusion or exclusion boundary");
  }
  if (manifest.files.length > MAX_FILE_COUNT) throw new Error(`Backup contains more than ${MAX_FILE_COUNT} files`);
  const paths = manifest.files.map((entry) => entry.path);
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) throw new Error("Backup entries are not sorted");
  if (new Set(paths).size !== paths.length) throw new Error("Backup entries contain duplicate paths");
  let totalSize = 0;
  for (const entry of manifest.files) {
    validateEntryShape(entry);
    totalSize += entry.size;
    if (totalSize > MAX_TOTAL_SIZE) throw new Error(`Backup exceeds ${MAX_TOTAL_SIZE} bytes`);
  }
  if (entryDigest(manifest.files) !== manifest.content_digest) throw new Error("Backup content digest does not match its entries");

  const payloadRoot = path.join(backupDirectory, "files");
  const actualPaths = (await strictWalk(payloadRoot)).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(paths)) {
    throw new Error("Backup payload paths do not exactly match the manifest");
  }
  for (const entry of manifest.files) {
    const payloadPath = path.join(payloadRoot, entry.path);
    const stat = await fs.stat(payloadPath);
    if (stat.size !== entry.size) throw new Error(`Backup size mismatch: ${entry.path}`);
    if ((stat.mode & 0o777) !== entry.mode) throw new Error(`Backup mode mismatch: ${entry.path}`);
    if ((await sha256File(payloadPath)) !== entry.sha256) throw new Error(`Backup checksum mismatch: ${entry.path}`);
  }
  const lockEntry = manifest.files.find((entry) => entry.path === "temple.lock");
  const projectEntry = manifest.files.find((entry) => entry.path === ".ai-org/project/project.json");
  if (!lockEntry || !projectEntry) throw new Error("Backup must include temple.lock and the project identity document");
  const [lock, project] = await Promise.all([
    readJson(path.join(payloadRoot, lockEntry.path)),
    readJson(path.join(payloadRoot, projectEntry.path))
  ]);
  if (lock.project_id !== manifest.project.id || project.id !== manifest.project.id) {
    throw new Error("Backup project identity does not match its manifest");
  }
  if (lock.template?.version !== manifest.temple.version) {
    throw new Error("Backup installed Temple version does not match its manifest");
  }
  return totalSize;
}

export async function createBackup(target, outputDirectory) {
  const absoluteTarget = await canonicalExistingPath(target);
  const requestedOutput = path.resolve(outputDirectory);
  await fs.mkdir(path.dirname(requestedOutput), { recursive: true });
  const absoluteOutput = path.join(await fs.realpath(path.dirname(requestedOutput)), path.basename(requestedOutput));
  if (absoluteOutput === absoluteTarget || isInside(absoluteTarget, absoluteOutput)) {
    throw new Error("Backup output must be outside the project worktree");
  }
  if (await pathExists(absoluteOutput)) throw new Error(`Backup output already exists: ${absoluteOutput}`);
  const { projectId, lock } = await readInstalledState(absoluteTarget);
  const installedVersion = lock.template?.version;
  if (!installedVersion) throw new Error("temple.lock does not declare an installed Temple version");
  const relativePaths = await collectBackupFiles(absoluteTarget);
  const stagingDirectory = path.join(
    path.dirname(absoluteOutput),
    `.${path.basename(absoluteOutput)}.temple-staging-${crypto.randomUUID()}`
  );
  await fs.mkdir(path.join(stagingDirectory, "files"), { recursive: true });
  try {
    const files = [];
    let totalSize = 0;
    for (const relativePath of relativePaths) {
      if (files.length >= MAX_FILE_COUNT) throw new Error(`Backup contains more than ${MAX_FILE_COUNT} files`);
      const sourcePath = path.join(absoluteTarget, relativePath);
      const stat = await fs.lstat(sourcePath);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Backup source changed type: ${relativePath}`);
      if (stat.size > MAX_SINGLE_FILE_SIZE) throw new Error(`Backup source is too large: ${relativePath}`);
      totalSize += stat.size;
      if (totalSize > MAX_TOTAL_SIZE) throw new Error(`Backup exceeds ${MAX_TOTAL_SIZE} bytes`);
      const content = await fs.readFile(sourcePath);
      const entry = { path: relativePath, size: content.length, mode: stat.mode & 0o777, sha256: sha256(content) };
      const payloadPath = path.join(stagingDirectory, "files", relativePath);
      await durableAtomicCreate(payloadPath, content);
      await durableChmod(payloadPath, entry.mode);
      files.push(entry);
    }
    const git = gitMetadata(absoluteTarget);
    const manifest = {
      schema_version: BACKUP_MANIFEST_SCHEMA,
      created_at: new Date().toISOString(),
      project: { id: projectId },
      temple: { version: installedVersion },
      git,
      boundary: BACKUP_BOUNDARY,
      exclusions: BACKUP_EXCLUSIONS,
      files,
      content_digest: entryDigest(files)
    };
    await durableAtomicCreate(path.join(stagingDirectory, "manifest.json"), formatJson(manifest));
    await inspectBackup(stagingDirectory);
    await durableRename(stagingDirectory, absoluteOutput);
    return {
      schema_version: BACKUP_MANIFEST_SCHEMA,
      backup: absoluteOutput,
      project_id: projectId,
      temple_version: installedVersion,
      file_count: files.length,
      total_size: totalSize,
      content_digest: manifest.content_digest,
      manifest_digest: manifestDigest(manifest),
      git
    };
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function inspectBackup(backupDirectory) {
  const absoluteBackup = await canonicalExistingPath(backupDirectory);
  const rootStat = await lstatOrNull(absoluteBackup);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Backup directory is missing or unsafe: ${absoluteBackup}`);
  }
  const manifestPath = path.join(absoluteBackup, "manifest.json");
  const manifestStat = await lstatOrNull(manifestPath);
  if (!manifestStat || manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error("Backup manifest is missing or unsafe");
  }
  const rootEntries = (await fs.readdir(absoluteBackup)).sort();
  if (JSON.stringify(rootEntries) !== JSON.stringify(["files", "manifest.json"])) {
    throw new Error("Backup root must contain only manifest.json and files/");
  }
  const manifest = await readJson(manifestPath);
  const totalSize = await validateManifest(manifest, absoluteBackup);
  return {
    schema_version: BACKUP_MANIFEST_SCHEMA,
    backup: absoluteBackup,
    valid: true,
    project_id: manifest.project.id,
    temple_version: manifest.temple.version,
    file_count: manifest.files.length,
    total_size: totalSize,
    content_digest: manifest.content_digest,
    manifest_digest: manifestDigest(manifest),
    manifest
  };
}

function backupSetDigest(backups) {
  return sha256(
    JSON.stringify(
      backups.map((backup) => ({
        name: backup.name,
        project_id: backup.project_id,
        created_at: backup.created_at,
        temple_version: backup.temple_version,
        file_count: backup.file_count,
        total_size: backup.total_size,
        content_digest: backup.content_digest,
        manifest_digest: backup.manifest_digest
      }))
    )
  );
}

export async function inspectBackupSet(backupRoot, options = {}) {
  const absoluteRoot = await explicitBackupRoot(backupRoot);
  if (options.projectRoot !== undefined && options.projectRoot !== null) {
    const projectRoot = await canonicalExistingPath(options.projectRoot);
    if (rootsOverlap(projectRoot, absoluteRoot)) {
      throw new Error("Backup root and project worktree must not contain one another");
    }
  }

  const backups = [];
  const entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const name = assertSafeBackupName(entry.name);
    const candidate = path.join(absoluteRoot, name);
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Backup-set entries must be real backup directories: ${name}`);
    }
    if (path.dirname(candidate) !== absoluteRoot || !isInside(absoluteRoot, candidate)) {
      throw new Error(`Backup-set entry resolves outside the backup root: ${name}`);
    }
    const inspection = await inspectBackup(candidate);
    const createdAt = inspection.manifest.created_at;
    if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) {
      throw new Error(`Backup has an invalid creation time: ${name}`);
    }
    backups.push({
      name,
      backup: candidate,
      project_id: inspection.project_id,
      created_at: createdAt,
      temple_version: inspection.temple_version,
      file_count: inspection.file_count,
      total_size: inspection.total_size,
      content_digest: inspection.content_digest,
      manifest_digest: inspection.manifest_digest
    });
  }

  return {
    schema_version: BACKUP_SET_INSPECTION_SCHEMA,
    backup_root: absoluteRoot,
    backup_count: backups.length,
    inspection_digest: backupSetDigest(backups),
    backups
  };
}

function retentionPlanDigest(plan) {
  return sha256(
    JSON.stringify({
      schema_version: plan.schema_version,
      backup_root: plan.backup_root,
      project_root: plan.project_root,
      project_id: plan.project_id,
      minimum_to_keep: plan.minimum_to_keep,
      preserve_backup_names: plan.preserve_backup_names,
      inspection_digest: plan.inspection_digest,
      decisions: plan.decisions
    })
  );
}

function retentionOptions(options) {
  const minimumToKeep = options.minimumToKeep;
  if (!Number.isSafeInteger(minimumToKeep) || minimumToKeep < 1) {
    throw new Error("Backup retention requires an explicit minimumToKeep integer of at least 1");
  }
  if (options.preserveBackupNames !== undefined && !Array.isArray(options.preserveBackupNames)) {
    throw new Error("preserveBackupNames must be an array of direct backup names");
  }
  const preserveBackupNames = [...new Set((options.preserveBackupNames ?? []).map(assertSafeBackupName))].sort();
  return { minimumToKeep, preserveBackupNames };
}

export async function planBackupRetention(target, backupRoot, options = {}) {
  const absoluteTarget = await canonicalExistingPath(target);
  const { projectId } = await readInstalledState(absoluteTarget);
  const { minimumToKeep, preserveBackupNames } = retentionOptions(options);
  const inspection = await inspectBackupSet(backupRoot, { projectRoot: absoluteTarget });
  const knownNames = new Set(inspection.backups.map((backup) => backup.name));
  const unknownPreserves = preserveBackupNames.filter((name) => !knownNames.has(name));
  if (unknownPreserves.length > 0) {
    throw new Error(`Preserved backup names are not present under the backup root: ${unknownPreserves.join(", ")}`);
  }

  const targetBackups = inspection.backups
    .filter((backup) => backup.project_id === projectId)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) || left.name.localeCompare(right.name));
  const minimumNames = new Set(targetBackups.slice(0, minimumToKeep).map((backup) => backup.name));
  const preserveNames = new Set(preserveBackupNames);
  const decisions = inspection.backups.map((backup) => {
    let action = "keep";
    let reason = "different-project";
    if (backup.project_id === projectId) {
      if (preserveNames.has(backup.name)) reason = "explicit-preserve";
      else if (minimumNames.has(backup.name)) reason = "minimum-preservation";
      else {
        action = "delete";
        reason = "outside-retention-minimum";
      }
    }
    return {
      name: backup.name,
      backup: backup.backup,
      project_id: backup.project_id,
      created_at: backup.created_at,
      manifest_digest: backup.manifest_digest,
      action,
      reason
    };
  });
  const plan = {
    schema_version: BACKUP_RETENTION_PLAN_SCHEMA,
    backup_root: inspection.backup_root,
    project_root: absoluteTarget,
    project_id: projectId,
    minimum_to_keep: minimumToKeep,
    preserve_backup_names: preserveBackupNames,
    inspection_digest: inspection.inspection_digest,
    decisions,
    keep_count: decisions.filter((entry) => entry.action === "keep").length,
    delete_count: decisions.filter((entry) => entry.action === "delete").length
  };
  plan.plan_digest = retentionPlanDigest(plan);
  return plan;
}

async function preflightRetentionDeletion(plan, decision) {
  assertSafeBackupName(decision.name);
  const expectedPath = path.join(plan.backup_root, decision.name);
  if (
    decision.backup !== expectedPath ||
    path.dirname(expectedPath) !== plan.backup_root ||
    !isInside(plan.backup_root, expectedPath) ||
    rootsOverlap(plan.project_root, expectedPath)
  ) {
    throw new Error(`Refusing retention target outside its resolved backup root: ${decision.name}`);
  }
  const stat = await lstatOrNull(expectedPath);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Retention target is missing, linked, or not a directory: ${decision.name}`);
  }
  const inspection = await inspectBackup(expectedPath);
  if (inspection.project_id !== plan.project_id || inspection.manifest_digest !== decision.manifest_digest) {
    throw new Error(`Retention target changed after preview: ${decision.name}`);
  }
}

export async function applyBackupRetention(target, backupRoot, options = {}) {
  if (typeof options.expectedPlan !== "string" || options.expectedPlan.length === 0) {
    throw new Error("Backup retention apply requires the digest returned by retention preview");
  }
  if (options.confirmDelete !== true) {
    throw new Error("Backup retention apply requires explicit delete consent");
  }
  const plan = await planBackupRetention(target, backupRoot, options);
  if (plan.plan_digest !== options.expectedPlan) {
    throw new Error("Backup retention preview is stale; create and review a new plan");
  }
  const deletions = plan.decisions.filter((entry) => entry.action === "delete");
  for (const decision of deletions) await preflightRetentionDeletion(plan, decision);

  const deleted = [];
  try {
    for (const decision of deletions) {
      await fs.rm(decision.backup, { recursive: true });
      deleted.push(decision.name);
      if (options.simulateFailureAfterDeletes === deleted.length) {
        throw new Error("Simulated backup retention deletion failure");
      }
    }
  } catch (error) {
    const failure = new Error(
      `Backup retention stopped after ${deleted.length} deletion(s); create a new preview before retrying: ${error.message}`,
      { cause: error }
    );
    failure.code = "TEMPLE_BACKUP_RETENTION_PARTIAL_FAILURE";
    failure.deleted = deleted;
    failure.remaining = deletions.filter((entry) => !deleted.includes(entry.name)).map((entry) => entry.name);
    throw failure;
  }

  return {
    schema_version: BACKUP_RETENTION_RESULT_SCHEMA,
    backup_root: plan.backup_root,
    project_id: plan.project_id,
    plan_digest: plan.plan_digest,
    deleted,
    deleted_count: deleted.length,
    preserved_count: plan.keep_count
  };
}

async function targetProjectState(target) {
  const projectPath = path.join(target, ".ai-org/project/project.json");
  const lockPath = path.join(target, "temple.lock");
  const [project, lock] = await Promise.all([
    (await pathExists(projectPath)) ? readJson(projectPath) : null,
    (await pathExists(lockPath)) ? readJson(lockPath) : null
  ]);
  return {
    projectId: project?.id ?? lock?.project_id ?? null,
    templeVersion: lock?.template?.version ?? null
  };
}

function restorePlanDigest(plan) {
  return sha256(
    JSON.stringify({
      schema_version: plan.schema_version,
      target: plan.target,
      target_project_id: plan.target_project_id,
      backup_manifest_digest: plan.backup_manifest_digest,
      compatibility: plan.compatibility,
      actions: plan.actions,
      extras: plan.extras
    })
  );
}

export async function planRestore(target, backupDirectory) {
  const absoluteTarget = await canonicalExistingPath(target);
  const inspection = await inspectBackup(backupDirectory);
  const targetState = await targetProjectState(absoluteTarget);
  const existingProjectId = targetState.projectId;
  const conflicts = [];
  if (inspection.backup === absoluteTarget || isInside(absoluteTarget, inspection.backup)) {
    conflicts.push("backup directory must remain outside the restore target");
  }
  if (existingProjectId && existingProjectId !== inspection.project_id) {
    conflicts.push(`backup project ${inspection.project_id} does not match target project ${existingProjectId}`);
  }
  if (targetState.templeVersion && targetState.templeVersion !== inspection.temple_version) {
    conflicts.push(
      `backup Temple version ${inspection.temple_version} does not match target installation ${targetState.templeVersion}; restore into a checkout prepared at the backup version first`
    );
  }
  const versionComparison = compareTempleVersions(inspection.temple_version, TEMPLATE_VERSION);
  if (versionComparison > 0) {
    conflicts.push(`backup Temple version ${inspection.temple_version} is newer than this CLI ${TEMPLATE_VERSION}`);
  }
  const actions = [];
  for (const entry of inspection.manifest.files) {
    const targetPath = path.join(absoluteTarget, entry.path);
    const stat = await lstatOrNull(targetPath);
    if (!stat) {
      actions.push({ path: entry.path, action: "create", before_sha256: null, after_sha256: entry.sha256, mode: entry.mode });
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      conflicts.push(`target path is not a regular file: ${entry.path}`);
      continue;
    }
    const beforeHash = await sha256File(targetPath);
    actions.push({
      path: entry.path,
      action: beforeHash === entry.sha256 ? "identical" : "replace",
      before_sha256: beforeHash,
      after_sha256: entry.sha256,
      mode: entry.mode
    });
  }
  const existingFiles = await collectExistingCanonicalFiles(absoluteTarget);
  const backupPaths = new Set(inspection.manifest.files.map((entry) => entry.path));
  const extras = existingFiles.filter((relativePath) => !backupPaths.has(relativePath));
  const plan = {
    schema_version: RESTORE_PLAN_SCHEMA,
    generated_at: new Date().toISOString(),
    target: absoluteTarget,
    backup: inspection.backup,
    target_project_id: existingProjectId,
    backup_project_id: inspection.project_id,
    backup_manifest_digest: inspection.manifest_digest,
    compatibility: {
      cli_version: TEMPLATE_VERSION,
      backup_version: inspection.temple_version,
      target_version: targetState.templeVersion,
      upgrade_required: versionComparison < 0
    },
    actions,
    extras,
    conflicts,
    canonical_state_changed: false
  };
  plan.plan_digest = restorePlanDigest(plan);
  return plan;
}

async function collectExistingCanonicalFiles(target) {
  const output = new Set();
  await addExactFile(target, "temple.lock", output);
  await addExactFile(target, "AGENTS.md", output);
  for (const relativeDirectory of PROJECT_DIRECTORIES) await addDirectoryFiles(target, relativeDirectory, output);
  const lockPath = path.join(target, "temple.lock");
  const managedFiles = new Set(
    (await pathExists(lockPath)) ? ((await readJson(lockPath)).managed_files ?? []).map((entry) => entry.path) : []
  );
  for (const childPath of await strictWalk(path.join(target, ".agents/skills"), { allowMissing: true })) {
    const relativePath = assertSafeRelativePath(path.posix.join(".agents/skills", childPath));
    if (!managedFiles.has(relativePath)) output.add(relativePath);
  }
  return [...output].sort();
}

export function resolveRecoveryStateDirectory(target) {
  const absoluteTarget = path.resolve(target);
  const commonDirectory = gitValue(absoluteTarget, ["rev-parse", "--git-common-dir"]);
  if (commonDirectory) {
    const absoluteCommon = path.resolve(absoluteTarget, commonDirectory);
    return path.join(absoluteCommon, "temple", "recovery");
  }
  return path.join(path.dirname(absoluteTarget), `.${path.basename(absoluteTarget)}.temple-recovery`);
}

function assertTransactionId(transactionId) {
  if (typeof transactionId !== "string" || transactionId.length > 160 || !/^[A-Za-z0-9-]+$/.test(transactionId)) {
    throw new Error("Recovery transaction ID is unsafe");
  }
  return transactionId;
}

function transactionPaths(stateDirectory, transactionId) {
  assertTransactionId(transactionId);
  const transactionDirectory = path.join(stateDirectory, "transactions", transactionId);
  return {
    transactionDirectory,
    ledgerPath: path.join(transactionDirectory, "ledger.json"),
    beforeDirectory: path.join(transactionDirectory, "before"),
    activePath: path.join(stateDirectory, "active.json")
  };
}

async function writeLedger(ledgerPath, ledger) {
  await durableAtomicWrite(ledgerPath, formatJson(ledger));
}

async function clearActive(activePath, transactionId) {
  if (!(await pathExists(activePath))) return;
  const active = await readJson(activePath);
  if (active.transaction_id !== transactionId) throw new Error("Recovery active pointer changed unexpectedly");
  await durableUnlink(activePath);
}

async function pruneTransactions(stateDirectory) {
  const root = path.join(stateDirectory, "transactions");
  if (!(await pathExists(root))) return;
  const terminal = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const ledgerPath = path.join(directory, "ledger.json");
    try {
      const ledger = await readJson(ledgerPath);
      if (["completed", "rolled_back"].includes(ledger.status)) {
        terminal.push({ directory, timestamp: ledger.completed_at ?? ledger.rolled_back_at ?? ledger.created_at ?? "" });
      }
    } catch {
      // Unknown or incomplete transaction directories are retained for manual inspection.
    }
  }
  terminal.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  for (const entry of terminal.slice(TERMINAL_TRANSACTION_RETENTION)) {
    if (!isInside(root, entry.directory)) throw new Error("Refusing to prune outside the recovery transaction root");
    await fs.rm(entry.directory, { recursive: true, force: true });
  }
}

async function prepareTransaction(plan, inspection) {
  const stateDirectory = resolveRecoveryStateDirectory(plan.target);
  await fs.mkdir(path.join(stateDirectory, "transactions"), { recursive: true });
  const activePath = path.join(stateDirectory, "active.json");
  if (await pathExists(activePath)) throw new Error(`An unfinished restore exists; run temple restore recover ${plan.target}`);
  const transactionId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${crypto.randomUUID()}`;
  const paths = transactionPaths(stateDirectory, transactionId);
  await fs.mkdir(paths.beforeDirectory, { recursive: true });
  const actions = [];
  for (const action of plan.actions.filter((entry) => entry.action !== "identical")) {
    const targetPath = path.join(plan.target, action.path);
    const targetStat = await lstatOrNull(targetPath);
    let beforeMode = null;
    if (action.before_sha256 !== null) {
      if (!targetStat || targetStat.isSymbolicLink() || !targetStat.isFile()) {
        throw new Error(`Restore target changed after preview: ${action.path}`);
      }
      const before = await fs.readFile(targetPath);
      if (sha256(before) !== action.before_sha256) throw new Error(`Restore target changed after preview: ${action.path}`);
      beforeMode = targetStat.mode & 0o777;
      await durableAtomicCreate(path.join(paths.beforeDirectory, action.path), before);
    } else if (targetStat) {
      throw new Error(`Restore target appeared after preview: ${action.path}`);
    }
    actions.push({
      ...action,
      before_mode: beforeMode,
      state: "pending"
    });
  }
  const ledger = {
    schema_version: RECOVERY_LEDGER_SCHEMA,
    transaction_id: transactionId,
    status: "prepared",
    created_at: new Date().toISOString(),
    target: plan.target,
    backup: inspection.backup,
    backup_manifest_digest: inspection.manifest_digest,
    plan_digest: plan.plan_digest,
    actions
  };
  await durableAtomicCreate(paths.ledgerPath, formatJson(ledger));
  await durableAtomicCreate(
    paths.activePath,
    formatJson({ schema_version: RECOVERY_LEDGER_SCHEMA, transaction_id: transactionId, target: plan.target })
  );
  return { stateDirectory, paths, ledger };
}

async function rollbackTransaction(stateDirectory, paths, ledger) {
  ledger.status = "rolling_back";
  await writeLedger(paths.ledgerPath, ledger);
  const failures = [];
  for (let index = ledger.actions.length - 1; index >= 0; index -= 1) {
    const action = ledger.actions[index];
    if (action.state === "pending" || action.state === "rolled_back") continue;
    const targetPath = path.join(ledger.target, action.path);
    try {
      const stat = await lstatOrNull(targetPath);
      const currentHash = stat?.isFile() && !stat.isSymbolicLink() ? await sha256File(targetPath) : null;
      if (action.state === "writing" && currentHash === action.before_sha256) {
        action.state = "rolled_back";
        await writeLedger(paths.ledgerPath, ledger);
        continue;
      }
      if (currentHash !== action.after_sha256) {
        throw new Error("target no longer matches the interrupted restore output");
      }
      if (action.before_sha256 === null) {
        await durableUnlink(targetPath);
      } else {
        const beforePath = path.join(paths.beforeDirectory, action.path);
        const before = await fs.readFile(beforePath);
        if (sha256(before) !== action.before_sha256) throw new Error("before-image checksum mismatch");
        await durableAtomicWrite(targetPath, before);
        await durableChmod(targetPath, action.before_mode);
      }
      action.state = "rolled_back";
      await writeLedger(paths.ledgerPath, ledger);
    } catch (error) {
      failures.push(`${action.path}: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    ledger.status = "recovery_blocked";
    ledger.recovery_failures = failures;
    await writeLedger(paths.ledgerPath, ledger);
    throw new Error(`Restore recovery stopped to preserve newer changes:\n- ${failures.join("\n- ")}`);
  }
  ledger.status = "rolled_back";
  ledger.rolled_back_at = new Date().toISOString();
  delete ledger.recovery_failures;
  await writeLedger(paths.ledgerPath, ledger);
  await fs.rm(paths.beforeDirectory, { recursive: true, force: true });
  await clearActive(paths.activePath, ledger.transaction_id);
  await pruneTransactions(stateDirectory);
  return ledger;
}

export async function applyRestore(target, backupDirectory, options = {}) {
  const plan = await planRestore(target, backupDirectory);
  if (!options.expectedPlan) throw new Error("restore apply requires the digest returned by restore preview");
  if (plan.plan_digest !== options.expectedPlan) throw new Error("Restore preview is stale; run restore preview again");
  if (plan.conflicts.length > 0) throw new Error(`Restore has conflicts:\n- ${plan.conflicts.join("\n- ")}`);
  const replacements = plan.actions.filter((entry) => entry.action === "replace");
  if (replacements.length > 0 && options.allowReplace !== true) {
    throw new Error(`Restore would replace ${replacements.length} existing file(s); pass --allow-replace after reviewing the preview`);
  }
  const inspection = await inspectBackup(backupDirectory);
  if (inspection.manifest_digest !== plan.backup_manifest_digest) throw new Error("Backup changed after restore preview");
  const transaction = await prepareTransaction(plan, inspection);
  const { stateDirectory, paths, ledger } = transaction;
  try {
    ledger.status = "applying";
    await writeLedger(paths.ledgerPath, ledger);
    let writes = 0;
    for (const action of ledger.actions) {
      const targetPath = path.join(plan.target, action.path);
      const currentStat = await lstatOrNull(targetPath);
      const currentHash = currentStat?.isFile() && !currentStat.isSymbolicLink() ? await sha256File(targetPath) : null;
      if (currentHash !== action.before_sha256) throw new Error(`Restore target changed before write: ${action.path}`);
      const payload = await fs.readFile(path.join(inspection.backup, "files", action.path));
      if (sha256(payload) !== action.after_sha256) throw new Error(`Backup payload changed before write: ${action.path}`);
      action.state = "writing";
      await writeLedger(paths.ledgerPath, ledger);
      if (action.before_sha256 === null) await durableAtomicCreate(targetPath, payload);
      else await durableAtomicWrite(targetPath, payload);
      await durableChmod(targetPath, action.mode);
      writes += 1;
      if (options.simulateCrashAfterWrites === writes) {
        const error = new Error("Simulated restore interruption");
        error.templeSimulatedCrash = true;
        throw error;
      }
      if (options.simulateFailureAfterWrites === writes) throw new Error("Simulated ordinary restore failure");
      action.state = "applied";
      await writeLedger(paths.ledgerPath, ledger);
    }
    ledger.status = "completed";
    ledger.completed_at = new Date().toISOString();
    await writeLedger(paths.ledgerPath, ledger);
    if (options.simulateCrashAfterCommit === true) {
      const error = new Error("Simulated restore interruption after commit");
      error.templeSimulatedCrash = true;
      throw error;
    }
    const cleanupWarnings = [];
    try {
      await fs.rm(paths.beforeDirectory, { recursive: true, force: true });
      await clearActive(paths.activePath, ledger.transaction_id);
      await pruneTransactions(stateDirectory);
    } catch (error) {
      cleanupWarnings.push(error.message);
    }
    return {
      schema_version: RECOVERY_LEDGER_SCHEMA,
      transaction_id: ledger.transaction_id,
      status: ledger.status,
      plan_digest: plan.plan_digest,
      created: plan.actions.filter((entry) => entry.action === "create").length,
      replaced: replacements.length,
      identical: plan.actions.filter((entry) => entry.action === "identical").length,
      extras_preserved: plan.extras.length,
      upgrade_required: plan.compatibility.upgrade_required,
      cleanup_pending: cleanupWarnings.length > 0,
      cleanup_warnings: cleanupWarnings
    };
  } catch (error) {
    if (error.templeSimulatedCrash) throw error;
    try {
      await rollbackTransaction(stateDirectory, paths, ledger);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Restore failed and automatic recovery was incomplete");
    }
    throw error;
  }
}

export async function recoverRestore(target) {
  const absoluteTarget = await canonicalExistingPath(target);
  const stateDirectory = resolveRecoveryStateDirectory(absoluteTarget);
  const activePath = path.join(stateDirectory, "active.json");
  if (!(await pathExists(activePath))) {
    return { schema_version: RECOVERY_LEDGER_SCHEMA, status: "clean", target: absoluteTarget };
  }
  const active = await readJson(activePath);
  if (active.schema_version !== RECOVERY_LEDGER_SCHEMA || active.target !== absoluteTarget) {
    throw new Error("Recovery active pointer does not match this target");
  }
  assertTransactionId(active.transaction_id);
  const paths = transactionPaths(stateDirectory, active.transaction_id);
  const ledger = await readJson(paths.ledgerPath);
  if (
    ledger.schema_version !== RECOVERY_LEDGER_SCHEMA ||
    ledger.transaction_id !== active.transaction_id ||
    ledger.target !== absoluteTarget
  ) {
    throw new Error("Recovery ledger does not match the active transaction");
  }
  if (!Array.isArray(ledger.actions)) throw new Error("Recovery ledger actions are invalid");
  for (const action of ledger.actions) {
    assertSafeRelativePath(action.path);
    if (!["pending", "writing", "applied", "rolled_back"].includes(action.state)) {
      throw new Error(`Recovery ledger action state is invalid: ${action.path}`);
    }
    if (action.before_sha256 !== null && !/^[a-f0-9]{64}$/.test(action.before_sha256 ?? "")) {
      throw new Error(`Recovery ledger before-image digest is invalid: ${action.path}`);
    }
    if (!/^[a-f0-9]{64}$/.test(action.after_sha256 ?? "")) {
      throw new Error(`Recovery ledger output digest is invalid: ${action.path}`);
    }
  }
  if (["completed", "rolled_back"].includes(ledger.status)) {
    await fs.rm(paths.beforeDirectory, { recursive: true, force: true });
    await clearActive(paths.activePath, ledger.transaction_id);
    await pruneTransactions(stateDirectory);
    return {
      schema_version: RECOVERY_LEDGER_SCHEMA,
      transaction_id: ledger.transaction_id,
      status: ledger.status,
      target: absoluteTarget
    };
  }
  const recovered = await rollbackTransaction(stateDirectory, paths, ledger);
  return {
    schema_version: RECOVERY_LEDGER_SCHEMA,
    transaction_id: recovered.transaction_id,
    status: recovered.status,
    target: absoluteTarget
  };
}

export const BACKUP_POLICY = {
  project_owned: PROJECT_OWNED_PATHS,
  included: BACKUP_BOUNDARY,
  excluded: BACKUP_EXCLUSIONS,
  limits: {
    files: MAX_FILE_COUNT,
    single_file_bytes: MAX_SINGLE_FILE_SIZE,
    total_bytes: MAX_TOTAL_SIZE
  }
};
