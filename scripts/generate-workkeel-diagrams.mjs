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

// Keep the hand-drawn layouts here as the dependency-free authoring source.
export function workflowSvg(mobile = false) {
  return mobile ? `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="1354" viewBox="0 0 390 1354" role="img" aria-labelledby="title desc">
  <title id="title">Workkeel task lifecycle</title>
  <desc id="desc">Agree scope and risk tier in intake. Claim and build with your coding tool. A different Agent reviews the exact commit in test; high and critical require a different model family and cross-review. A failed review stays in test until the approver runs task rework: preserve the failed attempt and return to intake under the same contract. Rework cap: low 2, others 3, then stop and ask a person. After a pass, accept in release_gate; the approving Principal closes high and critical work. Done records acceptance, not deployment. Must fix blocks; Consider, Note and Dismiss are recorded.</desc>
  <defs>
    <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke="#536a7c" stroke-width="1.5"/></marker>
    <style>
      text{font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;fill:#1d3041}
      .card{fill:#edf3fa;stroke:#c8d3dc}.heading{font-size:22px;font-weight:600}
      .state{font-size:16px;font-weight:500;fill:#285b8b}.body{font-size:17px}
      .arrow{fill:none;stroke:#536a7c;stroke-width:2;marker-end:url(#arrow)}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#fff"/>
  <text x="20" y="38" font-size="24" font-weight="600">Workkeel · task lifecycle</text>
  <text x="20" y="67" font-size="16">Task state ≠ coding agent activity</text>
  <g transform="translate(36 91)">
    <rect class="card" width="334" height="162" rx="16"/>
    <text class="heading" x="16" y="31">1  Agree</text><text class="state" x="16" y="58">intake</text>
    <text class="body" x="16" y="87">Scope, permissions and acceptance</text><text class="body" x="16" y="126" font-weight="500">Set risk tier</text>
  </g>
  <path class="arrow" d="M203 255V278"/>
  <g transform="translate(36 282)">
    <rect class="card" width="334" height="162" rx="16"/>
    <text class="heading" x="16" y="31">2  Build</text><text class="state" x="16" y="58">build</text>
    <text class="body" x="16" y="87">Claim first; use your coding tool</text><text class="body" x="16" y="126">Commit + handoff</text>
  </g>
  <path class="arrow" d="M203 446V469"/>
  <g transform="translate(36 473)">
    <rect class="card" width="334" height="222" rx="16"/>
    <text class="heading" x="16" y="31">3  Review</text><text class="state" x="16" y="58">test</text>
    <text class="body" x="16" y="87">Exact commit + evidence</text><text class="body" x="16" y="113">Different Agent</text>
    <text class="body" x="16" y="148">high / critical: different model family</text>
    <rect x="16" y="169" width="172" height="30" rx="8" fill="#fff1df" stroke="#c8d3dc"/>
    <text x="102" y="190" font-size="16" font-weight="500" text-anchor="middle">Cross-review</text>
  </g>
  <path class="arrow" d="M36 587H14V172H33"/>
  <path class="arrow" d="M203 697V720"/>
  <g transform="translate(36 724)">
    <rect class="card" width="334" height="170" rx="16"/>
    <text class="heading" x="16" y="31">4  Accept</text><text class="state" x="16" y="58">release_gate</text>
    <text class="body" x="16" y="87">Authorized approver closes after a pass</text>
    <text class="body" x="16" y="122">high / critical:</text><text class="body" x="16" y="147">Approving Principal closes</text>
  </g>
  <path class="arrow" d="M203 896V919"/>
  <g transform="translate(36 923)">
    <rect width="334" height="134" rx="16" fill="#e6f3ec" stroke="#c8d3dc"/>
    <text class="heading" x="16" y="31">5  Done</text><text class="state" x="16" y="58">done</text>
    <text class="body" x="16" y="87">Record the accepted revision;</text><text class="body" x="16" y="113">no deploy</text>
  </g>
  <g font-size="17">
    <text x="36" y="1096">Failed review stays in test</text><text x="36" y="1123">→ approver task rework → intake</text>
    <text x="36" y="1150">Same contract; claim again</text>
    <text x="36" y="1188">Rework cap: low 2 / others 3,</text><text x="36" y="1215">then stop and ask a person</text>
  </g>
  <rect x="20" y="1246" width="350" height="84" rx="12" fill="#fff1df" stroke="#c8d3dc"/>
  <text x="36" y="1278" font-size="17">Must fix blocks;</text><text x="36" y="1305" font-size="17">Consider / Note / Dismiss recorded</text>
</svg>
` : `<svg xmlns="http://www.w3.org/2000/svg" width="1216" height="620" viewBox="0 0 1216 620" role="img" aria-labelledby="title desc">
  <title id="title">Workkeel task lifecycle</title>
  <desc id="desc">Agree scope and risk tier in intake. Claim and build with your coding tool. A different Agent reviews the exact commit in test; high and critical require a different model family and cross-review. A failed review stays in test until the approver runs task rework: preserve the failed attempt and return to intake under the same contract. Rework cap: low 2, others 3, then stop and ask a person. After a pass, accept in release_gate; the approving Principal closes high and critical work. Done records acceptance, not deployment. Must fix blocks; Consider, Note and Dismiss are recorded.</desc>
  <defs>
    <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke="#536a7c" stroke-width="1.5"/></marker>
    <style>
      text{font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;fill:#1d3041}
      .card{fill:#edf3fa;stroke:#c8d3dc}.number{font-size:20px;font-weight:500;fill:#285b8b}
      .heading{font-size:26px;font-weight:600}.state{font-size:19px;font-weight:500;fill:#285b8b}
      .body{font-size:18px}.detail{font-size:16px}.arrow{fill:none;stroke:#536a7c;stroke-width:2;marker-end:url(#arrow)}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#fff"/>
  <text x="32" y="49" font-size="30" font-weight="600">From an approved task to an accepted change</text>
  <text x="32" y="82" font-size="22">Task state is separate from the coding agent's activity.</text>
  <g transform="translate(32 120)">
    <rect class="card" width="208" height="300" rx="16"/>
    <text class="number" x="18" y="33">01</text><text class="heading" x="18" y="72">Agree</text>
    <text class="state" x="18" y="104">intake</text>
    <text class="body" x="18" y="143">Scope, permissions</text><text class="body" x="18" y="170">and acceptance</text>
    <text class="body" x="18" y="212" font-weight="500">Set risk tier</text>
  </g>
  <path class="arrow" d="M242 224H264"/>
  <g transform="translate(268 120)">
    <rect class="card" width="208" height="300" rx="16"/>
    <text class="number" x="18" y="33">02</text><text class="heading" x="18" y="72">Build</text>
    <text class="state" x="18" y="104">build</text>
    <text class="body" x="18" y="143">Claim first</text><text class="body" x="18" y="170">Use your coding tool</text>
    <text class="body" x="18" y="212">Commit + handoff</text>
  </g>
  <path class="arrow" d="M478 224H500"/>
  <g transform="translate(504 120)">
    <rect class="card" width="208" height="300" rx="16"/>
    <text class="number" x="18" y="33">03</text><text class="heading" x="18" y="72">Review</text>
    <text class="state" x="18" y="104">test</text>
    <text class="body" x="18" y="143">Exact commit</text><text class="body" x="18" y="170">+ evidence</text>
    <text class="body" x="18" y="197">Different Agent</text>
    <text class="detail" x="18" y="225">high / critical:</text><text class="detail" x="18" y="250">Different model family</text>
    <rect x="18" y="262" width="172" height="27" rx="8" fill="#fff1df" stroke="#c8d3dc"/>
    <text class="detail" x="104" y="281" text-anchor="middle" font-weight="500">Cross-review</text>
  </g>
  <path class="arrow" d="M714 224H736"/>
  <g transform="translate(740 120)">
    <rect class="card" width="208" height="300" rx="16"/>
    <text class="number" x="18" y="33">04</text><text class="heading" x="18" y="72">Accept</text>
    <text class="state" x="18" y="104">release_gate</text>
    <text class="body" x="18" y="143">Authorized approver</text><text class="body" x="18" y="170">closes after a pass</text>
    <text class="detail" x="18" y="225">high / critical:</text><text class="detail" x="18" y="250">Approving Principal</text><text class="detail" x="18" y="275">closes</text>
  </g>
  <path class="arrow" d="M950 224H972"/>
  <g transform="translate(976 120)">
    <rect width="208" height="300" rx="16" fill="#e6f3ec" stroke="#c8d3dc"/>
    <text class="number" x="18" y="33">05</text><text class="heading" x="18" y="72">Done</text>
    <text class="state" x="18" y="104">done</text>
    <text class="body" x="18" y="143">Record the accepted</text><text class="body" x="18" y="170">revision; no deploy</text>
  </g>
  <path class="arrow" d="M608 423V451H136V423"/>
  <text x="32" y="491" font-size="21">Failed review stays in test → approver task rework → intake, same contract; claim again</text>
  <text x="32" y="527" font-size="21">Rework cap: low 2 / others 3, then stop and ask a person</text>
  <rect x="32" y="555" width="1152" height="43" rx="12" fill="#fff1df" stroke="#c8d3dc"/>
  <text x="52" y="583" font-size="19">Must fix blocks; Consider / Note / Dismiss recorded</text>
</svg>
`;
}

export function coreOptionalSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1216" height="660" viewBox="0 0 1216 660" role="img" aria-labelledby="title desc">
  <title id="title">Workkeel core and optional parts</title>
  <desc id="desc">The core is repository files for task contracts, evidence and policy, plus the Workkeel CLI. Your existing coding tool sits beside the core and enforces execution permissions. Dashed boxes are optional: workspace observatory using workkeel workspace serve, workflow runner using LangGraph, Workkeel Loop L1 report, native dispatch, and read-only observer. Core task coordination requires none of them.</desc>
  <defs>
    <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke="#536a7c" stroke-width="1.5"/></marker>
    <style>
      text{font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;fill:#1d3041}
      .heading{font-size:25px;font-weight:600}.body{font-size:20px}
      .optional{fill:#fff1df;stroke:#c8d3dc;stroke-width:2;stroke-dasharray:8 6}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#fff"/>
  <text x="32" y="49" font-size="30" font-weight="600">A small core, with optional parts</text>
  <text x="32" y="82" font-size="22">Repository files + CLI; your coding tool does the work.</text>
  <rect x="32" y="116" width="700" height="254" rx="16" fill="#edf3fa" stroke="#c8d3dc"/>
  <text x="54" y="153" class="heading">Workkeel core</text>
  <rect x="54" y="177" width="386" height="166" rx="12" fill="#fff" stroke="#c8d3dc"/>
  <text x="74" y="212" font-size="23" font-weight="500">Repository files</text>
  <text x="74" y="251" class="body">Task contracts · evidence · policy</text>
  <text x="74" y="282" class="body">Claims, review and acceptance</text>
  <text x="74" y="313" class="body">Bound to exact Git commits</text>
  <path d="M445 260H480" fill="none" stroke="#536a7c" stroke-width="2" marker-end="url(#arrow)"/>
  <rect x="490" y="177" width="220" height="166" rx="12" fill="#fff" stroke="#c8d3dc"/>
  <text x="510" y="212" font-size="23" font-weight="500">CLI</text>
  <text x="510" y="251" class="body">Lifecycle guards</text><text x="510" y="282" class="body">Read / write records</text>
  <text x="510" y="313" class="body">No model calls</text>
  <path d="M735 249H790" fill="none" stroke="#536a7c" stroke-width="2" marker-end="url(#arrow)"/>
  <rect x="800" y="116" width="384" height="254" rx="16" fill="#e6f3ec" stroke="#c8d3dc"/>
  <text x="822" y="153" class="heading">Your coding tool</text>
  <text x="822" y="202" class="body">Existing agent + model</text><text x="822" y="240" class="body">Edit, test and commit</text>
  <text x="822" y="278" class="body">Enforce tool / file / network limits</text><text x="822" y="316" class="body">Return candidate + evidence</text>
  <text x="32" y="413" font-size="23" font-weight="500">Optional · dashed boxes · none required for core task coordination</text>
  <g transform="translate(32 437)">
    <rect class="optional" width="368" height="91" rx="12"/>
    <text x="18" y="34" font-size="22" font-weight="500">Workspace observatory</text><text x="18" y="67" font-size="19">workkeel workspace serve</text>
  </g>
  <g transform="translate(424 437)">
    <rect class="optional" width="368" height="91" rx="12"/>
    <text x="18" y="34" font-size="22" font-weight="500">Workflow runner / LangGraph</text><text x="18" y="67" font-size="19">Approved graphs + recoverable steps</text>
  </g>
  <g transform="translate(816 437)">
    <rect class="optional" width="368" height="91" rx="12"/>
    <text x="18" y="34" font-size="22" font-weight="500">Workkeel Loop L1 report</text><text x="18" y="67" font-size="19">Weekly, read-only, zero API spend</text>
  </g>
  <g transform="translate(32 551)">
    <rect class="optional" width="368" height="85" rx="12"/>
    <text x="18" y="34" font-size="22" font-weight="500">Native dispatch</text><text x="18" y="65" font-size="19">Execution handoffs + host reports</text>
  </g>
  <g transform="translate(424 551)">
    <rect class="optional" width="368" height="85" rx="12"/>
    <text x="18" y="34" font-size="22" font-weight="500">Read-only observer</text><text x="18" y="65" font-size="19">workkeel monitor · no model calls</text>
  </g>
</svg>
`;
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

export const generatedDiagrams = () => ({
  ...Object.fromEntries(["workflow", "architecture"].flatMap(kind => [false, true].map(mobile => [
    `workkeel-${kind}${mobile ? "-mobile" : ""}.svg`, (kind === "workflow" ? workflowSvg : architectureSvg)(mobile)
  ]))),
  "workkeel-core-optional.svg": coreOptionalSvg()
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, content] of Object.entries(generatedDiagrams())) {
    const destination = path.join(root, "docs/assets", name);
    if (process.argv.includes("--check")) {
      if (await fs.readFile(destination, "utf8") !== content) throw new Error(`Stale diagram: ${name}`);
    } else await fs.writeFile(destination, content);
  }
  console.log(process.argv.includes("--check") ? "Five diagram sources match." : "Generated five original Workkeel SVG diagrams.");
}
