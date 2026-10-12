import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startControlPlaneServer } from "../src/control-plane-server.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

export const CONSOLE_VIEWPORTS = Object.freeze([
  Object.freeze({ name: "mobile", width: 390, height: 844 }),
  Object.freeze({ name: "tablet", width: 768, height: 1024 }),
  Object.freeze({ name: "desktop", width: 1440, height: 1000 }),
  Object.freeze({ name: "ultrawide", width: 3440, height: 1440 })
]);

export const PRIMARY_VIEWS = Object.freeze([
  Object.freeze({ target: "now", label: "Overview" }),
  Object.freeze({ target: "execution", label: "Work" }),
  Object.freeze({ target: "organization", label: "Team" }),
  Object.freeze({ target: "usage", label: "Usage" }),
  Object.freeze({ target: "system", label: "System" }),
  Object.freeze({ target: "history", label: "History" })
]);

export const OVERLAP_GROUPS = Object.freeze([
  Object.freeze({ label: "summary metrics", container: ".metrics.compact", children: ":scope > .metric" }),
  Object.freeze({ label: "view panels", container: ".view-grid", children: ":scope > .panel" }),
  Object.freeze({ label: "organization lanes", container: ".organization-lanes", children: ":scope > .organization-lane" }),
  Object.freeze({ label: "agent cards", container: ".agent-grid", children: ":scope > .agent-card" }),
  Object.freeze({ label: "work regions", container: ".work-layout", children: ":scope > .panel" })
]);

const primaryTextSelectors = Object.freeze([
  ".view-header h1",
  ".panel-title h2",
  ".organization-tab",
  ".system-tab",
  ".metric span"
]);

const highLevelSelectors = Object.freeze([
  ".view-panel:not([hidden]) > .view-header",
  ".view-panel:not([hidden]) > .metrics",
  ".view-panel:not([hidden]) > .view-grid",
  ".view-panel:not([hidden]) > .work-layout",
  ".view-panel:not([hidden]) > .organization-layout",
  ".view-panel:not([hidden]) > .usage-layout",
  ".view-panel:not([hidden]) > .system-tablist"
]);

export function rectanglesIntersect(left, right, tolerance = 1) {
  return !(
    left.right <= right.left + tolerance ||
    right.right <= left.left + tolerance ||
    left.bottom <= right.top + tolerance ||
    right.bottom <= left.top + tolerance
  );
}

function safeSegment(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export function failureScreenshotPath(root, viewportName, viewName) {
  const outputRoot = path.resolve(root, "output", "playwright", "wi-0088");
  const candidate = path.resolve(outputRoot, `${safeSegment(viewportName)}-${safeSegment(viewName)}-failure.png`);
  if (candidate !== outputRoot && !candidate.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error("Browser failure artifact escaped output/playwright/wi-0088");
  }
  return candidate;
}

function describeError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function assertPrimaryNavigation(page) {
  const failures = [];
  for (const view of PRIMARY_VIEWS) {
    const button = page.locator(`[data-nav-target="${view.target}"]`);
    const count = await button.count();
    if (count !== 1) {
      failures.push(`${view.label} navigation count was ${count}, expected 1`);
      continue;
    }
    const label = (await button.getAttribute("aria-label"))?.trim();
    const controls = await button.getAttribute("aria-controls");
    if (!label) failures.push(`${view.label} navigation has no accessible label`);
    if (!controls || (await page.locator(`#${controls}`).count()) !== 1) {
      failures.push(`${view.label} navigation does not reference one existing view`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

async function verifyMobileSidebar(page) {
  const initial = await page.evaluate(() => {
    const sidebar = document.querySelector("#app-sidebar");
    const rect = sidebar.getBoundingClientRect();
    return {
      ariaHidden: sidebar.getAttribute("aria-hidden"),
      inert: sidebar.inert,
      right: rect.right,
      open: document.body.classList.contains("nav-open")
    };
  });
  if (initial.ariaHidden !== "true" || !initial.inert || initial.open || initial.right > 1) {
    throw new Error(`Mobile sidebar is not safely closed: ${JSON.stringify(initial)}`);
  }

  await page.locator("#sidebar-toggle").click();
  await page.waitForFunction(() => document.body.classList.contains("nav-open"));
  await page.waitForFunction(() => document.querySelector("#app-sidebar").getBoundingClientRect().left >= -1);
  const opened = await page.evaluate(() => {
    const sidebar = document.querySelector("#app-sidebar");
    const rect = sidebar.getBoundingClientRect();
    return {
      ariaHidden: sidebar.getAttribute("aria-hidden"),
      inert: sidebar.inert,
      left: rect.left,
      right: rect.right,
      expanded: document.querySelector("#sidebar-toggle").getAttribute("aria-expanded")
    };
  });
  if (opened.ariaHidden !== "false" || opened.inert || opened.left < -1 || opened.right <= 0 || opened.expanded !== "true") {
    throw new Error(`Mobile sidebar did not open accessibly: ${JSON.stringify(opened)}`);
  }

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.body.classList.contains("nav-open"));
  await page.waitForFunction(() => document.querySelector("#app-sidebar").getBoundingClientRect().right <= 1);
  if ((await page.locator("#sidebar-toggle").getAttribute("aria-expanded")) !== "false") {
    throw new Error("Mobile sidebar toggle stayed expanded after Escape");
  }
}

async function navigateToView(page, view, viewport) {
  if (viewport.width < 760) {
    await page.locator("#sidebar-toggle").click();
    await page.waitForFunction(() => document.body.classList.contains("nav-open"));
    await page.waitForFunction(() => document.querySelector("#app-sidebar").getBoundingClientRect().left >= -1);
  }
  const button = page.locator(`[data-nav-target="${view.target}"]`);
  await button.click();
  await page.locator(`#view-${view.target}`).waitFor({ state: "visible" });
  if ((await button.getAttribute("aria-current")) !== "page") {
    throw new Error(`${view.label} navigation did not expose aria-current=page`);
  }
  const heading = page.locator(`#view-${view.target} .view-header h1`);
  if (!(await heading.textContent())?.trim()) throw new Error(`${view.label} rendered without a primary heading`);
  if (viewport.width < 760) {
    await page.waitForFunction(() => !document.body.classList.contains("nav-open"));
    await page.waitForFunction(() => document.querySelector("#app-sidebar").getBoundingClientRect().right <= 1);
  }
}

async function organizationKeyboardContract(page) {
  const responsibilities = page.locator('[data-organization-mode="responsibilities"]');
  await responsibilities.click();
  await responsibilities.focus();
  await page.keyboard.press("ArrowRight");
  const people = page.locator('[data-organization-mode="people"]');
  if ((await people.getAttribute("aria-selected")) !== "true") throw new Error("ArrowRight did not select People & Agents");
  if ((await page.evaluate(() => document.activeElement?.dataset?.organizationMode)) !== "people") {
    throw new Error("ArrowRight did not move focus to People & Agents");
  }
  await page.keyboard.press("ArrowRight");
  const authority = page.locator('[data-organization-mode="authority"]');
  if ((await authority.getAttribute("aria-selected")) !== "true") throw new Error("ArrowRight did not select Authority");
  await page.keyboard.press("Home");
  if ((await responsibilities.getAttribute("aria-selected")) !== "true") throw new Error("Home did not restore Responsibilities");
}

async function layoutViolations(page, viewport, view) {
  const violations = await page.evaluate(
    ({ primaryTextSelectors: textSelectors, highLevelSelectors: regionSelectors }) => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const result = [];
      const overflow = document.documentElement.scrollWidth - innerWidth;
      if (overflow > 1) result.push(`document is ${Math.ceil(overflow)}px wider than the viewport`);

      for (const selector of textSelectors) {
        for (const element of document.querySelectorAll(selector)) {
          if (!visible(element)) continue;
          const style = getComputedStyle(element);
          const clipsX = ["hidden", "clip"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
          const clipsY = ["hidden", "clip"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
          if (clipsX || clipsY) {
            result.push(`${selector} clips “${(element.textContent || "").trim().slice(0, 60)}”`);
          }
        }
      }

      for (const selector of regionSelectors) {
        for (const element of document.querySelectorAll(selector)) {
          if (!visible(element)) continue;
          const rect = element.getBoundingClientRect();
          if (rect.left < -1 || rect.right > innerWidth + 1) {
            result.push(`${selector} escapes the viewport (${Math.round(rect.left)}..${Math.round(rect.right)} of ${innerWidth})`);
          }
        }
      }
      return result;
    },
    { primaryTextSelectors, highLevelSelectors }
  );

  for (const group of OVERLAP_GROUPS) {
    const containers = await page.locator(group.container).evaluateAll((nodes, children) =>
      nodes.map((container, containerIndex) => ({
        containerIndex,
        rectangles: [...container.querySelectorAll(children)]
          .filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          })
          .map((element, elementIndex) => {
            const rect = element.getBoundingClientRect();
            return {
              elementIndex,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom
            };
          })
      })), group.children);
    for (const container of containers) {
      for (let index = 0; index < container.rectangles.length; index += 1) {
        for (let other = index + 1; other < container.rectangles.length; other += 1) {
          if (rectanglesIntersect(container.rectangles[index], container.rectangles[other])) {
            violations.push(`${group.label} overlap in container ${container.containerIndex}: items ${index + 1} and ${other + 1}`);
          }
        }
      }
    }
  }

  if (viewport.width >= 760) {
    const regions = await page.evaluate(() => {
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
      };
      return { sidebar: rect("#app-sidebar"), main: rect("#temple-workspace-main") };
    });
    if (rectanglesIntersect(regions.sidebar, regions.main)) violations.push("sidebar overlaps the main workspace");
  }

  return violations.map((message) => `${viewport.name}/${view.label}: ${message}`);
}

async function runViewport(browser, serverUrl, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "dark"
  });
  let page;
  let activeView = PRIMARY_VIEWS[0];
  try {
    page = await context.newPage();
    const runtimeErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    await page.goto(serverUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#metrics .metric").first().waitFor({ state: "visible" });
    await assertPrimaryNavigation(page);
    if (viewport.width < 760) await verifyMobileSidebar(page);

    for (const view of PRIMARY_VIEWS) {
      activeView = view;
      await navigateToView(page, view, viewport);
      if (view.target === "organization") await organizationKeyboardContract(page);
      const failures = await layoutViolations(page, viewport, view);
      failures.push(...runtimeErrors.splice(0).map((error) => `${viewport.name}/${view.label}: ${error}`));
      if (failures.length) throw new Error(failures.join("\n"));
    }
    console.log(`PASS ${viewport.name.padEnd(9)} ${viewport.width}x${viewport.height} · ${PRIMARY_VIEWS.length} views`);
  } catch (error) {
    if (page) {
      const screenshot = failureScreenshotPath(repositoryRoot, viewport.name, activeView.label);
      await fs.mkdir(path.dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      throw new Error(`${describeError(error)}\nFailure screenshot: ${path.relative(repositoryRoot, screenshot)}`);
    }
    throw error;
  } finally {
    await context.close();
  }
}

async function reducedMotionContract(browser, serverUrl) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    await page.goto(serverUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#metrics .metric").first().waitFor({ state: "visible" });
    const result = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "live-indicator";
      document.body.append(probe);
      const value = {
        matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
        sidebarTransition: getComputedStyle(document.querySelector("#app-sidebar")).transitionDuration,
        backdropTransition: getComputedStyle(document.querySelector("#sidebar-backdrop")).transitionDuration,
        activityAnimation: getComputedStyle(probe, "::before").animationName
      };
      probe.remove();
      return value;
    });
    if (!result.matches || result.sidebarTransition !== "0s" || result.backdropTransition !== "0s" || result.activityAnimation !== "none") {
      throw new Error(`Reduced-motion CSS contract failed: ${JSON.stringify(result)}`);
    }
    console.log("PASS reduced-motion · sidebar, backdrop, and live indicator motion disabled");
  } finally {
    await context.close();
  }
}

async function fieldAttentionContract(browser, serverUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  try {
    const page = await context.newPage();
    const response = await page.request.get(`${serverUrl}/api/v1/snapshot`);
    const snapshot = await response.json();
    const sample = snapshot.live_observer.work.items[0] ?? {};
    const states = ["awaiting-owner", "awaiting-environment", "review-completed", "awaiting-evidence", "awaiting-decision", "active-execution"];
    const items = states.map((state, index) => ({ ...sample, id: `WI-99${String(index).padStart(2, "0")}`, title: `Synthetic ${state} fixture`,
      category: "qa_pending", state: "test", effective_state: "test", terminal: false, lifecycle_outcome: null, tasks: [],
      runtime_workers: [], active_claim: null, active_claim_agent_id: null,
      delivery_attention: { state, execution_state: state === "active-execution" ? "active" : "not-running",
        review_state: state === "awaiting-environment" || state === "review-completed" ? "completed" : "not-running",
        acceptance_state: "not-complete", next_action: `Fixture next action: ${state}`,
        missing_conditions: state === "awaiting-environment" ? [{ kind: "environment", description: "Independent device observation unavailable" }] : [] } }));
    const nativeItem = { ...items[0], id: "WK-browser-native", title: "Synthetic native task", delivery_attention: null };
    snapshot.live_observer.work.items = [...items, nativeItem];
    snapshot.live_observer.work.total = items.length + 1;
    let nativeDeliveryRequests = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === `/api/v1/work-items/${nativeItem.id}/delivery`) nativeDeliveryRequests++;
    });
    await page.route("**/api/v1/snapshot", route => route.fulfill({ json: snapshot }));
    await page.route("**/api/v1/work-items/*/delivery", route => route.fulfill({ json: {
      schema_version: "temple.delivery-summary/v1", work_item_id: route.request().url().split("/").at(-2), availability: "session-missing", observed_at: snapshot.generated_at
    } }));
    await page.goto(serverUrl, { waitUntil: "domcontentloaded" });
    await page.locator('[data-nav-target="execution"]').click();
    for (const item of items) {
      await page.locator(`[data-work-item-id="${item.id}"]`).click();
      const panel = page.locator("#delivery-attention");
      await panel.waitFor({ state: "visible" });
      if (!(await panel.textContent()).includes(item.delivery_attention.next_action)) throw new Error(`Missing next action for ${item.delivery_attention.state}`);
      if (item.delivery_attention.state !== "active-execution" && await page.locator(`[data-work-item-id="${item.id}"] .live-indicator`).count()) {
        throw new Error(`Waiting/completed fixture shown as running: ${item.delivery_attention.state}`);
      }
    }
    await page.locator(`[data-work-item-id="${nativeItem.id}"]`).click();
    await page.locator("#delivery-detail").getByText("This is a native Workkeel task. Open the Workkeel observer to inspect its delivery evidence and review.", { exact: true }).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (nativeDeliveryRequests !== 0) throw new Error("Native task requested the legacy delivery API");
    await page.locator('[data-work-item-id="WI-9901"]').click();
    await page.screenshot({ path: path.join(os.tmpdir(), "temple-field-console-environment.png"), fullPage: true });
    console.log("PASS field attention · 6 synthetic states, actionable next step, no false running review, native delivery boundary");
  } finally { await context.close(); }
}

export async function verifyConsoleBrowser({
  startServer = startControlPlaneServer,
  launchBrowser = () => chromium.launch({ channel: "chrome", headless: true }),
  checkViews = async (browser, url) => {
    for (const viewport of CONSOLE_VIEWPORTS) await runViewport(browser, url, viewport);
    await reducedMotionContract(browser, url);
    await fieldAttentionContract(browser, url);
  }
} = {}) {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "temple-console-browser-"));
  let controlPlane;
  let browser;
  try {
    controlPlane = await startServer(repositoryRoot, {
      host: "127.0.0.1",
      port: 0,
      stateDirectory,
      repositoryIntervalMs: 60_000
    });
    try {
      browser = await launchBrowser();
    } catch (error) {
      throw new Error(`Installed Google Chrome is required for npm run test:browser. Temple does not download a browser.\n${describeError(error)}`);
    }
    console.log(`Chrome ${browser.version()} · ${controlPlane.url}`);
    await checkViews(browser, controlPlane.url);
    console.log(`Management Console browser gate passed (${CONSOLE_VIEWPORTS.length} viewports, ${PRIMARY_VIEWS.length} primary views).`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (controlPlane) await controlPlane.close().catch(() => {});
    await fs.rm(stateDirectory, { recursive: true, force: true, maxRetries: 3 });
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyConsoleBrowser().catch((error) => {
    console.error(describeError(error));
    process.exitCode = 1;
  });
}
