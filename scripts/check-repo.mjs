import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TEMPLATE_VERSION } from "../src/workkeel-version.mjs";
import { pathExists, readJson, walkFiles } from "../src/files.mjs";
import { documentationLanguageIssue } from "./documentation-policy.mjs";

// Skills the repository itself uses; none is shipped in the package.
const NATIVE_SKILLS = ["workkeel-work"];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const packageDocument = await readJson(path.join(root, "package.json"));
check(packageDocument.version === TEMPLATE_VERSION, "package.json and CLI template versions differ");

const changelogContent = await fs.readFile(path.join(root, "CHANGELOG.md"), "utf8");
const changelogVersions = [...changelogContent.matchAll(/^## (\S+)$/gm)].map((match) => match[1]);
check(
  changelogVersions[0] === TEMPLATE_VERSION,
  `CHANGELOG.md must list the current framework version ${TEMPLATE_VERSION} first`
);

for (const file of (await walkFiles(root)).filter(
  (candidate) =>
    candidate.endsWith(".md") &&
    !candidate.startsWith(".git/") &&
    !candidate.startsWith("node_modules/") &&
    !candidate.startsWith(".ai-org/") &&
    !candidate.startsWith(".workkeel-private/") &&
    !candidate.startsWith("output/") &&
    !candidate.startsWith(".codex/")
)) {
  const content = await fs.readFile(path.join(root, file), "utf8");
  const issue = documentationLanguageIssue(file, content);
  check(issue === null, issue);
}

const skillRoot = path.join(root, ".agents/skills");
const installedSkills = (await fs.readdir(skillRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
check(
  JSON.stringify(installedSkills) === JSON.stringify([...NATIVE_SKILLS].sort()),
  `repository Skills differ from the expected set: ${installedSkills.join(", ")}`
);
for (const [skillName, skillPath] of NATIVE_SKILLS.map((name) => [name, path.join(skillRoot, name, "SKILL.md")])) {
  check(await pathExists(skillPath), `missing repository Skill: ${skillName}`);
  if (await pathExists(skillPath)) {
    const content = await fs.readFile(skillPath, "utf8");
    check(content.startsWith("---\n"), `${skillName} frontmatter is missing`);
    check(content.includes(`\nname: ${skillName}\n`), `${skillName} frontmatter name is invalid`);
    check(/\ndescription: .+\n/.test(content), `${skillName} frontmatter description is missing`);
  }
}

for (const file of (await walkFiles(root)).filter(
  (candidate) => !candidate.startsWith(".git/") && !candidate.startsWith("node_modules/") &&
    !candidate.startsWith(".ai-org/") && !candidate.startsWith(".workkeel-private/") && !candidate.startsWith("output/") && !candidate.startsWith(".codex/")
)) {
  if (!file.endsWith(".json")) continue;
  try {
    JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
  } catch (error) {
    failures.push(`invalid JSON: ${file}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(`Repository checks failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Repository checks passed (${installedSkills.length} repository Skills).`);
}
