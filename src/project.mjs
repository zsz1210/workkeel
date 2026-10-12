import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicCreate, atomicWrite, formatJson, pathExists, readJson, sha256 } from "./files.mjs";
import { nextStateForItem } from "./workflow.mjs";
import { assertNoPendingLeanDelivery } from "./lean-delivery-state.mjs";

export async function loadProjectContext(target) {
  const lockPath = path.join(target, "temple.lock");
  if (!(await pathExists(lockPath))) {
    throw new Error(`Temple is not installed in ${target}; run temple init first`);
  }

  const [lock, project, agentsDocument, assignmentsDocument, positionsDocument, workflow, policies] =
    await Promise.all([
      readJson(lockPath),
      readJson(path.join(target, ".ai-org/project/project.json")),
      readJson(path.join(target, ".ai-org/project/agents.json")),
      readJson(path.join(target, ".ai-org/project/assignments.json")),
      readJson(path.join(target, ".ai-org/core/positions.json")),
      readJson(path.join(target, ".ai-org/core/workflow.json")),
      readJson(path.join(target, ".ai-org/core/policies.json"))
    ]);

  const agents = new Map((agentsDocument.agents ?? []).map((agent) => [agent.id, agent]));
  const positions = new Map((positionsDocument.positions ?? []).map((position) => [position.id, position]));
  const assignments = new Map(
    (assignmentsDocument.assignments ?? [])
      .filter((assignment) => assignment.active !== false)
      .map((assignment) => [assignment.position_id, assignment.agent_id])
  );
  const states = new Map((workflow.states ?? []).map((state) => [state.id, state]));

  return {
    target,
    lock,
    project,
    agentsDocument,
    assignmentsDocument,
    positionsDocument,
    workflow,
    policies,
    agents,
    positions,
    assignments,
    states
  };
}

export function assignedAgentId(context, positionId) {
  const agentId = context.assignments.get(positionId);
  if (!agentId) throw new Error(`No active Agent Identity is assigned to Position ${positionId}`);
  return agentId;
}

export function assignedAgent(context, positionId) {
  const agentId = assignedAgentId(context, positionId);
  const agent = context.agents.get(agentId);
  if (!agent) throw new Error(`Assignment for ${positionId} references unknown Agent Identity ${agentId}`);
  return agent;
}

export function resolveActor(context, positionId, requestedActor, eligibleAgentIds = []) {
  const expected = assignedAgentId(context, positionId);
  const actor = requestedActor ?? expected;
  if (actor !== expected && actor !== "human" && !eligibleAgentIds.includes(actor)) {
    throw new Error(
      `Actor ${actor} does not hold ${positionId}; expected ${[expected, ...eligibleAgentIds, "human"].join(", ")}`
    );
  }
  return actor;
}

export function positionName(context, positionId) {
  return context.positions.get(positionId)?.display_name ?? positionId;
}

export const TASK_GOAL_MAX_CODE_POINTS = 48;
export const TASK_TITLE_MAX_CODE_POINTS = 58;

export function shortTaskGoal(value, maximumCodePoints = TASK_GOAL_MAX_CODE_POINTS) {
  if (!Number.isInteger(maximumCodePoints) || maximumCodePoints < 1) {
    throw new Error("A Codex task goal limit must be a positive integer");
  }
  const normalized = String(value ?? "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/gu, " ")
    .replaceAll("·", "-")
    .trim();
  if (!normalized) throw new Error("A Codex task title requires a non-empty Work Item goal");
  const codePoints = Array.from(normalized);
  if (codePoints.length <= maximumCodePoints) return normalized;
  if (maximumCodePoints === 1) return "…";
  return `${codePoints.slice(0, maximumCodePoints - 1).join("")}…`;
}

export function suggestedTaskTitle(context, workItemId, positionId, workItemTitle, agentDisplayName = null) {
  const agentName = agentDisplayName ?? assignedAgent(context, positionId).display_name;
  const prefix = `${workItemId} · `;
  const suffix = ` · ${positionName(context, positionId)} (${agentName})`;
  const availableGoalCodePoints = Math.max(
    1,
    TASK_TITLE_MAX_CODE_POINTS - Array.from(prefix).length - Array.from(suffix).length
  );
  const goal = shortTaskGoal(workItemTitle, Math.min(TASK_GOAL_MAX_CODE_POINTS, availableGoalCodePoints));
  return `${prefix}${goal}${suffix}`;
}

export function nextPositionForState(context, stateId, item = null) {
  const nextState = nextStateForItem(context.workflow, item ?? { state: stateId });
  return nextState ? context.states.get(nextState)?.owner_position ?? null : null;
}

export async function appendEvent(target, event) {
  const eventPath = path.join(target, ".ai-org/events/events.jsonl");
  const existing = (await pathExists(eventPath)) ? await fs.readFile(eventPath, "utf8") : "";
  const normalized = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
  await atomicWrite(eventPath, `${normalized}${JSON.stringify(event)}\n`);
}

export async function ensureTaskRegistry(target) {
  const registryPath = path.join(target, ".ai-org/project/tasks.json");
  let created = false;
  let afterHash = null;
  if (!(await pathExists(registryPath))) {
    const content = formatJson({ schema_version: "temple.tasks/v1", tasks: [] });
    try {
      await atomicCreate(registryPath, content);
      created = true;
      afterHash = sha256(content);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return { path: registryPath, created, afterHash };
}

export async function readTaskRegistry(target) {
  const registry = await ensureTaskRegistry(target);
  return readJson(registry.path);
}

export async function writeTaskRegistry(target, registry) {
  await atomicWrite(path.join(target, ".ai-org/project/tasks.json"), formatJson(registry));
}

export function uniqueStrings(values) {
  return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))];
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function withProjectMutationLock(target, operation, { leanDeliveryOperation = null, reconciliationRecovery = false } = {}) {
  const lockPath = path.join(os.tmpdir(), `temple-mutation-${sha256(path.resolve(target)).slice(0, 20)}.lock`);
  let handle = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 300_000) {
        await fs.unlink(lockPath).catch(() => {});
        continue;
      }
      await wait(50);
    }
  }
  if (!handle) {
    throw new Error(`Another Temple mutation is still active: ${lockPath}`);
  }

  try {
    await assertNoPendingLeanDelivery(target, leanDeliveryOperation);
    if (!reconciliationRecovery) {
      const { assertNoPendingReconciliation } = await import("./reconciliation.mjs");
      await assertNoPendingReconciliation(target);
    }
    return await operation();
  } finally {
    await handle.close();
    await fs.unlink(lockPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
