import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildPublicationAudit } from "../src/publication-audit.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_PACKAGE_PATHS = [
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
  "src/workkeel-monitor.mjs",
  "src/workkeel-monitor-view.mjs",
  "src/workkeel-monitor-page.mjs",
  "src/workkeel-task-summary.mjs",
  "src/workkeel-intake.mjs",
  "docs/operations/workkeel-daily-work.md",
  "docs/adr/0075-daily-task-entry-and-observation.md",
  "docs/adr/0076-explicit-evidence-artifact-sources.md",
  "docs/adr/0077-first-use-guidance.md",
  "docs/operations/evidence-source-recovery.md",
  "docs/adr/0074-on-demand-task-monitor.md",
  "docs/validation/workkeel-development-routing.md",
  "docs/adr/0073-opt-in-workflow-execution.md",
  "docs/extensions/workkeel-context.md",
  "docs/operations/workkeel-workflows.md",
  "docs/operations/workkeel-measurements.md",
  "docs/validation/workkeel-automation.md",
  "docs/assets/workkeel-workflow.svg",
  "docs/assets/workkeel-workflow-mobile.svg",
  "docs/assets/workkeel-architecture.svg",
  "docs/assets/workkeel-architecture-mobile.svg",
  "docs/assets/workkeel-flow.html",
  "docs/adr/0072-task-first-lifecycle.md",
  "docs/getting-started/workkeel.md",
  "src/task-contract.mjs",
  "docs/concepts/task-contract.md",
  "docs/adr/0071-workkeel-task-contract.md",
  "docs/getting-started/team-entry.md",
  "LICENSE",
  "README.md",
  "README.ja.md",
  "README.zh-TW.md",
  "package.json",
  "bin/temple.mjs",
  "src/cli.mjs",
  "src/headroom-adapter.mjs",
  "src/headroom-worker.py",
  "docs/extensions/headroom-adapter.md",
  "src/evidence-view.mjs",
  "docs/operations/compact-evidence.md",
  "docs/adr/0070-compact-evidence-reading-view.md",
  "src/learning-review.mjs",
  "src/completion-diagnostics.mjs",
  "src/portable-finish-diagnostics.mjs",
  "docs/adr/0068-collaborative-completion-recovery.md",
  "project-overlay/.ai-org/core/schemas/learning-review.schema.json",
  "project-overlay/.ai-org/templates/learning-review.json",
  "docs/adr/0066-demand-driven-learning-review-coverage.md",
  "src/daily-delivery.mjs",
  "src/delivery-ledger.mjs",
  "src/delivery-check.mjs",
  "src/delivery-check-worker.mjs",
  "src/workflow-completion.mjs",
  "src/confined-check.mjs",
  "docs/operations/autonomous-delivery.md",
  "docs/validation/autonomous-main-checkpoint.md",
  "docs/adr/0065-unified-autonomous-delivery.md",
  "docs/operations/daily-delivery.md",
  "docs/adr/0064-daily-core-delivery.md",
  "project-overlay/.agents/skills/temple-work/references/daily-delivery.md",
  "project-overlay/TEMPLE.md",
  "project-overlay/templew.mjs",
  "project-overlay/.ai-org/core/policies.json",
  "project-overlay/.agents/skills/temple-work/SKILL.md",
  "project-overlay/.agents/skills/temple-work/references/read-only-support.md",
  "docs/adr/0059-proportionate-work-routes.md",
  "packs/build-quality/manifest.json",
  "docs/getting-started/testing.md",
  "docs/validation/alpha-33-package-qualification.md"
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
  "test/"
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
const ALLOWED_TOP_LEVEL_DIRECTORIES = ["bin/", "docs/", "packs/", "project-overlay/", "src/"];
// Integrates proportionate routes and optional task material.
// WI-0268 adds only ADR-0063 to the distributable file set; runtime roots unchanged.
// WI-0280 adds four product modules, one routed reference, the guide and ADR.
// WI-0282 adds two product modules, one guide and one ADR.
// Demand-driven review coverage adds the four required generic files above.
// The solo adoption guide adds one public documentation file.
// WI-0230 adds six runtime modules, one field specification, one ADR and one guide.
// WI-0243 adds exactly one public Alpha.33 qualification and upgrade guide.
// Reviewed addition: bounded finish-recovery module and its operator guide.
// WI-0250 adds the measurement report module and its ADR; no new package roots.
// WI-0252 integrates two diagnostic modules and ADR-0068; roots unchanged.
// WI-0255 adds exactly the task-contract module, reference and migration ADR.
// All three are required above; existing package roots and size limit remain.
// WI-0258 adds the seven explicitly required task-first files above.
// WI-0260/0261 add exactly nine modules, four guides/ADR and eight diagram assets,
// all required above; no new roots or increased size allowance.
// WI-0263 replaces four obsolete Mermaid sources with one offline flow explorer.
// Four SVGs remain; their dependency-free authoring script is not distributed.
// WI-0264 adds the measurement module and its public operations guide.
// WI-0267 adds exactly two monitor modules, the monitor ADR and routing evaluation.
// External development tools, raw receipts and browser evidence stay excluded.
// WI-0269 adds exactly three product modules, one daily guide and one ADR.
const MAX_FILE_COUNT = 501; // Adds reviewed ADR-0077; recovery scripts/tests stay source-only.
const MAX_UNPACKED_SIZE = 8 * 1024 * 1024;

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
