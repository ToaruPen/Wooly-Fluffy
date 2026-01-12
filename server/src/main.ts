import { createHttpServer } from "./http-server.js";

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

createHttpServer().listen(port, host);
