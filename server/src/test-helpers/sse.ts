import { request } from "http";

type JsonSseMessage = {
  type: string;
  seq: number;
  data: unknown;
};

type ReadOptions = {
  headers?: Record<string, string>;
  timeout_ms?: number;
};

type FirstMessage = {
  status: number;
  contentType: string;
  data: string;
  id: string;
};

const findSseDelimiter = (buffer: string): { index: number; length: number } | null => {
  const lfIndex = buffer.indexOf("\n\n");
  const crlfIndex = buffer.indexOf("\r\n\r\n");
  if (lfIndex === -1 && crlfIndex === -1) {
    return null;
  }
  if (lfIndex === -1) {
    return { index: crlfIndex, length: 4 };
  }
  if (crlfIndex === -1) {
    return { index: lfIndex, length: 2 };
  }
  return lfIndex < crlfIndex ? { index: lfIndex, length: 2 } : { index: crlfIndex, length: 4 };
};

const parseSseLines = (eventChunk: string): { data?: string; id?: string } => {
  const lines = eventChunk.split(/\r?\n/);
  const dataLine = lines.find((line) => line.startsWith("data: "));
  const idLine = lines.find((line) => line.startsWith("id: "));
  return {
    data: dataLine ? dataLine.slice("data: ".length) : undefined,
    id: idLine ? idLine.slice("id: ".length) : undefined,
  };
};

export const createSseTestHelpers = (getPort: () => number) => {
  const readSseUntil = (
    path: string,
    predicate: (message: JsonSseMessage, messages: JsonSseMessage[]) => boolean,
    onFirstMessage?: () => Promise<void>,
    options?: ReadOptions,
  ) =>
    new Promise<JsonSseMessage[]>((resolve, reject) => {
      let isDone = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let req: ReturnType<typeof request> | undefined;

      const finish = (err?: Error, result?: JsonSseMessage[]) => {
        if (isDone) {
          return;
        }
        isDone = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        if (err) {
          reject(err);
          return;
        }
        resolve(result ?? []);
      };

      const messages: JsonSseMessage[] = [];
      req = request({ host: "127.0.0.1", port: getPort(), method: "GET", path }, (res) => {
        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          while (true) {
            const delimiter = findSseDelimiter(buffer);
            if (!delimiter) {
              return;
            }
            const eventChunk = buffer.slice(0, delimiter.index);
            buffer = buffer.slice(delimiter.index + delimiter.length);
            const parsedLines = parseSseLines(eventChunk);
            if (!parsedLines.data) {
              continue;
            }

            let parsed: JsonSseMessage;
            try {
              parsed = JSON.parse(parsedLines.data) as JsonSseMessage;
            } catch (err) {
              finish(err instanceof Error ? err : new Error("invalid_sse_json"));
              return;
            }

            messages.push(parsed);
            if (messages.length === 1 && onFirstMessage) {
              void onFirstMessage().catch((err: unknown) => {
                req?.destroy();
                finish(err instanceof Error ? err : new Error("onFirstMessage_failed"));
              });
            }

            try {
              if (predicate(parsed, messages)) {
                res.destroy();
                finish(undefined, messages);
                return;
              }
            } catch (err) {
              finish(err instanceof Error ? err : new Error("sse_predicate_failed"));
              return;
            }
          }
        });
      });

      if (options?.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          req.setHeader(key, value);
        }
      }

      timeout = setTimeout(() => {
        req?.destroy();
        finish(new Error("sse_timeout"));
      }, options?.timeout_ms ?? 2000);

      req.on("error", (err) => {
        finish(err instanceof Error ? err : new Error("request_error"));
      });
      req.end();
    });

  const readSseDataMessages = (
    path: string,
    expectedCount: number,
    onFirstMessage?: () => Promise<void>,
    options?: ReadOptions,
  ): Promise<JsonSseMessage[]> =>
    readSseUntil(
      path,
      (_message, messages) => messages.length >= expectedCount,
      onFirstMessage,
      options,
    );

  const readFirstSseMessage = (path: string, options?: ReadOptions) =>
    new Promise<FirstMessage>((resolve, reject) => {
      let isDone = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const finish = (err?: Error, result?: FirstMessage) => {
        if (isDone) {
          return;
        }
        isDone = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        if (err) {
          reject(err);
          return;
        }
        if (!result) {
          reject(new Error("missing_result"));
          return;
        }
        resolve(result);
      };

      const req = request({ host: "127.0.0.1", port: getPort(), method: "GET", path }, (res) => {
        const contentTypeHeader = res.headers["content-type"];
        const contentType = Array.isArray(contentTypeHeader)
          ? (contentTypeHeader[0] ?? "")
          : (contentTypeHeader ?? "");

        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          const delimiter = findSseDelimiter(buffer);
          if (!delimiter) {
            return;
          }

          const eventChunk = buffer.slice(0, delimiter.index);
          res.destroy();
          const parsedLines = parseSseLines(eventChunk);
          finish(undefined, {
            status: res.statusCode ?? 0,
            contentType,
            data: parsedLines.data ?? "",
            id: parsedLines.id ?? "",
          });
        });
      });

      if (options?.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          req.setHeader(key, value);
        }
      }

      timeout = setTimeout(() => {
        req.destroy();
        finish(new Error("sse_timeout"));
      }, options?.timeout_ms ?? 2000);

      req.on("error", (err) => {
        finish(err instanceof Error ? err : new Error("request_error"));
      });
      req.end();
    });

  return {
    readSseUntil,
    readSseDataMessages,
    readFirstSseMessage,
  };
};
