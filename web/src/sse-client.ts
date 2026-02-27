import { readViteBool, readViteInt } from "./env";

export type ServerMessage = {
  type: string;
  seq: number;
  data: unknown;
};

type SseHandlers = {
  onSnapshot: (data: unknown) => void;
  onMessage?: (message: ServerMessage) => void;
  onError?: (error: Error) => void;
};

const getReconnectEnabled = (): boolean =>
  readViteBool({ name: "VITE_SSE_RECONNECT_ENABLED", defaultValue: true });

const getReconnectBaseDelayMs = (): number =>
  readViteInt({
    name: "VITE_SSE_RECONNECT_BASE_DELAY_MS",
    defaultValue: 3_000,
    min: 50,
    max: 60_000,
  });

const getReconnectMaxDelayMs = (): number =>
  readViteInt({
    name: "VITE_SSE_RECONNECT_MAX_DELAY_MS",
    defaultValue: 30_000,
    min: 50,
    max: 300_000,
  });

export const connectSse = (url: string, handlers: SseHandlers) => {
  let source = new EventSource(url);

  const isReconnectEnabled = getReconnectEnabled();
  const reconnectBaseDelayMs = getReconnectBaseDelayMs();
  const reconnectMaxDelayMs = Math.max(reconnectBaseDelayMs, getReconnectMaxDelayMs());
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let isClosed = false;

  const reportError = (error: Error) => {
    if (handlers.onError) {
      handlers.onError(error);
    }
  };

  const attach = () => {
    source.onopen = () => {
      reconnectAttempt = 0;
    };

    source.onmessage = (event) => {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(event.data) as ServerMessage;
      } catch (error) {
        reportError(error instanceof Error ? error : new Error("Failed to parse SSE message"));
        return;
      }

      if (!parsed || typeof parsed.type !== "string") {
        reportError(new Error("Invalid SSE message"));
        return;
      }

      if (parsed.type.endsWith(".snapshot")) {
        handlers.onSnapshot(parsed.data);
        return;
      }

      if (handlers.onMessage) {
        handlers.onMessage(parsed);
      }
    };

    source.onerror = () => {
      reportError(new Error("SSE connection error"));
      if (isClosed) {
        return;
      }
      if (!isReconnectEnabled) {
        source.close();
        return;
      }
      if (reconnectTimer) {
        return;
      }
      source.close();

      const delay = Math.min(reconnectBaseDelayMs * 2 ** reconnectAttempt, reconnectMaxDelayMs);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (isClosed) {
          return;
        }
        source = new EventSource(url);
        attach();
      }, delay);
    };
  };

  attach();

  return {
    close: () => {
      if (isClosed) {
        return;
      }
      isClosed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      source.close();
    },
    reconnect: () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      source.close();
      isClosed = false;
      reconnectAttempt = 0;
      source = new EventSource(url);
      attach();
    },
  };
};
