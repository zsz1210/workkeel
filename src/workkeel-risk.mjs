import picomatch from "picomatch";

export const RISK_TIERS = ["low", "standard", "high", "critical"];
const rank = tier => RISK_TIERS.indexOf(tier);
export const maxRisk = (...tiers) => tiers.reduce((a, b) => rank(b) > rank(a) ? b : a, "low");
export const elevatedRisk = tier => rank(tier) >= rank("high");
/** A project with more than one Principal is a team; one Principal is solo work. */
export const isTeamPolicy = policy => policy.principals.length > 1;
const under = (file, root) => root === "." || file === root || file.startsWith(`${root}/`);
// Dotfiles count: `deploy/**` must cover `deploy/.env`.
const OPTIONS = { dot: true, windows: false };

export function validRiskPattern(pattern) {
  return typeof pattern === "string" && pattern.length > 0 && pattern.length <= 256 && pattern.trim() === pattern &&
    !/[\\\x00-\x1f\x7f]/.test(pattern) && !pattern.startsWith("/") && !pattern.startsWith("!") &&
    pattern.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
function matchers(policy) {
  return Object.entries(policy.risk_paths ?? {}).flatMap(([tier, patterns]) => patterns.map(pattern => {
    const { base, glob } = picomatch.scan(pattern);
    return { tier, test: picomatch(pattern, OPTIONS), tree: glob === "**" && base ? base : null };
  }));
}
// Without a matching risk_paths entry, documentation alone is low and everything else standard.
const defaultTier = file => file !== "." && (under(file, "docs") || /\.md$/i.test(file)) ? "low" : "standard";

/** Risk of an exact changed file: the highest matching tier, never below a match. */
function fileRisk(rules, file) {
  const hits = rules.filter(rule => rule.test(file)).map(rule => rule.tier);
  return hits.length ? maxRisk(...hits) : defaultTier(file);
}
/** Risk certainly implied by an approved write root; partial overlaps are judged at handoff. */
function rootRisk(rules, root) {
  const hits = rules.filter(rule => rule.test(root) || rule.tree && root !== "." && under(root, rule.tree)).map(rule => rule.tier);
  return hits.length ? maxRisk(...hits) : defaultTier(root);
}

/** The lowest tier a contract may declare. Authors may raise it, never lower it. */
export function contractRiskFloor(policy, contract) {
  const rules = matchers(policy), roots = contract.environment.write_paths;
  const floor = roots.length ? maxRisk(...roots.map(root => rootRisk(rules, root))) : "low";
  return contract.environment.data.classification === "sensitive" ? maxRisk(floor, "high") : floor;
}
/** Tier implied by the files a candidate actually changed. Administrative records
 * have no default tier but never escape an explicit risk_paths entry. */
export function candidateRisk(policy, files, administrative = []) {
  const rules = matchers(policy), scored = files.map(file => ({ file, tier: fileRisk(rules, file) }));
  for (const file of administrative) {
    const hits = rules.filter(rule => rule.test(file)).map(rule => rule.tier);
    if (hits.length) scored.push({ file, tier: maxRisk(...hits) });
  }
  const tier = scored.length ? maxRisk(...scored.map(s => s.tier)) : "low";
  return { tier, paths: scored.filter(s => s.tier === tier).map(s => s.file).slice(0, 32) };
}

/** The contract tier, raised by any escalation of a current or rejected delivery. */
export function taskRisk(item) {
  const deliveries = [item.delivery, ...item.attempts.filter(a => a.kind === "rejected").map(a => a.delivery)];
  return maxRisk(item.contract.verification.risk_tier, ...deliveries.map(d => d?.risk?.tier ?? "low"));
}

/** Authority rules that depend on risk and are checked on every task operation. */
export function assertTaskRisk(policy, contract, initiator) {
  const tier = contract.verification.risk_tier, floor = contractRiskFloor(policy, contract);
  if (rank(tier) < rank(floor)) throw new Error(`Task risk_tier ${tier} is below the ${floor} tier required by its write paths or data classification; risk can only be raised`);
  if (elevatedRisk(tier)) assertIndependentApproval(policy, contract, initiator);
}
/** In a team, high-risk approval cannot come from the implementer or the initiator. */
export function assertIndependentApproval(policy, contract, initiator) {
  if (!isTeamPolicy(policy)) return;
  const approver = contract.authorization.approved_by;
  if (approver === contract.actor?.principal_id || approver === initiator?.principal_id)
    throw new Error("High-risk team work needs approval from a Principal other than the implementer and the initiator");
}
