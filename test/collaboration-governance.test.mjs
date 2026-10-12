import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  addPrincipal,
  buildCollaborationState,
  configureGovernanceRecovery,
  establishBootstrapOwner,
  grantHumanAuthority,
  normalizedCollaborationState,
  recordCollaborationValidation,
  retireBootstrapOwner,
  validateCollaborationState
} from "../src/collaboration.mjs";
import {
  clearLocalActorBinding,
  readLocalActorBinding,
  resolveLocalActorBindingPath,
  writeLocalActorBinding
} from "../src/local-identity.mjs";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function git(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function gitResult(target, args) {
  return spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
}

async function governanceFixture() {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "temple-collaboration-v2-"));
  git(target, ["init", "-q"]);
  git(target, ["config", "user.name", "Temple Test"]);
  git(target, ["config", "user.email", "temple@example.invalid"]);
  const assignments = {
    schema_version: "temple.assignments/v1",
    assignments: [
      { position_id: "developer", agent_id: "agent-dev", active: true },
      { position_id: "independent_qa", agent_id: "agent-qa", active: true }
    ]
  };
  await writeJson(path.join(target, ".ai-org/project/project.json"), {
    schema_version: "temple.project/v1",
    id: "governance-fixture",
    name: "Governance fixture"
  });
  await writeJson(path.join(target, ".ai-org/project/agents.json"), {
    schema_version: "temple.agents/v1",
    agents: [
      { id: "agent-dev", display_name: "Dev", active: true },
      { id: "agent-qa", display_name: "QA", active: true }
    ]
  });
  await writeJson(path.join(target, ".ai-org/project/assignments.json"), assignments);
  await writeJson(path.join(target, ".ai-org/core/positions.json"), {
    schema_version: "temple.positions/v1",
    positions: [
      { id: "developer", display_name: "Developer" },
      { id: "independent_qa", display_name: "Independent QA" }
    ]
  });
  await writeJson(path.join(target, ".ai-org/project/collaboration.json"), buildCollaborationState(assignments));
  await fs.mkdir(path.join(target, ".ai-org/events"), { recursive: true });
  await fs.writeFile(path.join(target, ".ai-org/events/events.jsonl"), "");
  await fs.writeFile(path.join(target, "README.md"), "fixture\n");
  git(target, ["add", "."]);
  git(target, ["commit", "-qm", "fixture"]);
  return target;
}

test("v1 migration preserves defaults and makes unverified pooled membership provisional", () => {
  const legacy = {
    schema_version: "temple.collaboration/v1",
    profile: "collaborative",
    coordination_backend: "repository",
    principals: [{ id: "principal-one", display_name: "Same Name", active: true }],
    sponsorships: [{ principal_id: "principal-one", agent_id: "agent-dev", active: true }],
    memberships: [
      { position_id: "developer", agent_id: "agent-dev", disciplines: ["backend"], default: true, active: true },
      { position_id: "developer", agent_id: "agent-qa", disciplines: ["backend"], default: false, active: true }
    ],
    large_scale_validation: { status: "not_run", plan: "docs/validation.md" }
  };
  const migrated = normalizedCollaborationState(legacy);
  assert.equal(migrated.schema_version, "temple.collaboration/v2");
  assert.equal(migrated.memberships[0].status, "active");
  assert.equal(migrated.memberships[1].status, "provisional");
  assert.equal(migrated.validation.real_collaborative.plan, "docs/validation.md");
  assert.equal(migrated.bootstrap_owner, null);
});

test("Principal names may repeat while authority expansion and bootstrap retirement remain explicit", async (context) => {
  const target = await governanceFixture();
  context.after(() => fs.rm(target, { recursive: true, force: true }));
  await addPrincipal(target, { principalId: "principal-justin", displayName: "Justin" });
  await addPrincipal(target, { principalId: "principal-jerry", displayName: "Justin" });
  let collaboration = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/collaboration.json"), "utf8"));
  assert.deepEqual(collaboration.principals.map((entry) => entry.display_name), ["Justin", "Justin"]);
  assert.equal(collaboration.bootstrap_owner.principal_id, "principal-justin");

  await grantHumanAuthority(target, {
    grantId: "grant-justin-authority",
    principalId: "principal-justin",
    authority: "manage-authority",
    scope: "project",
    riskCeiling: "critical",
    approvedBy: ["principal-justin"]
  });
  await grantHumanAuthority(target, {
    grantId: "grant-jerry-authority",
    principalId: "principal-jerry",
    authority: "manage-authority",
    scope: "project",
    riskCeiling: "critical",
    approvedBy: ["principal-justin"]
  });
  await configureGovernanceRecovery(target, {
    trusteePrincipalIds: ["principal-justin", "principal-jerry"],
    threshold: 2,
    approvedBy: ["principal-justin"]
  });
  await retireBootstrapOwner(target, { approvedBy: ["principal-justin", "principal-jerry"] });
  collaboration = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/collaboration.json"), "utf8"));
  assert.equal(collaboration.bootstrap_owner.status, "retired");
  assert.equal(collaboration.recovery.status, "ready");
  assert.equal(collaboration.recovery.threshold, 2);
  const validity = validateCollaborationState(
    collaboration,
    JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/agents.json"), "utf8")),
    JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/assignments.json"), "utf8")),
    new Set(["developer", "independent_qa"])
  );
  assert.equal(validity.valid, true, validity.errors.join("; "));
});

test("a migrated team explicitly establishes bootstrap authority without promoting a later newcomer", async (context) => {
  const target = await governanceFixture();
  context.after(() => fs.rm(target, { recursive: true, force: true }));
  const collaborationPath = path.join(target, ".ai-org/project/collaboration.json");
  const collaboration = JSON.parse(await fs.readFile(collaborationPath, "utf8"));
  collaboration.principals = [
    { id: "principal-existing-a", display_name: "Existing", status: "active", active: true, provider_identities: [], created_at: null, updated_at: null },
    { id: "principal-existing-b", display_name: "Existing", status: "active", active: true, provider_identities: [], created_at: null, updated_at: null }
  ];
  await writeJson(collaborationPath, collaboration);
  await addPrincipal(target, { principalId: "principal-newcomer", displayName: "Newcomer" });
  let current = JSON.parse(await fs.readFile(collaborationPath, "utf8"));
  assert.equal(current.bootstrap_owner, null);
  await assert.rejects(
    establishBootstrapOwner(target, {
      principalId: "principal-existing-a",
      approvedBy: ["principal-existing-a"]
    }),
    /another distinct/
  );
  await establishBootstrapOwner(target, {
    principalId: "principal-existing-a",
    approvedBy: ["principal-existing-a", "principal-existing-b"]
  });
  current = JSON.parse(await fs.readFile(collaborationPath, "utf8"));
  assert.equal(current.bootstrap_owner.principal_id, "principal-existing-a");
});

test("local actor binding stays under the Git common directory and Solo self-assertion cannot pass Collaborative verification", async (context) => {
  const target = await governanceFixture();
  context.after(() => fs.rm(target, { recursive: true, force: true }));
  const written = await writeLocalActorBinding(target, { principalId: "human", verificationClass: "self-asserted" });
  assert.equal(written.path, path.join(target, ".git", "temple", "identity.json"));
  assert.equal(resolveLocalActorBindingPath(target), written.path);
  assert.equal((await fs.stat(written.path)).mode & 0o777, 0o600);
  assert.equal((await readLocalActorBinding(target)).binding.credential_stored, false);

  const collaborationPath = path.join(target, ".ai-org/project/collaboration.json");
  await addPrincipal(target, { principalId: "principal-justin", displayName: "Justin" });
  const collaboration = JSON.parse(await fs.readFile(collaborationPath, "utf8"));
  collaboration.profile = "collaborative";
  await writeJson(collaborationPath, collaboration);
  await assert.rejects(
    writeLocalActorBinding(target, { principalId: "principal-justin", verificationClass: "self-asserted" }),
    /requires externally supplied verification evidence/
  );
  assert.equal((await clearLocalActorBinding(target)).removed, true);
});

test("simulated validation cannot satisfy the Real Collaborative gate", async (context) => {
  const target = await governanceFixture();
  context.after(() => fs.rm(target, { recursive: true, force: true }));
  const revision = git(target, ["rev-parse", "HEAD"]);
  const simulated = await recordCollaborationValidation(target, {
    level: "simulated_collaborative",
    status: "passed",
    revision,
    evidenceRefs: ["test/collaboration-governance.test.mjs"],
    participants: [],
    environments: ["disposable-clone-a", "disposable-clone-b"]
  });
  assert.equal(simulated.status, "passed");
  await assert.rejects(
    recordCollaborationValidation(target, {
      level: "real_collaborative",
      status: "passed",
      revision,
      evidenceRefs: ["test/collaboration-governance.test.mjs"],
      participants: ["principal-justin"],
      environments: ["clone-a", "clone-b"]
    }),
    /two distinct active Principals/
  );
  const collaboration = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/collaboration.json"), "utf8"));
  assert.equal(collaboration.validation.simulated_collaborative.status, "passed");
  assert.equal(collaboration.validation.real_collaborative.status, "not_run");
});

test("two disposable clones expose a competing canonical write instead of silently losing it", async (context) => {
  const source = await governanceFixture();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-two-clone-simulation-"));
  context.after(() => Promise.all([
    fs.rm(source, { recursive: true, force: true }),
    fs.rm(root, { recursive: true, force: true })
  ]));
  const bare = path.join(root, "origin.git");
  const cloneA = path.join(root, "clone-a");
  const cloneB = path.join(root, "clone-b");
  const recovered = path.join(root, "cold-recovery");
  assert.equal(spawnSync("git", ["clone", "--bare", source, bare], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["clone", "-q", bare, cloneA], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["clone", "-q", bare, cloneB], { encoding: "utf8" }).status, 0);
  for (const clone of [cloneA, cloneB]) {
    git(clone, ["config", "user.name", "Temple Clone Test"]);
    git(clone, ["config", "user.email", "temple-clone@example.invalid"]);
  }
  const branch = git(cloneA, ["branch", "--show-current"]);
  await addPrincipal(cloneA, { principalId: "principal-clone-a", displayName: "Shared Name" });
  git(cloneA, ["add", ".ai-org"]);
  git(cloneA, ["commit", "-qm", "clone A governance change"]);
  await addPrincipal(cloneB, { principalId: "principal-clone-b", displayName: "Shared Name" });
  git(cloneB, ["add", ".ai-org"]);
  git(cloneB, ["commit", "-qm", "clone B governance change"]);

  git(cloneA, ["push", "-q", "origin", branch]);
  const rejectedPush = gitResult(cloneB, ["push", "origin", branch]);
  assert.notEqual(rejectedPush.status, 0);
  assert.match(rejectedPush.stderr, /fetch first|non-fast-forward|rejected/i);
  git(cloneB, ["fetch", "-q", "origin", branch]);
  const merge = gitResult(cloneB, ["merge", "--no-edit", `origin/${branch}`]);
  assert.notEqual(merge.status, 0);
  assert.match(git(cloneB, ["status", "--short"]), /UU \.ai-org\/(project\/collaboration\.json|events\/events\.jsonl)/);
  assert.match(git(cloneB, ["show", "HEAD:.ai-org/project/collaboration.json"]), /principal-clone-b/);

  assert.equal(spawnSync("git", ["clone", "-q", bare, recovered], { encoding: "utf8" }).status, 0);
  const recoveredState = JSON.parse(await fs.readFile(path.join(recovered, ".ai-org/project/collaboration.json"), "utf8"));
  assert.ok(recoveredState.principals.some((entry) => entry.id === "principal-clone-a"));
  assert.equal(recoveredState.principals.some((entry) => entry.id === "principal-clone-b"), false);
});
