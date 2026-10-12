import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fixture } from "../test/helpers/lean-delivery-fixture.mjs";
import { saveSession } from "../src/delivery-ledger.mjs";
import { startManagementConsoleServer } from "../src/management-console-server.mjs";

// Synthetic records live only in a disposable fixture. The local server and API
// are real; adversarial response states below are explicitly intercepted.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "output/playwright/delivery-panel");
const state = await fs.mkdtemp(path.join(os.tmpdir(), "temple-delivery-browser-"));
const f = await fixture({ workflowProfile: "standard" });
const revision = "a".repeat(40);
// Fixture-only seeding is not evidence of a real Work Item transition or acceptance.
for (const [id, completed] of [["WI-0001", true], ["WI-0002", false]]) {
  const itemPath = path.join(f.target, `.ai-org/work-items/${id}.json`);
  const item = { ...JSON.parse(await fs.readFile(path.join(f.target, `.ai-org/work-items/${f.item.id}.json`))),
    id, title: completed ? "Completed delivery fixture" : "Incomplete session fixture",
    state: "done", lifecycle_outcome: "accepted", claim: null,
    developer_candidate_revision: revision, tested_revision: revision,
    gate_evidence: { test_evidence: ["docs/developer-test.md"], independent_qa_pass: ["docs/brief.md"],
      independent_qa_report: ["docs/brief.md"] } };
  await fs.writeFile(itemPath, JSON.stringify(item));
  await saveSession(f.target, { schema_version: "temple.daily-delivery/v1", work_item_id: id,
    opened_at_ms: Date.now() - 10000, completed_at_ms: completed ? Date.now() : null,
    repairs: 0, pause: null, pending: null, coverage: { complete: false },
    plan: { budget: { elapsed_limit_ms: 100000, max_repairs: 2, verification_reserve_ms: 1000,
      repair_reserve_ms: 1000, cleanup_reserve_ms: 1000, token_limit: null } },
    events: [{ kind: "checked", sequence: 1, revision, result: { accepted: true }, elapsed_ms: 100 }] });
}
const server = await startManagementConsoleServer(f.target, { port: 0, stateDirectory: state });
let browser;
const errors = [], results = [];
async function waitText(page, text) {
  await page.waitForFunction(text => document.querySelector("#delivery-detail")?.textContent.includes(text), text);
}
async function select(page, id) {
  await page.locator("#work-search").fill(id);
  await page.waitForFunction(id => document.querySelector("#delivery-detail")?.dataset.workItemId === id, id);
}
async function work(page, width) {
  await page.goto(server.url);
  await page.waitForFunction(() => document.querySelector("#work-scope-filter"));
  if (width < 760) await page.locator("#sidebar-toggle").click();
  await page.locator('[data-nav-target="execution"]').click();
  await page.locator("#work-scope-filter").selectOption("closed");
  await page.locator("#work .work-row-button").first().waitFor();
}
async function layout(page) {
  const overflow = await page.evaluate(() => {
    const nodes = [document.documentElement, document.querySelector("#delivery-detail"),
      ...document.querySelectorAll("#delivery-detail .detail-value")];
    return nodes.filter(n => n.scrollWidth > n.clientWidth + 2).map(n => n.id || n.className);
  });
  assert.deepEqual(overflow, [], "delivery detail must wrap instead of overflow");
}
async function capture(page, name) {
  await page.locator("#delivery-detail").evaluate(element => element.scrollIntoView({ block: "start" }));
  // Navigation closes the mobile sidebar asynchronously. Capture its settled state
  // so a passing layout check cannot leave visual evidence covered by the backdrop.
  if (page.viewportSize().width < 760) {
    await page.waitForFunction(() => !document.body.classList.contains("nav-open") &&
      document.querySelector("#app-sidebar").getBoundingClientRect().right <= 1);
  }
  await page.screenshot({ path: path.join(output, name) });
}
try {
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await work(page, width);
    await select(page, "WI-0001"); await waitText(page, "Completed according to the Work Item");
    let values = await page.locator("#delivery-detail .detail-value").allTextContents();
    assert(values.includes("Canonical lifecycleDone")); assert(values.includes("Common entry sessionCompleted"));
    await layout(page);
    await capture(page, `completed-${width}.png`);
    await select(page, "WI-0002"); await waitText(page, "not a completed delivery duration");
    values = await page.locator("#delivery-detail .detail-value").allTextContents();
    assert(values.includes("Canonical lifecycleDone")); assert(values.includes("Common entry sessionNot completed"));
    await waitText(page, "Unknown (incomplete coverage)"); await layout(page);
    await capture(page, `incomplete-${width}.png`);
    results.push(`real API with synthetic completion distinction and wrapping at ${width}px`);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 } });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  const real = await fetch(server.url + "/api/v1/work-items/WI-0002/delivery").then(r => r.json());
  let mode = "loading", calls = 0, releaseDelayed, delayedArrived;
  await page.route("**/api/v1/work-items/WI-0002/delivery", async route => {
    calls++;
    if (mode === "network-error") return route.abort();
    if (mode === "delayed" || mode === "loading") {
      await new Promise(resolve => { releaseDelayed = resolve; delayedArrived?.(); });
    }
    const data = structuredClone(real);
    if (mode === "missing") data.availability = "session-missing";
    else if (mode === "corrupt") data.availability = "unavailable";
    else {
      data.status_label = "Needs attention: execution pending; inspect recovery before retrying";
      data.pending_action = "check"; data.active_pause_reason = "missing-input";
      data.pause_count = 1; data.repairs = 2;
      data.checks = { total: 1, items: [{ sequence: 1, accepted: false, revision: "a".repeat(40), elapsed_ms: 50 }] };
      data.evidence.test = { total: 1, refs: ["<img src=x onerror=alert(1)>" + "x".repeat(950)] };
      data.evidence.evaluation = { total: 0, refs: [] };
    }
    await route.fulfill({ json: data });
  });
  await work(page, 390); await select(page, "WI-0002"); await waitText(page, "Loading delivery record");
  mode = "missing"; releaseDelayed(); await waitText(page, "No common-entry record found");
  assert.equal(calls, 1); // Re-render within TTL does not add another request.
  await page.locator("#work-position-filter").selectOption("all"); assert.equal(calls, 1);
  mode = "corrupt"; await page.getByRole("button", { name: "Refresh delivery summary", exact: true }).click();
  await waitText(page, "invalid or unreadable");
  mode = "network-error"; await page.getByRole("button", { name: "Refresh delivery summary", exact: true }).click();
  await waitText(page, "could not be loaded");
  mode = "attention"; await page.getByRole("button", { name: "Retry delivery summary", exact: true }).click();
  await waitText(page, "Active pause: missing-input"); await waitText(page, "#1 FAIL");
  assert.equal(await page.locator("#delivery-detail img").count(), 0);
  await layout(page); await capture(page, "synthetic-recovery-mobile.png");
  results.push("synthetic missing/corrupt/retry/failed check/pause/pending/empty evidence/hostile long text and cache reuse");
  mode = "delayed";
  const arrived = new Promise(resolve => { delayedArrived = resolve; });
  await page.getByRole("button", { name: "Refresh delivery summary", exact: true }).click(); await arrived;
  await select(page, "WI-0001"); await waitText(page, "Completed according to the Work Item");
  releaseDelayed(); await page.waitForResponse(r => r.url().endsWith("WI-0002/delivery"));
  assert.equal(await page.locator("#delivery-detail").getAttribute("data-work-item-id"), "WI-0001");
  assert.doesNotMatch(await page.locator("#delivery-detail").textContent(), /Active pause/);
  results.push("delayed prior selection cannot replace the current Work Item summary");
  await context.close();
  const privateContext = await browser.newContext();
  const privatePage = await privateContext.newPage(); let deliveryRequests = 0;
  privatePage.on("request", r => { if (/\/work-items\/.*\/delivery$/.test(r.url())) deliveryRequests++; });
  await privatePage.route("**/api/v1/snapshot", async route => {
    const response = await route.fetch(); const snapshot = await response.json();
    snapshot.private_viewer = { read_only: true };
    await route.fulfill({ json: snapshot });
  });
  await work(privatePage, 1280); await select(privatePage, "WI-0001"); await waitText(privatePage, "local Console only");
  assert.equal(deliveryRequests, 0); results.push("private snapshot never requests local delivery detail");
  await privateContext.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), passed: true, results, screenshots: output }, null, 2));
} finally {
  await browser?.close(); await server.close(); await fs.rm(state, { recursive: true, force: true }); await f.cleanup();
}
