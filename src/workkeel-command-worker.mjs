// A separate supervisor survives coordinator death. IPC disconnect and the local
// deadline terminate only this owned POSIX process group, including its children.
import { spawn } from "node:child_process";

if (process.argv[2] === "--command-supervise") {
  const timeout = Number(process.argv[3]);
  if (!process.send || !Number.isSafeInteger(timeout) || timeout < 100 || timeout > 300000) process.exit(2);
  const terminate = () => { try { process.kill(-process.pid, "SIGKILL"); } catch { process.exit(2); } };
  process.once("disconnect", terminate);
  const timer = setTimeout(terminate, timeout + 3000);
  let started = false;
  process.on("message", message => {
    if (started || message?.action !== "start") return;
    started = true;
    if (!message.command || typeof message.command.executable !== "string" || !Array.isArray(message.command.args)) process.exit(2);
    const child = spawn(message.command.executable, message.command.args, { cwd: message.command.cwd, env: message.command.env, shell: false, stdio: ["ignore", "inherit", "inherit"] });
    let spawnReported = false, pendingResult = null, finalizing = false;
    const complete = (code, signal = null, report = true) => {
      if (!spawnReported) { pendingResult = { code, signal, report }; return; }
      if (finalizing) return;
      finalizing = true; clearTimeout(timer);
      // The supervisor's exit is not the command's result. Confirm the latter
      // over IPC before exiting, including a signal's absent numeric exit code.
      if (report) process.send({ action: "command-completed", exit_code: code, signal }, error => {
        if (error) return terminate();
        process.exit(code ?? 1);
      });
      else process.exit(code ?? 1);
    };
    child.once("spawn", () => {
      process.send({ action: "command-started" }, error => {
        if (error) return terminate();
        spawnReported = true;
        if (pendingResult) complete(pendingResult.code, pendingResult.signal, pendingResult.report);
      });
    });
    child.once("error", error => {
      process.send({ action: "command-start-failed", code: error.code ?? "unknown" }, sendError => {
        if (sendError) return terminate();
        spawnReported = true; complete(2, null, false);
      });
    });
    child.once("exit", (code, signal) => complete(code, signal));
  });
}
