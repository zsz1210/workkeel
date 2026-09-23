import path from "node:path";
import { durableAtomicCreate, durableAtomicWrite, formatJson, sha256 } from "./files.mjs";
import { readTaskProject, existsEntry } from "./workkeel-project.mjs";
import { readTaskFile } from "./task-contract.mjs";
import { withProjectMutationLock } from "./project.mjs";

const bridges = {
  "AGENTS.md": "<!-- workkeel:begin -->\nRead [WORKKEEL.md](WORKKEEL.md) for this project's task and verification workflow. Before acting, match the task to the available Skills, read the applicable Skill instructions, and report what was applied and verified. Read only task-relevant material; do not load the whole catalog.\n<!-- workkeel:end -->",
  "CLAUDE.md": "<!-- workkeel:begin -->\n@WORKKEEL.md\n\nUse this project's AGENTS.md instructions when present. Match and read applicable Skills before acting; report applied steps and verification, not merely which files were read.\n<!-- workkeel:end -->"
};

export async function previewInstructions(target) {
  await readTaskProject(target);
  const files = [];
  for (const [ref, block] of Object.entries(bridges)) {
    const before = await existsEntry(target, ref) ? await readTaskFile(target, ref, { preserveBom: true }) : null;
    if (before?.content.includes("<!-- workkeel:begin -->") || before?.content.includes("<!-- workkeel:end -->")) {
      if (!before.content.includes(block) || before.content.split("<!-- workkeel:begin -->").length !== 2 || before.content.split("<!-- workkeel:end -->").length !== 2) throw new Error("Existing Workkeel instruction block differs; review it manually instead of overwriting");
      continue;
    }
    const content = before ? `${before.content}${before.content.endsWith("\n") ? "\n" : "\n\n"}${block}\n` : `# Project instructions\n\n${block}\n`;
    files.push({ path: ref, before_sha256: before?.digest ?? null, after_sha256: sha256(content), content });
  }
  return { schema_version: "workkeel.instructions-preview/v1", files, fingerprint: sha256(formatJson(files)),
    mutation_status: "no-write", limitation: "Discovery does not prove that an agent followed the instructions or applied a Skill." };
}

export async function applyInstructions(target, fingerprint) {
  return withProjectMutationLock(target, async () => {
    const preview = await previewInstructions(target);
    if (preview.fingerprint !== fingerprint) throw new Error("Instruction preview changed; inspect a fresh preview");
    const applied = [];
    for (const file of preview.files) {
      // Preserve every existing byte; append the reviewed bridge only. A failure
      // leaves completed files intact and a fresh preview resumes the remainder.
      const current = await existsEntry(target, file.path) ? await readTaskFile(target, file.path, { preserveBom: true }) : null;
      if ((current?.digest ?? null) !== file.before_sha256) throw new Error("Instructions changed after preview");
      if (current) await durableAtomicWrite(path.join(target, file.path), file.content);
      else await durableAtomicCreate(path.join(target, file.path), file.content);
      applied.push(file.path);
    }
    return { schema_version: "workkeel.instructions-result/v1", applied, mutation_status: applied.length ? "applied" : "already-applied", originals: "preserved-in-place" };
  });
}
