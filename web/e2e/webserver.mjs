import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const host = "127.0.0.1";
const serverPort = Number(process.env.WF_SERVER_PORT ?? "3000");
const webPort = Number(process.env.WF_WEB_PORT ?? "5173");

const serverHealthUrl = `http://${host}:${serverPort}/health`;
const webKioskUrl = `http://${host}:${webPort}/kiosk`;

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const waitForHttpOk = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`Timeout waiting for ${url}`);
    }
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        return;
      }
    } catch {
      // ignore and retry
    }
    await sleep(250);
  }
};

const processes = [];

const spawnLogged = (command, args, env) => {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: false
  });
  processes.push(child);
  return child;
};

const killAll = async (signal) => {
  for (const p of processes) {
    if (!p.killed) {
      p.kill(signal);
    }
  }
  await sleep(250);
  for (const p of processes) {
    if (!p.killed) {
      p.kill("SIGKILL");
    }
  }
};

process.on("SIGINT", () => {
  void killAll("SIGINT").finally(() => process.exit(130));
});

process.on("SIGTERM", () => {
  void killAll("SIGTERM").finally(() => process.exit(143));
});

const main = async () => {
  // Start server (builds first via prestart)
  const server = spawnLogged("npm", ["run", "-w", "server", "start"], {
    HOST: host,
    PORT: String(serverPort)
  });
  server.on("exit", (code, signal) => {
    console.error(`server exited early: code=${code} signal=${signal}`);
    void killAll("SIGTERM").finally(() => process.exit(1));
  });
  await waitForHttpOk(serverHealthUrl, 60_000);

  // Start web dev server
  const web = spawnLogged("npm", ["run", "-w", "web", "dev", "--", "--host", host, "--port", String(webPort)], {
    WF_SERVER_PORT: String(serverPort)
  });
  web.on("exit", (code, signal) => {
    console.error(`web exited early: code=${code} signal=${signal}`);
    void killAll("SIGTERM").finally(() => process.exit(1));
  });
  await waitForHttpOk(webKioskUrl, 60_000);

  // Keep process alive while Playwright runs.
  for (;;) {
    await sleep(1_000);
  }
};

main().catch(async (err) => {
  console.error(err);
  await killAll("SIGTERM");
  process.exit(1);
});
