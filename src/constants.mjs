import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

export const REPOSITORY_ROOT = path.resolve(sourceDirectory, "..");
export const PROJECT_OVERLAY_ROOT = path.join(REPOSITORY_ROOT, "project-overlay");
export const PACKS_ROOT = path.join(REPOSITORY_ROOT, "packs");
export const PACKAGE_NAME = "@zsz1210/workkeel";
export const KNOWN_PACKAGE_NAMES = new Set([PACKAGE_NAME, "@zsz1210/temple-ai-dev-org", "@zsz1210/ai-development-org-template"]);
export const TEMPLATE_VERSION = "0.1.0-alpha.34";
export const TEMPLATE_REPOSITORY = "zsz1210/workkeel";

export const REQUIRED_SKILLS = [
  "temple-init",
  "temple-work",
  "decision-interview",
  "domain-modeling",
  "project-documentation",
  "skill-authoring"
];

export const REQUIRED_POSITIONS = [
  "engineering_manager",
  "product_manager",
  "ux_designer",
  "ui_designer",
  "tech_lead",
  "developer",
  "quality_evaluator",
  "independent_qa",
  "release_manager",
  "observer"
];

export const MANAGED_SOURCE_PREFIXES = [
  ".ai-org/core/",
  ".ai-org/templates/",
  ".agents/skills/",
  ".codex/agents/"
];

export const MANAGED_EXACT_PATHS = new Set(["TEMPLE.md", "templew.mjs"]);

export const SELF_HOST_ADOPTABLE_MANAGED_PATHS = new Set([
  ".agents/skills/temple-init/SKILL.md"
]);

export const PROJECT_OWNED_PATHS = [
  "AGENTS.md",
  ".agents/skills/** unless listed in temple.lock.managed_files",
  ".ai-org/project/**",
  ".ai-org/learning/**",
  ".ai-org/work-items/**",
  ".ai-org/decisions/**",
  ".ai-org/events/**",
  ".ai-org/artifacts/**",
  ".ai-org/adapters/**"
];

export const GENERATED_PATHS = [".ai-org/views/**"];

export const TASK_STATUSES = ["setup", "active", "waiting", "attention", "completed", "archived"];

export const AGENTS_MARKER_START = "<!-- temple:instructions:start -->";
export const AGENTS_MARKER_END = "<!-- temple:instructions:end -->";

export const LEAN_ASSIGNMENT_SLOTS = [
  {
    key: "coordination",
    label: "Coordination (Engineering Manager, Release Manager, Observer)",
    positions: ["engineering_manager", "release_manager", "observer"]
  },
  {
    key: "product",
    label: "Product Design (Product Manager, UX Designer, UI Designer)",
    positions: ["product_manager", "ux_designer", "ui_designer"]
  },
  {
    key: "technical",
    label: "Technical (Tech Lead)",
    positions: ["tech_lead"]
  },
  {
    key: "delivery",
    label: "Delivery (Developer)",
    positions: ["developer"]
  },
  {
    key: "quality",
    label: "Quality (Quality & Evaluation Engineer, Independent QA)",
    positions: ["quality_evaluator", "independent_qa"]
  }
];
