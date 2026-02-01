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
  on(event: "file", cb: (name: string, file: NodeJS.ReadableStream, info: BusboyFileInfo) => void): this;
  on(event: "close" | "finish", cb: () => void): this;
  on(event: "error", cb: (err: Error) => void): this;
}

type BusboyFactory = (options: { headers: IncomingHttpHeaders; limits?: BusboyLimits }) => BusboyInstance;

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

    let done = false;
    const finishError = (err: Error) => {
      if (done) {
        return;
      }
      done = true;
      reject(err);
    };
    const finishOk = (result: { stt_request_id: string; wav: Buffer }) => {
      if (done) {
        return;
      }
      done = true;
      resolve(result);
    };

    let stt_request_id = "";
    let fieldCount = 0;
    let fileCount = 0;
    const audioChunks: Buffer[] = [];
    let audioTooLarge = false;
    let audioSeen = false;
    let invalid = false;

    let bb: BusboyInstance;
    try {
      bb = busboy({
        headers: input.headers,
        limits: {
          fileSize: input.max_file_bytes
        }
      });
    } catch {
      finishError(new Error("invalid_multipart"));
      return;
    }

    bb.on("field", (name, value) => {
      fieldCount += 1;
      if (fieldCount > 1) {
        invalid = true;
        return;
      }
      if (name !== "stt_request_id") {
        invalid = true;
        return;
      }
      stt_request_id = value.trim();
    });

    bb.on("file", (name, file) => {
      fileCount += 1;
      if (fileCount > 1) {
        invalid = true;
      }
      if (name !== "audio") {
        invalid = true;
        file.resume();
        return;
      }
      audioSeen = true;

      file.on("data", (chunk: Buffer) => {
        if (audioTooLarge) {
          return;
        }
        audioChunks.push(chunk);
      });

      file.on("limit", () => {
        audioTooLarge = true;
      });
    });

    bb.on("error", (err) => {
      finishError(err);
    });

    bb.on("close", () => {
      if (audioTooLarge) {
        finishError(new Error("body_too_large"));
        return;
      }
      if (invalid) {
        finishError(new Error("invalid_multipart"));
        return;
      }
      const wav = audioSeen ? Buffer.concat(audioChunks) : Buffer.from([]);
      finishOk({ stt_request_id, wav });
    });

    input.stream.pipe(bb);
  });
