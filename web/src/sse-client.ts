type ServerMessage = {
  type: string;
  seq: number;
  data: unknown;
};

type SseHandlers = {
  onSnapshot: (data: unknown) => void;
  onError?: (error: Error) => void;
};

export const connectSse = (url: string, handlers: SseHandlers) => {
  const source = new EventSource(url);

  const reportError = (error: Error) => {
    if (handlers.onError) {
      handlers.onError(error);
    }
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
    }
  };

  source.onerror = () => {
    reportError(new Error("SSE connection error"));
  };

  return {
    close: () => {
      source.close();
    }
  };
};
