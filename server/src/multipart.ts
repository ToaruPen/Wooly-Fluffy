import type { IncomingHttpHeaders } from "http";
import { createRequire } from "node:module";
import type { Readable } from "node:stream";

type BusboyFileInfo = {
  filename: string;
  encoding: string;
  mimeType: string;
};

type BusboyLimits = {
  fileSize?: number;
  files?: number;
  fields?: number;
  parts?: number;
  fieldSize?: number;
};

interface BusboyInstance extends NodeJS.WritableStream {
  on(event: "field", cb: (name: string, value: string) => void): this;
  on(
    event: "file",
    cb: (name: string, file: NodeJS.ReadableStream, info: BusboyFileInfo) => void,
  ): this;
  on(event: "close" | "finish", cb: () => void): this;
  on(event: "error", cb: (err: Error) => void): this;
}

type BusboyFactory = (options: {
  headers: IncomingHttpHeaders;
  limits?: BusboyLimits;
}) => BusboyInstance;

const require = createRequire(import.meta.url);
const busboy = require("busboy") as unknown as BusboyFactory;

export const parseSttAudioUploadMultipart = async (input: {
  headers: IncomingHttpHeaders;
  stream: Readable;
  max_file_bytes: number;
}): Promise<{ stt_request_id: string; wav: Buffer }> =>
  new Promise((resolve, reject) => {
    const contentType = String(input.headers["content-type"] ?? "");
    if (!contentType.includes("multipart/form-data")) {
      reject(new Error("invalid_multipart"));
      return;
    }

    let isDone = false;
    const finishError = (err: Error) => {
      if (isDone) {
        return;
      }
      isDone = true;
      reject(err);
    };
    const finishOk = (result: { stt_request_id: string; wav: Buffer }) => {
      if (isDone) {
        return;
      }
      isDone = true;
      resolve(result);
    };

    let stt_request_id = "";
    let fieldCount = 0;
    let fileCount = 0;
    const audioChunks: Buffer[] = [];
    let isAudioTooLarge = false;
    let hasAudioSeen = false;
    let isInvalid = false;

    let bb: BusboyInstance;
    try {
      bb = busboy({
        headers: input.headers,
        limits: {
          fileSize: input.max_file_bytes,
        },
      });
    } catch {
      finishError(new Error("invalid_multipart"));
      return;
    }

    bb.on("field", (name, value) => {
      fieldCount += 1;
      if (fieldCount > 1) {
        isInvalid = true;
        return;
      }
      if (name !== "stt_request_id") {
        isInvalid = true;
        return;
      }
      stt_request_id = value.trim();
    });

    bb.on("file", (name, file) => {
      fileCount += 1;
      if (fileCount > 1) {
        isInvalid = true;
      }
      if (name !== "audio") {
        isInvalid = true;
        file.resume();
        return;
      }
      hasAudioSeen = true;

      file.on("data", (chunk: Buffer) => {
        if (isAudioTooLarge) {
          return;
        }
        audioChunks.push(chunk);
      });

      file.on("limit", () => {
        isAudioTooLarge = true;
      });
    });

    bb.on("error", (err) => {
      finishError(err);
    });

    bb.on("close", () => {
      if (isAudioTooLarge) {
        finishError(new Error("body_too_large"));
        return;
      }
      if (isInvalid) {
        finishError(new Error("invalid_multipart"));
        return;
      }
      const wav = hasAudioSeen ? Buffer.concat(audioChunks) : Buffer.from([]);
      finishOk({ stt_request_id, wav });
    });

    input.stream.pipe(bb);
  });
