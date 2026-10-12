import fs from "node:fs/promises";
import { after } from "node:test";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export function cli(args, { allowFailure = false } = {}) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [path.join(root, "bin/temple.mjs"), ...args], { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  return { ...result, elapsed_ms: performance.now() - start, output_bytes: Buffer.byteLength(result.stdout ?? "") + Buffer.byteLength(result.stderr ?? "") };
}
export function git(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
async function prepareFixture({ workflowProfile = "lean", affectedPaths = ["app.mjs", "app.test.mjs"] } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "temple-lean-delivery-"));
  try {
    const target = path.join(temporary, "project");
    const config = path.join(temporary, "init.json");
    await fs.writeFile(config, JSON.stringify({
      schema_version: "temple.init/v1", project: { id: "delivery-fixture", name: "Delivery fixture" }, naming_mode: "ai-suggested",
      agents: [
        { display_name: "Coordinator", positions: ["engineering_manager", "release_manager", "observer"] },
        { display_name: "Planner", positions: ["product_manager", "ux_designer", "ui_designer"] },
        { display_name: "Architect", positions: ["tech_lead"] },
        { display_name: "Builder", positions: ["developer"] },
        { display_name: "Verifier", positions: ["quality_evaluator", "independent_qa"] }
      ]
    }));
    const setup = [];
    setup.push(cli(["init", target, "--config", config]));
    await fs.mkdir(path.join(target, "docs"), { recursive: true });
    await fs.writeFile(path.join(target, "app.mjs"), 'export function parseCount(value) { if (!/^\\d+$/.test(value)) throw new Error("invalid count"); return Number(value); }\n');
    await fs.writeFile(path.join(target, "app.test.mjs"), 'import assert from "node:assert/strict"; import {parseCount} from "./app.mjs"; assert.equal(parseCount("12"),12); assert.throws(()=>parseCount("x"));\n');
    await fs.writeFile(path.join(target, "docs/brief.md"), "# Approved fixture brief\nParse decimal counts; reject non-digits. Local bounded work, no interface, no external action.\n");
    const productTest = spawnSync(process.execPath, ["--test", "app.test.mjs"], { cwd: target, encoding: "utf8" });
    if (productTest.status !== 0) throw new Error(productTest.stderr || productTest.stdout);
    await fs.writeFile(path.join(target, "docs/developer-test.md"), `# Developer observation\nCommand: node --test app.test.mjs\nExit: ${productTest.status}\n\n${productTest.stdout}`);
    git(target, ["init", "-b", "main"]);
    git(target, ["config", "user.name", "Fixture"]);
    git(target, ["config", "user.email", "fixture@example.invalid"]);
    git(target, ["add", "."]);
    git(target, ["commit", "-m", "Freeze product and contract fixture"]);
    const revision = git(target, ["rev-parse", "HEAD"]);
    setup.push(cli(["work-item", "create", target, "--title", "Deliver the parser fixture", "--scope", "Local parser", "--acceptance", "Decimal input parses and non-digits fail", ...affectedPaths.flatMap(p => ["--affected-path", p]), "--workflow-profile", workflowProfile, "--risk-tier", workflowProfile === "lean" ? "low" : "standard", "--scope-class", "bounded", "--profile-rationale", "Local reversible fixture", "--ui-mode", "not-applicable", "--json"]));
    const item = JSON.parse(setup.at(-1).stdout).item;
    const route = workflowProfile === "lean" ? [["build", ["work_order", "approved_scope", "acceptance_criteria", "technical_design", "risk_review", "profile_eligibility"]]] : [["spec", ["work_order"]], ["design", ["approved_scope", "acceptance_criteria"]], ["build", ["technical_design", "risk_review"]]];
    for (const [stage, gates] of route) setup.push(cli(["transition", target, "--work-item", item.id, "--to", stage, ...gates.flatMap(gate => ["--satisfy", `${gate}=docs/brief.md`])]));
    const assignments = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/assignments.json")));
    const agent = assignments.assignments.find((entry) => entry.position_id === "developer").agent_id;
    const qualityAgent = assignments.assignments.find((entry) => entry.position_id === "quality_evaluator").agent_id;
    return { temporary, target, item, setup, qualityAgent, revision, agent, cleanup: () => fs.rm(temporary, { recursive: true, force: true }) };
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
function claimPreparedFixture({ temporary, target, item, setup, qualityAgent, revision, agent }) {
  setup.push(cli(["work-item", "claim", target, "--work-item", item.id, "--agent-id", agent, "--principal-id", "human", "--base-revision", revision, "--branch", "main", "--json"]));
  const claimed = JSON.parse(setup.at(-1).stdout).item;
  const request = { workItemId: item.id, operationId: "parser-delivery", claimId: claimed.claim.id, agentId: agent, principalId: "human", revision, completed: ["Implemented and tested parser fixture"], evidence: ["docs/developer-test.md"], unresolved: [] };
  return { temporary, target, item, request, setup, qualityAgent, cleanup: () => fs.rm(temporary, { recursive: true, force: true }) };
}

export async function fixture(options) {
  const prepared = await prepareFixture(options);
  try { return claimPreparedFixture(prepared); }
  catch (error) { await prepared.cleanup(); throw error; }
}

// Test-only opt-in: cache Build state before any claim, never a claimed runtime.
export function createFixturePool() {
  const seeds = new Map(), active = new Set();
  let closed = false;
  async function allocate(options = {}) {
    const { workflowProfile = "lean", affectedPaths = ["app.mjs", "app.test.mjs"] } = structuredClone(options);
    const key = JSON.stringify([workflowProfile, affectedPaths]);
    let pending = seeds.get(key);
    if (!pending) {
      pending = prepareFixture({ workflowProfile, affectedPaths });
      seeds.set(key, pending);
      pending.catch(() => { if (seeds.get(key) === pending) seeds.delete(key); });
    }
    const seed = await pending;
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "temple-lean-delivery-copy-"));
    try {
      const start = performance.now();
      await fs.cp(seed.temporary, temporary, { recursive: true });
      const setup = [{ kind: "copied-initial-fixture", elapsed_ms: performance.now() - start,
        source_target: seed.target, source_revision: seed.revision, source_setup_calls: seed.setup.length }];
      return claimPreparedFixture({ ...seed, temporary, target: path.join(temporary, "project"),
        item: structuredClone(seed.item), setup });
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  return {
    fixture(options) {
      if (closed) return Promise.reject(new Error("Fixture pool is closed"));
      const operation = allocate(options);
      active.add(operation);
      operation.then(() => active.delete(operation), () => active.delete(operation));
      return operation;
    },
    async cleanup() {
      closed = true;
      await Promise.allSettled([...active]);
      const settled = await Promise.allSettled([...seeds.values()]);
      await Promise.all(settled.filter(result => result.status === "fulfilled").map(result => result.value.cleanup()));
      seeds.clear();
    }
  };
}

const sharedFixturePool = createFixturePool();
after(() => sharedFixturePool.cleanup());
export const cachedFixture = options => sharedFixturePool.fixture(options);

export function deliveryArgs(f, extra = []) {
  const r = f.request;
  return ["work-item", "deliver", f.target, "--work-item", r.workItemId, "--operation-id", r.operationId, "--claim-id", r.claimId, "--agent-id", r.agentId, "--principal-id", r.principalId, "--revision", r.revision, ...r.completed.flatMap((x) => ["--completed", x]), ...r.evidence.flatMap((x) => ["--evidence", x]), ...r.unresolved.flatMap((x) => ["--unresolved", x]), "--json", ...extra];
}
export async function itemState(f) {
  return JSON.parse(await fs.readFile(path.join(f.target, `.ai-org/work-items/${f.item.id}.json`)));
}
export async function canonicalBytes(f) {
  const output = {};
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) output[path.relative(f.target, absolute)] = await fs.readFile(absolute, "utf8");
    }
  }
  await walk(path.join(f.target, ".ai-org"));
  return output;
}
