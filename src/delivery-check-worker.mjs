// A separate supervisor survives coordinator death. IPC disconnect and the local
// deadline terminate only this owned POSIX process group, including test children.
import { spawn } from "node:child_process";

if (["--supervise", "--command-supervise"].includes(process.argv[2])) {
  const timeout = Number(process.argv[3]);
  const tests = process.argv.slice(4);
  const commandMode = process.argv[2] === "--command-supervise";
  if (!process.send || !Number.isSafeInteger(timeout) || timeout < 100 || timeout > 300000 || !commandMode && !tests.length) process.exit(2);
  const terminate = () => { try { process.kill(-process.pid, "SIGKILL"); } catch { process.exit(2); } };
  process.once("disconnect", terminate);
  const timer = setTimeout(terminate, timeout + 3000);
  let started = false;
  process.on("message", message => {
    if (started || message?.action !== "start") return;
    started = true;
    if (commandMode && (!message.command || typeof message.command.executable !== "string" || !Array.isArray(message.command.args))) process.exit(2);
    const child = commandMode
      ? spawn(message.command.executable, message.command.args, { cwd: message.command.cwd, env: message.command.env, shell: false, stdio: ["ignore", "inherit", "inherit"] })
      : message.confined
      ? spawn(message.confined.command, message.confined.args, { env: message.confined.env, stdio: ["ignore", "inherit", "inherit"] })
      : spawn(process.execPath, ["--test", "--test-reporter=tap", `--test-timeout=${timeout}`, ...tests], { stdio: ["ignore", "inherit", "inherit"] });
    let spawnReported = !commandMode, completedCode = null;
    const complete = code => { if (!spawnReported) { completedCode = code; return; } clearTimeout(timer); process.exit(code); };
    child.once("spawn", () => {
      if (!commandMode) return;
      process.send({ action: "command-started" }, error => {
        if (error) return terminate();
        spawnReported = true;
        if (completedCode !== null) complete(completedCode);
      });
    });
    child.once("error", error => {
      if (!commandMode) { spawnReported = true; complete(2); return; }
      process.send({ action: "command-start-failed", code: error.code ?? "unknown" }, sendError => {
        if (sendError) return terminate();
        spawnReported = true; complete(2);
      });
    });
    child.once("exit", code => complete(code ?? 1));
  });
}
