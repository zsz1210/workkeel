import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// A direct child's exit precedes the exit of helpers it has already shut down.
// Allow a small, bounded natural drain; never extend the command deadline.
async function drainProcessGroup(alive, deadline) {
  while (alive() && Date.now() < deadline) await sleep(Math.min(10, deadline - Date.now()));
}
function boundedText(chunks) {
  const buffer = Buffer.concat(chunks), decoded = buffer.toString("utf8");
  // Invalid/truncated UTF-8 can expand on decoding. Keep persisted output within
  // the actual byte budget as well as limiting the captured child stream.
  if (Buffer.byteLength(decoded) <= buffer.length) return decoded;
  const encoded = Buffer.from(decoded).subarray(0, buffer.length);
  return new TextDecoder().decode(encoded, { stream: true });
}

// Trusted command supervision is an owned process-group boundary, not a sandbox.
// Windows needs a Job Object adapter before we can confirm descendant cleanup.
export async function runSupervisedCommand(command, { timeout_ms, output_limit_bytes, hooks = {} }) {
  const result = { execution_started: false, process_exit_confirmed: true, exit_code: null, stdout: "", stderr: "", timed_out: false, surviving_descendants: false, instrument_error: null };
  if (process.platform === "win32") return { ...result, instrument_error: "unsupported-platform-descendant-cleanup" };
  let child, pid, bytes = 0, overflow = false, startError = null, commandResult = null, protocolError = null, exitCleanup;
  const commandDeadline = Date.now() + timeout_ms;
  const chunks = [], errors = [], signalErrors = [];
  const alive = () => { if (!pid) return false; try { process.kill(-pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; } };
  const kill = () => { if (pid) try { process.kill(-pid, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") signalErrors.push(e.code); } };
  const exit = await new Promise(resolve => {
    let settled = false;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(watchdog); resolve(value); };
    const supervisorEnv = { ...command.env }; delete supervisorEnv.NODE_OPTIONS; delete supervisorEnv.NODE_PATH;
    child = spawn(process.execPath, [fileURLToPath(new URL("./workkeel-command-worker.mjs", import.meta.url)), "--command-supervise", String(timeout_ms)], { cwd: command.cwd, env: supervisorEnv, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    pid = child.pid;
    const timer = setTimeout(() => { result.timed_out = true; kill(); }, timeout_ms);
    const watchdog = setTimeout(() => { kill(); child.stdout.destroy(); child.stderr.destroy(); child.unref(); finish({ code: null, error: "unconfirmed-process-close" }); }, timeout_ms + 3000);
    for (const [stream, output] of [[child.stdout, chunks], [child.stderr, errors]]) stream.on("data", chunk => {
      const remaining = Math.max(0, output_limit_bytes - bytes); bytes += chunk.length;
      if (remaining) output.push(chunk.subarray(0, remaining));
      if (bytes > output_limit_bytes) { overflow = true; kill(); }
    });
    child.once("error", e => finish({ code: null, error: e.code ?? "spawn-failed" }));
    child.on("message", message => {
      if (message?.action === "command-started") result.execution_started = true;
      if (message?.action === "command-start-failed") startError = `command-spawn-${message.code}`;
      if (message?.action === "command-completed") {
        const code = message.exit_code, signal = message.signal;
        if (commandResult || !result.execution_started ||
            !(Number.isInteger(code) && code >= 0 && code <= 255 && signal === null ||
              code === null && typeof signal === "string" && /^SIG[A-Z0-9]+$/.test(signal))) {
          protocolError = "invalid-command-result"; kill();
        } else commandResult = { code, signal };
      }
    });
    child.once("exit", code => {
      exitCleanup = (async () => {
        if (code === 0 && !result.timed_out && !overflow && commandResult?.code === 0 && !protocolError)
          await drainProcessGroup(alive, Math.min(commandDeadline, Date.now() + 500));
        result.surviving_descendants = code === 0 && !result.timed_out && alive();
        if (alive()) kill();
      })();
    });
    child.once("close", code => finish({ code }));
    Promise.resolve().then(() => hooks.started?.({ process_group_id: pid })).then(() => {
      if (!settled && child.connected) {
        child.send({ action: "start", command }, error => { if (error) { kill(); finish({ code: null, error: error.message }); } });
      }
    }).catch(error => { kill(); finish({ code: null, error: error.message }); });
  });
  await exitCleanup;
  if (alive()) kill();
  const deadline = Date.now() + 2000; while (alive() && Date.now() < deadline) await sleep(10);
  Object.assign(result, { process_group_id: pid ?? null, process_exit_confirmed: !alive(), exit_code: commandResult ? commandResult.code : result.execution_started ? null : exit.code,
    stdout: boundedText(chunks), stderr: boundedText(errors),
    instrument_error: exit.error ?? startError ?? protocolError ?? (overflow ? "output-limit" : null), termination_signal_errors: signalErrors });
  if (!result.execution_started) result.instrument_error ??= "command-start-unconfirmed";
  else if (!commandResult) result.instrument_error ??= "command-exit-unconfirmed";
  else if (commandResult.signal) result.instrument_error ??= `command-terminated-${commandResult.signal}`;
  else if (exit.code !== commandResult.code) result.instrument_error ??= "supervisor-exit-mismatch";
  if (signalErrors.length) result.instrument_error ??= "process-group-signal-failed";
  if (!result.process_exit_confirmed) result.instrument_error = "unconfirmed-process-close";
  return result;
}
