import path from "node:path";
import { PROJECT_OVERLAY_ROOT, REQUIRED_POSITIONS } from "./constants.mjs";
import { readJson } from "./files.mjs";
import { normalizeRepositoryIntegration } from "./repository-integration.mjs";

const ENGLISH_NAME = /^[A-Za-z][A-Za-z .'-]*$/;
const AGENT_ID = /^agent-[a-z0-9][a-z0-9-]*$/;
const PROJECT_ID = /^[a-z0-9][a-z0-9-]*$/;

export function slugifyName(displayName) {
  return displayName
    .toLowerCase()
    .replace(/['.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateDisplayName(displayName) {
  if (typeof displayName !== "string" || !ENGLISH_NAME.test(displayName.trim())) {
    return "must be a natural English name using letters, spaces, apostrophes, periods, or hyphens";
  }

  const normalized = displayName.trim();
  const letterCount = (normalized.match(/[A-Za-z]/g) ?? []).length;
  if (letterCount < 2 || /^agent\s+[a-z0-9]+$/i.test(normalized) || /^[a-z]$/i.test(normalized)) {
    return "must be a meaningful name, not Agent A/B/C or a single-letter label";
  }

  return null;
}

export async function validateInitConfig(rawConfig) {
  const errors = [];
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new Error("Init config must be a JSON object");
  }

  if (rawConfig.schema_version !== "temple.init/v1") {
    errors.push("schema_version must be temple.init/v1");
  }

  const project = rawConfig.project;
  if (!project || typeof project !== "object") {
    errors.push("project is required");
  } else {
    if (typeof project.id !== "string" || !PROJECT_ID.test(project.id)) {
      errors.push("project.id must use lowercase letters, digits, and hyphens");
    }
    if (typeof project.name !== "string" || project.name.trim().length === 0) {
      errors.push("project.name is required");
    }
  }

  if (!["manual", "ai-suggested"].includes(rawConfig.naming_mode)) {
    errors.push("naming_mode must be manual or ai-suggested");
  }

  if (!Array.isArray(rawConfig.agents) || rawConfig.agents.length < 2) {
    errors.push("agents must contain at least two Agent Identities");
  }

  const knownPositionData = await readJson(path.join(PROJECT_OVERLAY_ROOT, ".ai-org/core/positions.json"));
  const knownPositions = new Set(knownPositionData.positions.map((position) => position.id));
  const seenIds = new Set();
  const positionOwners = new Map();
  const agents = [];

  for (const [index, rawAgent] of (rawConfig.agents ?? []).entries()) {
    const displayName = typeof rawAgent?.display_name === "string" ? rawAgent.display_name.trim() : "";
    const nameError = validateDisplayName(displayName);
    if (nameError) {
      errors.push(`agents[${index}].display_name ${nameError}`);
    }

    let agentId = rawAgent?.id;
    if (agentId !== undefined && (typeof agentId !== "string" || !AGENT_ID.test(agentId))) {
      errors.push(`agents[${index}].id must start with agent- and use lowercase letters, digits, or hyphens`);
    }
    if (!agentId) {
      const base = `agent-${slugifyName(displayName) || index + 1}`;
      agentId = base;
      let suffix = 2;
      while (seenIds.has(agentId)) {
        agentId = `${base}-${suffix}`;
        suffix += 1;
      }
    }
    if (seenIds.has(agentId)) {
      errors.push(`Agent IDs must be unique: ${agentId}`);
    }
    seenIds.add(agentId);

    if (!Array.isArray(rawAgent?.positions) || rawAgent.positions.length === 0) {
      errors.push(`agents[${index}].positions must be a non-empty array`);
    }

    const positions = [];
    for (const positionId of rawAgent?.positions ?? []) {
      if (!knownPositions.has(positionId)) {
        errors.push(`Unknown Position: ${positionId}`);
        continue;
      }
      if (positions.includes(positionId)) {
        errors.push(`Duplicate Position ${positionId} for ${displayName}`);
        continue;
      }
      positions.push(positionId);
      if (positionOwners.has(positionId)) {
        errors.push(`Position ${positionId} is assigned more than once`);
      } else {
        positionOwners.set(positionId, agentId);
      }
    }

    agents.push({ id: agentId, display_name: displayName, positions });
  }

  for (const positionId of REQUIRED_POSITIONS) {
    if (!positionOwners.has(positionId)) {
      errors.push(`Missing Position assignment: ${positionId}`);
    }
  }

  if (
    positionOwners.has("developer") &&
    positionOwners.get("developer") === positionOwners.get("independent_qa")
  ) {
    errors.push("Developer and Independent QA must be different Agent Identities");
  }

  let repositoryIntegration;
  try {
    repositoryIntegration = normalizeRepositoryIntegration(rawConfig.repository_integration);
  } catch (error) {
    errors.push(error.message.replace(/^Invalid repository integration config:\n- /, "repository_integration "));
  }

  if (errors.length > 0) {
    throw new Error(`Invalid init config:\n- ${errors.join("\n- ")}`);
  }

  return {
    schema_version: "temple.init/v1",
    project: { id: project.id, name: project.name.trim() },
    naming_mode: rawConfig.naming_mode,
    agents,
    repository_integration: repositoryIntegration
  };
}

export function buildProjectState(config, initializedAt = new Date().toISOString()) {
  const agents = config.agents.map(({ id, display_name }) => ({
    id,
    display_name,
    active: true,
    created_at: initializedAt
  }));

  const assignments = config.agents
    .flatMap((agent) =>
      agent.positions.map((positionId) => ({
        position_id: positionId,
        agent_id: agent.id,
        active: true
      }))
    )
    .sort((left, right) => left.position_id.localeCompare(right.position_id));

  return {
    project: {
      schema_version: "temple.project/v1",
      id: config.project.id,
      name: config.project.name,
      initialized_at: initializedAt
    },
    agents: {
      schema_version: "temple.agents/v1",
      naming_mode: config.naming_mode,
      agents
    },
    assignments: {
      schema_version: "temple.assignments/v1",
      assignments
    },
    tasks: {
      schema_version: "temple.tasks/v1",
      tasks: []
    },
    repositoryIntegration: config.repository_integration
  };
}

export function validateProjectState(project, agentsDocument, assignmentsDocument, positionIds) {
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });

  if (project?.schema_version === "temple.project/v1" && project.id && project.name) {
    add("project_model", "pass", `Project model is valid: ${project.name}`);
  } else {
    add("project_model", "fail", "project.json is missing required fields");
  }

  const agents = Array.isArray(agentsDocument?.agents) ? agentsDocument.agents : [];
  const agentIds = new Set();
  let agentsValid = agents.length >= 2;
  for (const agent of agents) {
    const nameError = validateDisplayName(agent?.display_name);
    if (!agent?.id || agentIds.has(agent.id) || nameError) {
      agentsValid = false;
    }
    agentIds.add(agent?.id);
  }
  add(
    "agent_identities",
    agentsValid ? "pass" : "fail",
    agentsValid ? `${agents.length} unique Agent Identities are valid` : "Agent Identities are invalid or not unique"
  );

  const assignments = Array.isArray(assignmentsDocument?.assignments) ? assignmentsDocument.assignments : [];
  const activeAssignments = assignments.filter((assignment) => assignment.active !== false);
  const owners = new Map();
  let assignmentsValid = true;
  for (const assignment of activeAssignments) {
    if (!positionIds.has(assignment.position_id) || !agentIds.has(assignment.agent_id) || owners.has(assignment.position_id)) {
      assignmentsValid = false;
    }
    owners.set(assignment.position_id, assignment.agent_id);
  }
  const missing = [...positionIds].filter((positionId) => !owners.has(positionId));
  if (missing.length > 0) {
    assignmentsValid = false;
  }
  add(
    "position_assignments",
    assignmentsValid ? "pass" : "fail",
    assignmentsValid
      ? `All ${positionIds.size} Positions have one active assignment`
      : `Invalid or missing Position assignments${missing.length ? `: ${missing.join(", ")}` : ""}`
  );

  const independent = owners.get("developer") && owners.get("developer") !== owners.get("independent_qa");
  add(
    "independent_qa_separation",
    independent ? "pass" : "fail",
    independent
      ? "Developer and Independent QA use different Agent Identities"
      : "Developer and Independent QA must use different Agent Identities"
  );

  if (owners.get("developer") === owners.get("release_manager")) {
    add("release_separation", "warn", "Developer also holds Release Manager; require explicit human release approval");
  } else {
    add("release_separation", "pass", "Developer and Release Manager are separated");
  }

  return checks;
}
