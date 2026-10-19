import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildPublicationAudit } from "../src/publication-audit.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_PACKAGE_PATHS = [
  "src/workkeel-review-assessment.mjs",
  "docs/operations/workkeel-review-assessment.md",
  "docs/adr/0082-advisory-review-assessment.md",
  "src/workkeel-iteration.mjs",
  "docs/operations/workkeel-evidence.md",
  "src/workkeel-learning.mjs",
  "docs/extensions/workkeel-learning.md",
  "src/workkeel-dispatch.mjs",
  "src/workkeel-dispatch-classifier.mjs",
  "src/workkeel-monitor-dom.mjs",
  "docs/operations/workkeel-native-dispatch.md",
  "docs/adr/0081-native-dispatch-and-reading-state.md",
  "src/workkeel-observer-index.mjs",
  "src/workkeel-monitor-time.mjs",
  "src/workkeel-monitor-data.mjs",
  "src/workkeel-monitor-analytics.mjs",
  "src/workkeel-monitor-style.css",
  "src/workkeel-read-metrics.mjs",
  "docs/operations/workkeel-observer.md",
  "docs/adr/0080-read-only-observer-workspace.md",
  "src/workkeel-material.mjs",
  "src/workkeel-continuation.mjs",
  "src/workkeel-continuation-state.mjs",
  "docs/adr/0079-stage-material-and-confirmed-continuation.md",
  "bin/workkeel.mjs",
  "src/workkeel-cli.mjs",
  "src/workkeel-project.mjs",
  "src/workkeel-tasks.mjs",
  "src/workkeel-runtime.mjs",
  "src/workkeel-checkpoints.mjs",
  "src/workkeel-codex-host.mjs",
  "src/workkeel-codex-runtime.mjs",
  "src/workkeel-execution-policy.mjs",
  "src/workkeel-headroom.mjs",
  "src/workkeel-onboarding.mjs",
  "src/workkeel-skill-audit.mjs",
  "src/workkeel-workflow-schema.mjs",
  "src/workkeel-workflows.mjs",
  "src/workkeel-measurements.mjs",
  "src/workkeel-host-usage.mjs",
  "src/workkeel-tailnet.mjs",
  "src/workkeel-monitor.mjs",
  "src/workkeel-monitor-view.mjs",
  "src/workkeel-monitor-page.mjs",
  "src/workkeel-monitor-client.mjs",
  "src/workkeel-task-timing.mjs",
  "src/workkeel-task-summary.mjs",
  "src/workkeel-intake.mjs",
  "docs/operations/workkeel-daily-work.md",
  "docs/adr/0075-daily-task-entry-and-observation.md",
  "docs/adr/0076-explicit-evidence-artifact-sources.md",
  "docs/adr/0077-first-use-guidance.md",
  "docs/adr/0078-observer-task-lifecycle-measurements.md",
  "docs/adr/0074-on-demand-task-monitor.md",
  "docs/adr/0073-opt-in-workflow-execution.md",
  "docs/extensions/workkeel-context.md",
  "docs/operations/workkeel-workflows.md",
  "docs/assets/workkeel-workflow.svg",
  "docs/assets/workkeel-workflow-mobile.svg",
  "docs/assets/workkeel-architecture.svg",
  "docs/assets/workkeel-architecture-mobile.svg",
  "docs/assets/workkeel-flow.html",
  "docs/adr/0072-task-first-lifecycle.md",
  "docs/getting-started/workkeel.md",
  "src/task-contract.mjs",
  "docs/concepts/task-contract.md",
  "docs/adr/0090-workkeel-task-contract.md",
  "docs/adr/0091-foundations.md",
  "docs/operations/team-adoption-and-risk.md",
  "LICENSE",
  "README.md",
  "README.ja.md",
  "README.zh-TW.md",
  "package.json",
  "src/headroom-adapter.mjs",
  "src/headroom-worker.py",
  "docs/getting-started/testing.md",
  "src/workkeel-risk.mjs",
  "src/workkeel-command-supervisor.mjs",
  "src/workkeel-command-worker.mjs"
];

export const FORBIDDEN_PACKAGE_PREFIXES = [
  ".ai-org/",
  ".agents/",
  ".codex/",
  ".github/",
  ".playwright-cli/",
  "examples/",
  "integrations/",
  "node_modules/",
  "output/",
  "scripts/",
  "test/",
  "docs/validation/",
  "docs/planning/",
  "docs/research/",
  "docs/pilots/",
  "docs/policies/"
];

const ALLOWED_TOP_LEVEL_FILES = new Set([
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
  "LICENSE",
  "README.ja.md",
  "README.md",
  "README.zh-TW.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "package.json"
]);
const ALLOWED_TOP_LEVEL_DIRECTORIES = ["bin/", "docs/", "src/"];
// A bounded package catches accidental inclusion of new internal material.
const MAX_FILE_COUNT = 260;
const MAX_UNPACKED_SIZE = 4 * 1024 * 1024;

export function validatePackageDryRun(pack) {
  const failures = [];
  if (!pack || typeof pack !== "object" || !Array.isArray(pack.files)) {
    return ["npm pack dry run did not return a package manifest"];
  }

  const paths = pack.files.map((entry) => String(entry.path ?? "")).filter(Boolean);
  const pathSet = new Set(paths);
  for (const requiredPath of REQUIRED_PACKAGE_PATHS) {
    if (!pathSet.has(requiredPath)) failures.push(`required package path is missing: ${requiredPath}`);
  }

  for (const pathname of paths) {
    const forbidden = FORBIDDEN_PACKAGE_PREFIXES.find((prefix) => pathname.startsWith(prefix));
    if (forbidden) failures.push(`forbidden package path is present: ${pathname}`);
    if (
      !ALLOWED_TOP_LEVEL_FILES.has(pathname) &&
      !ALLOWED_TOP_LEVEL_DIRECTORIES.some((prefix) => pathname.startsWith(prefix))
    ) {
      failures.push(`undeclared top-level package path is present: ${pathname}`);
    }
  }

  if (paths.length > MAX_FILE_COUNT) {
    failures.push(`package file count ${paths.length} exceeds the reviewed limit ${MAX_FILE_COUNT}`);
  }
  if (!Number.isFinite(pack.unpackedSize) || pack.unpackedSize > MAX_UNPACKED_SIZE) {
    failures.push(`package unpacked size ${pack.unpackedSize ?? "unknown"} exceeds the reviewed limit ${MAX_UNPACKED_SIZE}`);
  }
  return [...new Set(failures)];
}

export async function inspectPackageDryRun(packageRoot = root) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const { stdout } = await execFileAsync(
    npmCommand,
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: packageRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== 1) throw new Error("npm pack dry run must describe exactly one package");
  return result[0];
}

export async function checkPackageBoundary(packageRoot = root) {
  const pack = await inspectPackageDryRun(packageRoot);
  const failures = validatePackageDryRun(pack);
  const publication = await buildPublicationAudit(packageRoot, {
    profileId: "public",
    surface: "package",
    filesBySurface: { package: pack.files.map((entry) => entry.path) }
  });
  if (publication.status === "blocked") {
    for (const finding of publication.surfaces[0].findings.filter((entry) => entry.classification === "blocked")) {
      failures.push(`public package evidence is blocked by ${finding.rule_id}: ${finding.path}:${finding.line}`);
    }
  }
  if (failures.length > 0) throw new Error(`Package boundary check failed:\n- ${failures.join("\n- ")}`);
  return pack;
}

async function main() {
  try {
    const pack = await checkPackageBoundary();
    console.log(
      `Package boundary verified: ${pack.files.length} files, ${pack.size} bytes packed, ${pack.unpackedSize} bytes unpacked.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
