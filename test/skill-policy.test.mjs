import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "project-overlay/.agents/skills");
const BUNDLED_SKILLS = ["decision-interview", "domain-modeling", "project-documentation", "skill-authoring"];

test("bundled Skills and their routing scenarios stay aligned", async () => {
  const installed = (await fs.readdir(skillRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(installed, BUNDLED_SKILLS);
  const descriptions = [];
  for (const skillName of BUNDLED_SKILLS) {
    const content = await fs.readFile(path.join(skillRoot, skillName, "SKILL.md"), "utf8");
    assert.match(content, new RegExp(`^---\\nname: ${skillName}\\ndescription: [^\\n]+\\n---\\n`));
    descriptions.push(content.match(/^description: (.+)$/m)[1]);
    // The repository's own copy must not drift from the bundled one.
    assert.equal(await fs.readFile(path.join(root, ".agents/skills", skillName, "SKILL.md"), "utf8"), content, skillName);
  }
  assert.equal(new Set(descriptions).size, descriptions.length);

  const scenarios = JSON.parse(await fs.readFile(path.join(root, "test/fixtures/skill-scenarios.json"), "utf8"));
  for (const scenario of scenarios) assert.ok(scenario.expected_skill === null || BUNDLED_SKILLS.includes(scenario.expected_skill), scenario.id);
  for (const skillName of BUNDLED_SKILLS) {
    assert.ok(scenarios.some((scenario) => scenario.expected_skill === skillName), `${skillName} has no scenario`);
  }
  assert.ok(scenarios.some((scenario) => scenario.id === "status-only" && scenario.expected_skill === null && scenario.repository_mutation === false));
  assert.deepEqual(
    new Set(scenarios.filter((scenario) => scenario.expected_skill === "decision-interview").map((scenario) => scenario.mode)),
    new Set(["conversational", "evidence-backed", "persistence-authorized"])
  );
});
