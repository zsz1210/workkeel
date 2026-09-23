import path from "node:path";
import { readTaskFile } from "./task-contract.mjs";
import { readTaskProject, safeDirectory } from "./workkeel-project.mjs";
import { createHeadroomPayload, readHeadroomOriginal } from "./headroom-adapter.mjs";
import { exactKeys } from "./workkeel-execution-policy.mjs";

/** Explicit derived-output operation; never a hidden whole-prompt rewrite. */
export async function workkeelToolView(target, request, dependencies) {
  exactKeys(request, ["input", "kind", "mode", "snapshot", "python_env"], ["query"]);
  await readTaskProject(target);
  if (!["off", "lossless"].includes(request.mode)) throw new Error("Native Headroom only supports off or verified-lossless mode");
  if (!["log", "json"].includes(request.kind)) throw new Error("Tool view requires a log or JSON derived output");
  if (request.python_env !== null && !/^[A-Z_][A-Z0-9_]*$/.test(request.python_env)) throw new Error("Use an environment variable name for the explicitly installed Headroom runtime");
  const input = await readTaskFile(target, request.input);
  const match = /^\.ai-org\/artifacts\/([A-Za-z0-9][A-Za-z0-9._-]*)\/headroom\/[A-Za-z0-9._-]+$/.exec(request.snapshot);
  if (!match) throw new Error("Headroom originals belong in .ai-org/artifacts/<task>/headroom/<file>");
  const artifactRoot = await safeDirectory(target, path.posix.dirname(request.snapshot), { create: true });
  const output = await createHeadroomPayload({ input: path.join(target, request.input), kind: request.kind,
    enabled: request.mode === "lossless", python: request.python_env ? process.env[request.python_env] : undefined,
    snapshot: path.join(artifactRoot, path.basename(request.snapshot)), artifactRoot, query: request.query ?? "", allowLossy: false }, dependencies);
  if (output.diagnostics.source_sha256 !== input.bytes_digest) throw new Error("Tool input changed during compression");
  return output;
}

export async function workkeelOriginal(target, request) {
  exactKeys(request, ["input", "sha256"]);
  await readTaskProject(target); await readTaskFile(target, request.input);
  return readHeadroomOriginal({ input: path.join(target, request.input), sha256: request.sha256 });
}

/** Host tool wrappers use the already-pinned task policy; no per-output model decision. */
export async function workflowToolView(context, request, dependencies) {
  exactKeys(request, ["input", "kind", "snapshot", "python_env"], ["query"]);
  const { contract, target, policy } = context;
  const under = (ref, root) => root === "." || ref === root || ref.startsWith(`${root}/`);
  const artifacts = `.ai-org/artifacts/${contract.id}`;
  if (![...contract.environment.read_paths, artifacts].some(root => under(request.input, root)) ||
      !under(request.snapshot, artifacts)) throw new Error("Tool view is outside the approved task input or artifact roots");
  const protectedRefs = [contract.authorization.approval_ref, ...contract.environment.data.policy_refs, ...contract.skills];
  const protectedSource = protectedRefs.includes(request.input) || request.input.startsWith(".ai-org/work-items/");
  const output = await workkeelToolView(target, { ...request, mode: protectedSource ? "off" : policy.headroom.mode }, dependencies);
  if (protectedSource) output.diagnostics.reason = "protected-task-authority";
  return output;
}
