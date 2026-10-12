import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateReleaseToolchain, ReleaseValidationError } from "./validate-npm-release.mjs";

function runNpm(npmCli, args, cwd) {
  // Use the current Node for both the fingerprint and pack; never a PATH shebang.
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function npmCliPath() {
  const adjacent = process.platform === "win32"
    ? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
    : path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
  const candidate = process.env.npm_execpath || adjacent;
  if (!(await fs.stat(candidate).catch(() => null))?.isFile()) {
    throw new ReleaseValidationError("Cannot locate npm CLI for release packing; use npm run release:pack with the official Node distribution.");
  }
  return candidate;
}

export async function packRelease({ sourceDirectory = process.cwd(), outputDirectory }) {
  if (!outputDirectory) throw new ReleaseValidationError("--output must name a new directory outside the source checkout");
  const source = await fs.realpath(sourceDirectory);
  // Resolve the existing parent so a symlink cannot put output inside the source.
  const requested = path.resolve(outputDirectory);
  const output = path.join(await fs.realpath(path.dirname(requested)), path.basename(requested));
  const relative = path.relative(source, output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new ReleaseValidationError("Release output must be outside the source checkout");
  }
  const npmCli = await npmCliPath();
  const toolchain = validateReleaseToolchain({ npmVersion: runNpm(npmCli, ["--version"], source).trim() });
  // Existing candidates are never overwritten, even when their version matches.
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, "toolchain.json"), `${JSON.stringify(toolchain, null, 2)}\n`, { flag: "wx" });
  const packed = JSON.parse(runNpm(npmCli, ["pack", "--ignore-scripts", "--json", "--pack-destination", output], source));
  if (!Array.isArray(packed) || packed.length !== 1 || !packed[0].filename ||
      path.basename(packed[0].filename) !== packed[0].filename) {
    throw new ReleaseValidationError("npm pack must return one basename-only archive");
  }
  await fs.writeFile(path.join(output, "pack-result.json"), `${JSON.stringify(packed, null, 2)}\n`, { flag: "wx" });
  return { toolchain, archive_filename: packed[0].filename, archive_size: packed[0].size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 2 || args[0] !== "--output" || !args[1] || args[1].startsWith("--")) {
      throw new ReleaseValidationError("usage: npm run release:pack -- --output <new-directory-outside-checkout>");
    }
    console.log(JSON.stringify(await packRelease({ outputDirectory: args[1] }), null, 2));
  } catch (error) {
    console.error(`Release packing failed: ${error.message}`);
    process.exitCode = 1;
  }
}
