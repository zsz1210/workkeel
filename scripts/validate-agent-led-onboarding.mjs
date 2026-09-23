#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArguments(argv) {
  const options = { output: null, keep: false, root: SCRIPT_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--keep") options.keep = true;
    else if (value === "--output") options.output = argv[++index];
    else if (value === "--root") options.root = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.output) throw new Error("--output is required");
  return options;
}

function run(command, args, options = {}) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    maxBuffer: 32 * 1024 * 1024
  });
  const elapsedMs = Math.round(performance.now() - started);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`
    );
  }
  return { stdout: result.stdout, stderr: result.stderr, elapsed_ms: elapsedMs };
}

function parseJsonOutput(step, label) {
  try {
    return JSON.parse(step.stdout);
  } catch (error) {
    throw new Error(`${label} did not return one JSON document: ${error.message}`);
  }
}

async function writeExclusiveJson(outputPath, document) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await fs.open(outputPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`);
  } finally {
    await handle.close();
  }
}

function initConfig() {
  return {
    schema_version: "temple.init/v1",
    project: { id: "agent-led-greenfield", name: "Agent-led Greenfield Fixture" },
    naming_mode: "manual",
    agents: [
      { display_name: "Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Mira", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Theo", positions: ["tech_lead"] },
      { display_name: "Devon", positions: ["developer"] },
      { display_name: "Quinn", positions: ["quality_evaluator", "independent_qa"] }
    ]
  };
}

export async function runAgentLedOnboardingValidation(options) {
  const packageRoot = path.resolve(options.root ?? SCRIPT_ROOT);
  const outputPath = path.resolve(options.output);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-agent-led-onboarding-"));
  const projectPath = path.join(temporaryRoot, "consumer");
  const configPath = path.join(temporaryRoot, "init.json");
  const packageDirectory = path.join(temporaryRoot, "package");
  const timeline = [];

  try {
    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(packageDirectory, { recursive: true });
    await fs.writeFile(
      path.join(projectPath, "package.json"),
      `${JSON.stringify({ name: "agent-led-greenfield-fixture", version: "0.0.0", private: true }, null, 2)}\n`
    );
    await fs.writeFile(configPath, `${JSON.stringify(initConfig(), null, 2)}\n`);

    const packed = run("npm", ["pack", "--json", "--pack-destination", packageDirectory], { cwd: packageRoot });
    timeline.push({ step: "pack", elapsed_ms: packed.elapsed_ms, status: "passed" });
    const packResult = parseJsonOutput(packed, "npm pack")[0];
    const tarballPath = path.join(packageDirectory, packResult.filename);

    // npm ci populates tarballs, not necessarily registry package metadata.
    // Carry its exact dependency lock into the consumer so offline qualification
    // never depends on unrelated prior npm installs having warmed that metadata.
    const sourcePackage = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
    const sourceLock = JSON.parse(await fs.readFile(path.join(packageRoot, "package-lock.json"), "utf8"));
    assert.equal(sourceLock.lockfileVersion, 3);
    assert.equal(sourceLock.packages[""].version, sourcePackage.version);
    const consumerPackage = {
      name: "agent-led-greenfield-fixture", version: "0.0.0", private: true,
      dependencies: { [sourcePackage.name]: `file:${tarballPath}` }
    };
    const dependencyPackages = Object.fromEntries(Object.entries(sourceLock.packages)
      .filter(([name, entry]) => name !== "" && !entry.dev));
    await fs.writeFile(path.join(projectPath, "package.json"), `${JSON.stringify(consumerPackage, null, 2)}\n`);
    await fs.writeFile(path.join(projectPath, "package-lock.json"), `${JSON.stringify({
      name: consumerPackage.name, version: consumerPackage.version, lockfileVersion: 3, requires: true,
      packages: {
        "": consumerPackage,
        ...dependencyPackages,
        [`node_modules/${sourcePackage.name}`]: {
          version: sourcePackage.version, resolved: `file:${tarballPath}`, integrity: packResult.integrity,
          dependencies: sourcePackage.dependencies, bin: sourcePackage.bin, engines: sourcePackage.engines,
          license: sourcePackage.license
        }
      }
    }, null, 2)}\n`);
    const installed = run(
      "npm",
      ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: projectPath }
    );
    timeline.push({ step: "install", elapsed_ms: installed.elapsed_ms, status: "passed" });

    const cliPath = path.join(
      projectPath,
      "node_modules",
      sourcePackage.name,
      sourcePackage.bin.temple
    );
    const initialized = run(process.execPath, [cliPath, "init", ".", "--config", configPath, "--json"], {
      cwd: projectPath
    });
    timeline.push({ step: "init", elapsed_ms: initialized.elapsed_ms, status: "passed" });
    const initResult = parseJsonOutput(initialized, "temple init");

    const doctorStep = run(process.execPath, ["./templew.mjs", "doctor", ".", "--json"], { cwd: projectPath });
    timeline.push({ step: "doctor", elapsed_ms: doctorStep.elapsed_ms, status: "passed" });
    const doctor = parseJsonOutput(doctorStep, "temple doctor");

    const statusStep = run(process.execPath, ["./templew.mjs", "status", ".", "--no-write", "--json"], {
      cwd: projectPath
    });
    timeline.push({ step: "status", elapsed_ms: statusStep.elapsed_ms, status: "passed" });
    const status = parseJsonOutput(statusStep, "temple status");

    const bootstrap = initResult.bootstrap;
    assert.equal(initResult.status, "initialized");
    assert.equal(bootstrap.schema_version, "temple.bootstrap-required/v1");
    assert.equal(bootstrap.marker, "TEMPLE_BOOTSTRAP_REQUIRED");
    assert.equal(bootstrap.status, "required");
    assert.equal(bootstrap.provider_entrypoint.provider, "claude-code");
    assert.equal(bootstrap.provider_entrypoint.status, "available");
    assert.equal(bootstrap.provider_entrypoint.session_loading_verified, false);
    assert.equal(bootstrap.provider_entrypoint.comprehension_verified, false);
    for (const value of Object.values(bootstrap.authority)) assert.equal(value, false);
    assert.equal(doctor.summary.fail, 0);
    assert.equal(status.project.id, "agent-led-greenfield");

    const instructionReads = [];
    for (const source of bootstrap.instruction_sources) {
      const contents = await fs.readFile(path.join(projectPath, source.path), "utf8");
      instructionReads.push({ path: source.path, bytes: Buffer.byteLength(contents), status: "read" });
    }
    const claudeContents = await fs.readFile(path.join(projectPath, "CLAUDE.md"), "utf8");
    assert.equal(claudeContents, "@AGENTS.md\n");
    const lock = JSON.parse(await fs.readFile(path.join(projectPath, "temple.lock"), "utf8"));
    assert.equal(lock.managed_files.some((entry) => entry.path === "CLAUDE.md"), false);

    const document = {
      schema_version: "temple.agent-led-onboarding-observation/v1",
      work_item_id: "WI-0115",
      status: "passed_with_provider_limits",
      observed_at: new Date().toISOString(),
      package: {
        name: packResult.name,
        version: packResult.version,
        filename: packResult.filename,
        size_bytes: packResult.size,
        unpacked_size_bytes: packResult.unpackedSize,
        integrity: packResult.integrity
      },
      deterministic_validation: {
        temporary_project_created: true,
        package_installed_offline: true,
        init_status: initResult.status,
        bootstrap_schema: bootstrap.schema_version,
        bootstrap_marker: bootstrap.marker,
        doctor: doctor.summary,
        status_project_id: status.project.id,
        claude_entrypoint: {
          contents: claudeContents.trim(),
          integration: bootstrap.claude_integration,
          project_owned: true,
          framework_managed: false
        },
        instruction_sources: bootstrap.instruction_sources.map((source) => source.path),
        instruction_reads: instructionReads,
        authority: bootstrap.authority,
        human_interventions: 0,
        timeline,
        total_elapsed_ms: timeline.reduce((sum, entry) => sum + entry.elapsed_ms, 0)
      },
      provider_validation: {
        status: "not_run",
        reason: "A deterministic clean installation cannot prove provider-owned session loading or comprehension.",
        session_loading_verified: false,
        comprehension_verified: false,
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        reasoning_output_tokens: null,
        total_tokens: null
      },
      authority: {
        lifecycle_mutation_authorized: false,
        external_write_performed: false,
        provider_call_performed: false,
        package_published: false,
        deployment_performed: false
      },
      retained_limits: [
        "The runner read the declared files deterministically; it did not observe a fresh provider session.",
        "No model Token or comprehension result is inferred from installation success.",
        "Offline package installation depends on the local npm cache and is not a public-registry availability test."
      ]
    };
    await writeExclusiveJson(outputPath, document);
    return { document, temporaryRoot: options.keep ? temporaryRoot : null };
  } finally {
    if (!options.keep) await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await runAgentLedOnboardingValidation(options);
    process.stdout.write(`${JSON.stringify(result.document, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
