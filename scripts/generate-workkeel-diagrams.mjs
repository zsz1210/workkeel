import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const esc = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const text = (x, y, value, size = 22, weight = 400, fill = "#1d3041") => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(value)}</text>`;
const lines = (x, y, values, size = 22, spacing = 30) => values.map((value, i) => text(x, y + i * spacing, value, size)).join("");
const rect = (x, y, w, h, fill, stroke = "#c8d3dc", r = 16) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
const arrow = d => `<path d="${d}" fill="none" stroke="#536a7c" stroke-width="2" marker-end="url(#arrow)"/>`;
const shell = (w, h, title, desc, content) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc">
<title id="title">${esc(title)}</title><desc id="desc">${esc(desc)}</desc>
<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke="#536a7c" stroke-width="1.5"/></marker></defs>
<rect width="100%" height="100%" fill="#fff"/>
<g font-family="system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">${content}</g></svg>\n`;

const stages = [
  ["Agree", "intake", "Scope, permissions", "and acceptance"],
  ["Implement", "build", "Claim work; use your", "agent or a graph"],
  ["Review", "test", "Check the exact", "candidate + evidence"],
  ["Accept", "release_gate", "Confirm review and", "required approvals"],
  ["Done", "done", "Record the accepted", "revision; no deploy"]
];
const layers = [
  { title: "Task agreement", question: "What is allowed, and what counts as done?", badge: "CORE", color: "#e8f0fa", accent: "#285b8b",
    nodes: [["Goal + acceptance", "One bounded change", "with checkable results"], ["Environment + authority", "Read/write roots, tools,", "data policy and expiry"], ["Task contract", "An approved record", "beside your code"]],
    note: "Principle: repository-native state. A conversation is not the source of authority." },
  { title: "Coordination", question: "Who can act next, and which model will run?", badge: "CORE + OPT-IN", color: "#e6f3ec", accent: "#226b4d",
    nodes: [["Core task lifecycle", "Claim → handoff → review", "Guard each transition"], ["Optional graph", "LangGraph orders steps", "and pauses for approval"], ["Model policy", "Node override → rule", "→ approved default"]],
    note: "Principle: state machines + graph orchestration. Core use does not require a graph." },
  { title: "Execution", question: "How does an agent actually do the work?", badge: "EXISTING RUNTIME", color: "#fff1df", accent: "#835316",
    nodes: [["Coding runtime", "Native agent by default", "Codex adapter: opt-in"], ["Agent feedback loop", "Read → decide → use tools", "→ observe → continue"], ["Approved environment", "Files, tests and tools", "Host enforces permissions"]],
    note: "Principle: harness engineering. The runtime owns tool use; a prompt is not a sandbox." },
  { title: "Evidence + acceptance", question: "Did the delivered change meet the agreement?", badge: "CORE / LOCAL", color: "#f0eafa", accent: "#65508a",
    nodes: [["Execution evidence", "Results, time and usage", "Unknown values stay null"], ["Exact candidate review", "Git revision + checks", "Declared review separation"], ["Accepted task", "Persist review + closeout", "Keep the failure history"]],
    note: "Principle: evidence-based verification. A completed graph is not an accepted task." }
];

export function workflowSvg(mobile = false) {
  if (mobile) {
    let body = text(20, 38, "Workkeel · task lifecycle", 24, 600) + text(20, 67, "One task, five explicit states", 16);
    stages.forEach(([label, state, a, b], i) => {
      const y = 91 + i * 151;
      body += rect(20, y, 350, 123, i === 4 ? "#e6f3ec" : "#edf3fa");
      body += text(36, y + 31, `${i + 1}  ${label}`, 22, 600) + text(36, y + 58, state, 16, 500, "#285b8b");
      body += lines(36, y + 85, [a, b], 17, 23);
      if (i < 4) body += arrow(`M195 ${y + 125}V${y + 147}`);
    });
    body += rect(20, 852, 350, 122, "#fff1df") + lines(36, 882, ["Review fails? Return to intake,", "keep the failed evidence, then claim", "the same scope again. An execution", "pause does not change task state."], 16, 24);
    body += text(20, 1004, "Optional graph runs inside build.", 17, 500);
    return shell(390, 1028, "Workkeel task lifecycle", "Intake, build, test, release_gate, done. Failed review returns to intake. Graph execution is optional and occurs during build.", body);
  }
  let body = text(32, 49, "From an approved task to an accepted change", 30, 600) + text(32, 82, "Task state is separate from the coding agent's activity.", 22);
  stages.forEach(([label, state, a, b], i) => {
    const x = 32 + 236 * i;
    body += rect(x, 120, 208, 192, i === 4 ? "#e6f3ec" : "#edf3fa");
    body += text(x + 18, 153, `0${i + 1}`, 20, 500, "#285b8b") + text(x + 18, 192, label, 26, 600);
    body += text(x + 18, 224, state, 19, 500, "#285b8b") + lines(x + 18, 260, [a, b], 18, 25);
    if (i < 4) body += arrow(`M${x + 210} 216H${x + 232}`);
  });
  body += arrow("M608 315V345H136V315") + text(154, 378, "Review fails → preserve evidence → return to intake → claim again", 21);
  body += rect(32, 407, 1152, 106, "#fff1df") + text(52, 444, "Inside build: use your existing coding agent, or opt into a graph.", 23, 500);
  body += text(52, 480, "Graph: running → awaiting-approval / paused / blocked → completed. Completion still needs review.", 19);
  return shell(1216, 540, "Workkeel task lifecycle", "Five task states: intake, build, test, release_gate and done. Review failure returns to intake. Optional execution states are distinct from acceptance.", body);
}

export function architectureSvg(mobile = false) {
  const w = mobile ? 390 : 1216, laneHeight = mobile ? 478 : 290;
  let body = text(mobile ? 20 : 32, 44, "Workkeel · four layers", mobile ? 24 : 32, 600);
  body += text(mobile ? 20 : 32, 78, "Agreement → coordination → execution → evidence", mobile ? 14 : 22);
  layers.forEach((layer, i) => {
    const y = 108 + i * (laneHeight + 26);
    body += rect(mobile ? 12 : 32, y, mobile ? 366 : 1152, laneHeight, layer.color);
    if (mobile) {
      body += text(28, y + 32, `0${i + 1}  ${layer.title}`, 22, 600) + text(28, y + 59, layer.badge, 13, 600, layer.accent);
      layer.nodes.forEach(([label, a, b], j) => {
        const cy = y + 78 + j * 117;
        body += rect(28, cy, 334, 99, "#ffffff", "#c8d3dc", 10) + text(42, cy + 28, label, 19, 600) + lines(42, cy + 55, [a, b], 16, 23);
        if (j < 2) body += arrow(`M195 ${cy + 100}V${cy + 114}`);
      });
      const notes = ["Repository records are the authority.", "Core use does not require a graph.", "The host enforces tool permissions.", "Execution completed ≠ task accepted."];
      body += text(28, y + 460, notes[i], 15, 500);
    } else {
      body += text(56, y + 43, `0${i + 1}`, 26, 600, layer.accent) + text(112, y + 43, layer.title, 29, 600);
      body += text(949, y + 42, layer.badge, 18, 600, layer.accent) + text(56, y + 80, layer.question, 22);
      layer.nodes.forEach(([label, a, b], j) => {
        const x = 56 + j * 376;
        body += rect(x, y + 105, 352, 119, "#ffffff", "#c8d3dc", 12) + text(x + 18, y + 139, label, 24, 600);
        body += lines(x + 18, y + 173, [a, b], 21, 28);
        if (j < 2) body += arrow(`M${x + 354} ${y + 166}H${x + 372}`);
      });
      body += text(56, y + 261, layer.note, 19);
    }
    if (i < 3) body += arrow(`M${w / 2} ${y + laneHeight + 2}V${y + laneHeight + 24}`);
  });
  const end = 108 + 4 * (laneHeight + 26);
  body += text(mobile ? 20 : 32, end + 19, mobile ? "Optional persistence: SQLite + journal" : "Optional runner persistence: SQLite checkpoints + dispatch journal. Uncertain effects stop for reconciliation.", mobile ? 16 : 21);
  return shell(w, end + 48, "Workkeel architecture in four explanatory layers", "Task agreement defines authority. Coordination guards task states and optionally routes graph nodes. A coding runtime operates host-approved tools. Evidence and exact-candidate review determine acceptance. Optional runner checkpoints are not acceptance records.", body);
}

export const generatedDiagrams = () => Object.fromEntries(["workflow", "architecture"].flatMap(kind => [false, true].map(mobile => [
  `workkeel-${kind}${mobile ? "-mobile" : ""}.svg`, (kind === "workflow" ? workflowSvg : architectureSvg)(mobile)
])));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, content] of Object.entries(generatedDiagrams())) {
    const destination = path.join(root, "docs/assets", name);
    if (process.argv.includes("--check")) {
      if (await fs.readFile(destination, "utf8") !== content) throw new Error(`Stale diagram: ${name}`);
    } else await fs.writeFile(destination, content);
  }
  console.log(process.argv.includes("--check") ? "Four diagram sources match." : "Generated four original Workkeel SVG diagrams.");
}
