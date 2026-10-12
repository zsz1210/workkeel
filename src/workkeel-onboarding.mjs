import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { durableAtomicCreate, durableAtomicWrite, formatJson, sha256 } from "./files.mjs";
import { readTaskProject, existsEntry } from "./workkeel-project.mjs";
import { readTaskFile, readTaskContractInput } from "./task-contract.mjs";
import { withProjectMutationLock } from "./project.mjs";

const exec = promisify(execFile);

/** First-use navigation only. Drafts intentionally cannot grant authority. */
export async function readStartGuide(target, { requestRef = null } = {}) {
  const guide = { schema_version: "workkeel.start/v1", mutation_status: "no-write",
    execution_authorized: false, ready: false, stage: "project", required: [],
    next_action: "", next_command: null, drafts: {}, errors: [],
    limitation: "Readiness is an intake preview, not a claim, model dispatch or acceptance. Commands are argv relative to this project; inspect before running." };
  const step = (stage, next_action, next_command, required = []) =>
    Object.assign(guide, { stage, next_action, next_command, required });
  try {
    const root = await fs.realpath(target);
    if (!(await fs.stat(root)).isDirectory()) throw Error("Target must be a directory");
    let gitRoot;
    try { gitRoot = (await exec("git", ["-C", root, "rev-parse", "--show-toplevel"], { timeout: 10000 })).stdout.trim(); }
    catch { return step("git", "Choose a Git repository root, or explicitly initialize this directory with git init.", null, ["Git repository root"]); }
    if (await fs.realpath(gitRoot) !== root) return step("git-root", "Run start at the Git repository root.", ["start", gitRoot]);
    if (!await existsEntry(root, "workkeel.lock")) {
      for (const ref of ["WORKKEEL.md", "workkeelw.mjs"]) {
        if (await existsEntry(root, ref)) throw Error(`Existing ${ref} requires inspection before initialization; no files were overwritten`);
      }
      if (await existsEntry(root, "temple.lock")) return step("legacy", "Continue with this project's pinned Temple launcher. Migration requires a separate reviewed preview.", null);
      if (await existsEntry(root, ".ai-org")) throw Error("Existing .ai-org requires inspection before initialization; no files were overwritten");
      guide.drafts.policy = { schema_version: "workkeel.task-policy/v1", principals: [], agents: [], approvers: [], review_separation: null };
      return step("policy", "Agree on identities and review separation, complete drafts.policy and save it as task-policy.json. Then initialize explicitly.", ["init", ".", "--policy", "task-policy.json"], ["Principal IDs", "Agent-to-Principal mappings", "Approvers", "Review separation"]);
    }
    const project = await readTaskProject(root);
    guide.identity_choices = project.policy;
    for (const ref of ["WORKKEEL.md", "workkeelw.mjs"]) await readTaskFile(root, ref);
    guide.stage = "instructions";
    const instructions = await previewInstructions(root);
    if (instructions.files.length) {
      guide.instruction_preview = instructions;
      return step("instructions", "Inspect the additive instruction preview, then apply its fingerprint. Existing instructions are preserved.", ["instructions", "apply", ".", "--fingerprint", instructions.fingerprint]);
    }
    guide.stage = "brief";
    if (requestRef === null) {
      guide.drafts.brief = { schema_version: "workkeel.task-brief/v1", id: null, goal: null,
        actor: { agent_id: null, principal_id: null }, acceptance: [], exclude: [],
        environment: { cwd: ".", read_paths: [], write_paths: [], tools: [], resources: [],
          network: { mode: "none", hosts: [] }, external_actions: [],
          data: { classification: null, model_access: "none", policy_refs: [] } },
        authorization: { approved_by: null, approval_ref: null, operations: [], expires_at: null } };
      return step("brief", "Complete drafts.brief from the approved goal and boundaries, save it as brief.json, and record the actual approval and data policy in referenced files.", ["start", ".", "--request", "brief.json"], ["Task ID and goal", "Registered actor", "Acceptance criteria", "Paths and tools", "Data classification and policy", "Actual approval and operations"]);
    }
    const { previewTaskIntake } = await import("./workkeel-intake.mjs");
    guide.intake_preview = await previewTaskIntake(root, (await readTaskContractInput(root, requestRef)).document);
    guide.ready = true;
    return step("preview", "Inspect the generated contract and authority references; apply this fingerprint to create the task, then follow claim, delivery, review and acceptance in the quick start.", ["intake", "apply", ".", "--request", requestRef, "--fingerprint", guide.intake_preview.fingerprint]);
  } catch (error) {
    guide.valid = false;
    guide.errors.push({ stage: guide.stage, message: error.message });
    guide.next_action = "Resolve the reported input or project error, then rerun start. Existing files have not been changed.";
    return guide;
  }
}

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
