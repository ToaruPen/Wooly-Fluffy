import type { Server } from "http";
import type { Socket } from "net";

type Connections = {
  sockets: Set<Socket>;
  destroyAll: () => void;
};

const connectionsByServer = new WeakMap<Server, Connections>();

export const trackHttpServerConnections = (server: Server): Connections => {
  const existing = connectionsByServer.get(server);
  if (existing) {
    return existing;
  }

  const sockets = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  const connections: Connections = {
    sockets,
    destroyAll: () => {
      for (const socket of sockets) {
        socket.destroy();
      }
    },
  };

  connectionsByServer.set(server, connections);
  return connections;
};

export const shutdownHttpServer = async (server: Server): Promise<void> => {
  const connections = trackHttpServerConnections(server);

  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (!err) {
        resolve();
        return;
      }

      if (typeof err === "object" && err && "code" in err) {
        const code = (err as { code?: unknown }).code;
        if (code === "ERR_SERVER_NOT_RUNNING") {
          resolve();
          return;
        }
      }

      reject(err);
    });

    connections.destroyAll();
  });
};
