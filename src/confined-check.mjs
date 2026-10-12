import fs from "node:fs/promises";
import path from "node:path";
import { ensure } from "./delivery-ledger.mjs";

// Opt-in macOS local check adapter. It never weakens the host's sandbox or falls
// back to unrestricted execution. The parent agent is outside this boundary.
export async function confinedCheckCommand(root, temporary, tests, timeout) {
  ensure(process.platform === "darwin", "confined-node requires the macOS sandbox-exec adapter; no fallback");
  await fs.access("/usr/bin/sandbox-exec", fs.constants.X_OK);
  const source = await fs.realpath(root), scratch = await fs.realpath(temporary), node = await fs.realpath(process.execPath);
  const prefix = ["/opt/homebrew", "/usr/local", "/usr"].find(p => node.startsWith(p + "/"));
  const quote = value => JSON.stringify(value);
  const profile = `(version 1)
(deny default)
(allow process-exec (literal ${quote(node)}))
(allow sysctl-read)
(allow mach-lookup)
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath ${quote(source)}) (subpath ${quote(scratch)})
  (literal ${quote(node)}) ${prefix ? `(subpath ${quote(prefix)})` : ""} (subpath "/System") (subpath "/usr/lib")
  (subpath "/private/var/db/dyld") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(allow file-write* (subpath ${quote(scratch)}) (literal "/dev/null"))`;
  return { command: "/usr/bin/sandbox-exec", args: ["-p", profile, node, "--test", "--test-isolation=none", "--test-reporter=tap", `--test-timeout=${timeout}`, ...tests],
    env: { PATH: path.dirname(node), HOME: scratch, TMPDIR: scratch, TMP: scratch, TEMP: scratch, LANG: "C", TZ: "UTC" },
    boundary: { adapter: "macos-sandbox-exec", network: "denied", process_fork: "denied", source_writes: "denied", scratch_writes: "allowed", inherited_environment: "removed", parent_agent_confined: false,
      note: "Opt-in platform adapter uses deprecated sandbox-exec; compatible Node tests only. Not a general hostile-code or production isolation claim." } };
}
