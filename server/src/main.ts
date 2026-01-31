import { createHttpServer } from "./http-server.js";
import { createStore } from "./store.js";
import { join } from "node:path";
import { shutdownHttpServer, trackHttpServerConnections } from "./graceful-shutdown.js";

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return 3000;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return 3000;
  }
  return parsed;
};

const host = process.env.HOST ?? "127.0.0.1";
const port = parsePort(process.env.PORT);

const baseDir = process.env.INIT_CWD ?? process.cwd();
const dbPath = process.env.DB_PATH ?? join(baseDir, "var", "wooly-fluffy.sqlite3");

const store = (() => {
  try {
    return createStore({ db_path: dbPath });
  } catch (err) {
    console.error(`Failed to open SQLite DB at ${dbPath}`);
    console.error(err);
    process.exitCode = 1;
    throw err;
  }
})();

try {
  store.housekeepExpired();
} catch (err) {
  console.error(err);
}

const housekeepingTimer = setInterval(() => {
  try {
    store.housekeepExpired();
  } catch (err) {
    console.error(err);
  }
}, 600_000);

housekeepingTimer.unref?.();

const server = createHttpServer();
trackHttpServerConnections(server);
server.listen(port, host);

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  clearInterval(housekeepingTimer);
  try {
    store.close();
  } catch (err) {
    console.error(err);
  }

  shutdownHttpServer(server)
    .then(() => {
      process.exitCode = 0;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
