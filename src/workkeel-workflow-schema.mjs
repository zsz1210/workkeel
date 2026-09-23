import { exactKeys, EXECUTION_ID } from "./workkeel-execution-policy.mjs";

export function validateWorkflow(definition, policy) {
  exactKeys(definition, ["schema_version", "nodes", "edges"]);
  if (definition.schema_version !== "workkeel.workflow/v1" || !Array.isArray(definition.nodes) ||
      !definition.nodes.length || definition.nodes.length > 100 || !Array.isArray(definition.edges) ||
      !definition.edges.length || definition.edges.length > 300) throw new Error("Invalid bounded workflow definition");
  const nodes = new Map();
  if (Buffer.byteLength(JSON.stringify(definition)) > 262144) throw new Error("Workflow definition exceeds 256 KiB");
  for (const node of definition.nodes) {
    exactKeys(node, ["id", "kind", "input"], ["model", "retry", "write_paths"]);
    if (!EXECUTION_ID.test(node.id ?? "") || ["start", "end", "constructor", "prototype"].includes(node.id) || nodes.has(node.id)) throw new Error("Invalid or duplicate workflow node");
    if (!["runtime", "approval"].includes(node.kind) || typeof node.input !== "string" ||
        !node.input.trim() || Buffer.byteLength(node.input) > 32768 ||
        node.model !== undefined && !policy.models.some(m => m.id === node.model) ||
        node.retry !== undefined && typeof node.retry !== "boolean" ||
        node.kind === "approval" && (node.model !== undefined || node.retry !== undefined)) throw new Error("Invalid node input, model or retry policy");
    nodes.set(node.id, node);
    if (node.write_paths !== undefined && (!Array.isArray(node.write_paths) || new Set(node.write_paths).size !== node.write_paths.length ||
        node.write_paths.some(ref => typeof ref !== "string" || ref !== "." && (!/^[A-Za-z0-9._/-]+$/.test(ref) || ref.split("/").some(p => !p || p === "." || p === ".."))))) throw new Error("Invalid node write roots");
  }
  const outgoing = new Map();
  const adjacency = new Map([...nodes.keys(), "start"].map(id => [id, new Set()]));
  const signatures = new Set();
  const joined = new Set();
  for (const edge of definition.edges) {
    exactKeys(edge, ["from", "to"], ["outcome"]);
    const sources = Array.isArray(edge.from) ? edge.from : [edge.from];
    if (!sources.length || new Set(sources).size !== sources.length ||
        sources.some(id => id !== "start" && !nodes.has(id)) ||
        edge.to !== "end" && !nodes.has(edge.to) || sources.includes("start") && sources.length !== 1 ||
        edge.outcome !== undefined && (!EXECUTION_ID.test(edge.outcome) || sources.length !== 1 || sources[0] === "start" || nodes.get(sources[0]).kind === "approval")) throw new Error("Unknown or incompatible workflow edge");
    const key = JSON.stringify(edge);
    if (signatures.has(key)) throw new Error("Duplicate workflow edge"); signatures.add(key);
    if (Array.isArray(edge.from)) {
      if (sources.length < 2 || joined.has(edge.to)) throw new Error("A join needs distinct sources and one join declaration");
      joined.add(edge.to);
    }
    for (const source of sources) {
      adjacency.get(source).add(edge.to);
      const current = outgoing.get(source) ?? [];
      current.push(edge); outgoing.set(source, current);
    }
  }
  if (!outgoing.has("start") || [...nodes.keys()].some(id => !outgoing.has(id))) throw new Error("Every workflow node needs an exit and the graph needs a start");
  for (const edges of outgoing.values()) if (edges.some(e => e.outcome !== undefined) &&
      (edges.some(e => e.outcome === undefined) || new Set(edges.map(e => e.outcome)).size !== edges.length)) throw new Error("Conditional outcomes must be distinct and cannot mix with unconditional edges");
  for (const target of joined) if (definition.edges.some(e => e.to === target && !Array.isArray(e.from))) throw new Error("Join targets cannot also have independent triggers");
  const reachable = (source, seen = new Set()) => {
    if (seen.has(source)) return seen;
    seen.add(source);
    for (const target of adjacency.get(source) ?? []) reachable(target, seen);
    return seen;
  };
  const reached = reachable("start");
  if (!reached.has("end") || [...nodes.keys()].some(id => !reached.has(id) || !reachable(id).has("end"))) throw new Error("Workflow has unreachable nodes or no path to completion");
  // A barrier fed from alternative branches can wait forever. Require a simple
  // unconditional fan-out for each v1 join; more complex joins need a new design.
  for (const edge of definition.edges.filter(e => Array.isArray(e.from))) {
    const parents = [...outgoing.entries()].filter(([, edges]) => edge.from.every(id => edges.some(e => e.to === id && e.outcome === undefined && !Array.isArray(e.from))));
    if (parents.length !== 1 || edge.from.some(id => outgoing.get(id).length !== 1 || [...definition.edges].filter(e => e.to === id).length !== 1)) throw new Error("Join requires a direct unconditional fan-out with exclusive branch exits");
  }
  // Parallel v1 branches are deliberately simple fork/join blocks. Scalar
  // convergence is not a barrier in LangGraph and can dispatch a node twice.
  for (const [parent, edges] of outgoing) {
    const branches = edges.filter(edge => edge.outcome === undefined && !Array.isArray(edge.from));
    if (branches.length < 2) continue;
    const ids = branches.map(edge => edge.to);
    const join = definition.edges.find(edge => Array.isArray(edge.from) && edge.from.length === ids.length && ids.every(id => edge.from.includes(id)));
    if (!join || ids.includes("end") || ids.some(id => reachable(id).has(parent))) throw new Error("Parallel fan-out requires one explicit direct join and cannot loop through its fork");
  }
  for (const rule of policy.rules) if (rule.nodes.some(id => !nodes.has(id) || nodes.get(id).kind !== "runtime")) throw new Error("Routing rule names an absent or non-runtime node");
  for (const fallback of policy.fallbacks ?? []) if (nodes.get(fallback.node)?.kind !== "runtime") throw new Error("Fallback names an absent or non-runtime node");
  return definition;
}
