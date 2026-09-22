import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const env = { ...process.env, RISE_HOST: process.env.RISE_HOST || "127.0.0.1" };

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(Number(port), "127.0.0.1");
  });
}

async function riseApiIsRunning() {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
    const body = await response.json();
    return response.ok && body.status === "ok";
  } catch {
    return false;
  }
}

let apiPort = process.env.RISE_PORT || "8787";
let reuseApi = await riseApiIsRunning();
if (!reuseApi && !(await portIsFree(apiPort))) {
  if (process.env.RISE_PORT) {
    console.error(`Port ${apiPort} is already used by another service. Choose another RISE_PORT.`);
    process.exit(1);
  }
  for (let candidate = 8788; candidate <= 8800; candidate += 1) {
    if (await portIsFree(candidate)) {
      apiPort = String(candidate);
      break;
    }
  }
  if (apiPort === "8787") {
    console.error("Could not find a free API port between 8787 and 8800.");
    process.exit(1);
  }
  console.log(`Port 8787 is busy; using ${apiPort} for the Rise API.`);
}
env.RISE_PORT = apiPort;

const processes = [];
if (reuseApi) {
  console.log(`Using the Rise API already running on port ${apiPort}.`);
} else {
  processes.push(spawn("python3", ["server.py"], { env, stdio: "inherit" }));
}
processes.push(
  spawn(npm, ["--prefix", "frontend", "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
    env,
    stdio: "inherit",
  }),
);

let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of processes) {
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    if (code !== 0) {
      console.error(`Development process stopped (${signal || `exit ${code}`}).`);
      process.exitCode = code || 1;
    }
    stop();
  });
}

process.on("SIGINT", () => {
  // The terminal sends Ctrl-C to the whole foreground process group. Mark the
  // shutdown here without sending Python and Vite a duplicate interrupt.
  stopping = true;
});
process.on("SIGTERM", () => stop("SIGTERM"));

console.log("Rise development: http://127.0.0.1:5173");
