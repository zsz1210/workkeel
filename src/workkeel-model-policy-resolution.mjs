/** Pure resolution shared by the host and its local settings preview.
 * The host validates the document before resolving and enforces authority later.
 * Resolving settings alone never authorizes an execution.
 */
export const policyDimensions = ['model', 'reasoning', 'service'];

export function resolvePolicySettings(policy, context = {}) {
  const requested = {}, sources = {};
  const layers = [[{id: 'project', settings: policy.project}],
    policy.rules.filter(r => !r.task && ['activity', 'role'].includes(r.layer) && r.match === context[r.layer]),
    policy.rules.filter(r => r.layer === 'task' && r.match === context.task),
    policy.rules.filter(r => r.layer === 'activity' && r.task && r.task === context.task && r.match === context.activity),
    policy.rules.filter(r => r.layer === 'node' && r.match === context.node)];
  for (const layer of layers) for (const name of policyDimensions) {
    const assignments = layer.filter(r => r.settings[name] && r.settings[name].mode !== 'inherit');
    if (!assignments.length) continue;
    const signatures = new Set(assignments.map(r => JSON.stringify([r.settings[name].mode, r.settings[name].value ?? null])));
    if (signatures.size !== 1) throw Error(`Conflicting ${name} assignments in the same model policy layer`);
    requested[name] = structuredClone(assignments[0].settings[name]);
    sources[name] = assignments.map(r => r.layer ? `${r.layer}:${r.id}` : r.id).sort().join(',');
  }
  for (const name of policyDimensions) if (!requested[name]) throw Error(`Inherited ${name} has no concrete ancestor setting`);
  return {requested, sources};
}
