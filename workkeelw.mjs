import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const pin = JSON.parse(fs.readFileSync(path.join(root, "workkeel.lock"), "utf8")).cli;
if (pin.package_name !== "@zsz1210/workkeel" || pin.version !== "0.1.0-alpha.34") throw Error("Workkeel pin mismatch");
const installed = path.join(root, "node_modules", "@zsz1210", "workkeel", "bin", "workkeel.mjs");
const source = process.env.WORKKEEL_CLI_PATH || (fs.existsSync(installed) ? installed : null);
if (source) {
  const check = spawnSync(process.execPath, [source, "version"], { cwd: root, encoding: "utf8" });
  if (check.status !== 0 || check.stdout.trim() !== pin.version) throw Error("Workkeel override version mismatch");
} else if (process.env.WORKKEEL_ALLOW_PACKAGE_FETCH !== "1") {
  throw Error("Pinned Workkeel CLI is not installed. Set WORKKEEL_CLI_PATH to the matching source bin/workkeel.mjs, or explicitly allow a published package fetch with WORKKEEL_ALLOW_PACKAGE_FETCH=1. No download was attempted.");
}
const run = source
  ? spawnSync(process.execPath, [source, ...process.argv.slice(2)], { cwd: root, stdio: "inherit" })
  : spawnSync("npm", ["exec", "--yes", "--package", pin.package_name + "@" + pin.version, "--", "workkeel", ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
process.exitCode = run.status ?? 1;
