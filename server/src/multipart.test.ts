import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { parseSttAudioUploadMultipart } from "./multipart.js";

const buildMultipartBody = (input: { boundary: string; stt_request_id: string; audio: Buffer }) => {
  const lines: Array<string | Buffer> = [
    `--${input.boundary}\r\n`,
    `Content-Disposition: form-data; name="stt_request_id"\r\n\r\n`,
    `${input.stt_request_id}\r\n`,
    `--${input.boundary}\r\n`,
    `Content-Disposition: form-data; name="audio"; filename="audio.wav"\r\n`,
    `Content-Type: audio/wav\r\n\r\n`,
    input.audio,
    `\r\n`,
    `--${input.boundary}--\r\n`
  ];
  return Buffer.concat(lines.map((part) => (typeof part === "string" ? Buffer.from(part, "utf8") : part)));
};

describe("multipart", () => {
  it("throws invalid_multipart when content-type is not multipart", async () => {
    const stream = Readable.from([Buffer.from("nope", "utf8")]);
    await expect(
      parseSttAudioUploadMultipart({
        headers: { "content-type": "application/octet-stream" },
        stream,
        max_file_bytes: 2_500_000
      })
    ).rejects.toThrowError("invalid_multipart");
  });

  it("throws invalid_multipart when content-type is missing", async () => {
    const stream = Readable.from([Buffer.from("nope", "utf8")]);
    await expect(
      parseSttAudioUploadMultipart({
        headers: {},
        stream,
        max_file_bytes: 2_500_000
      })
    ).rejects.toThrowError("invalid_multipart");
  });

  it("parses audio bytes without corruption", async () => {
    const boundary = "testboundary";
    const audio = Buffer.concat([
      Buffer.from("RIFF", "utf8"),
      Buffer.alloc(32, 0x11),
      Buffer.from("name=\"audio\"", "utf8"),
      Buffer.alloc(32, 0x22)
    ]);

    const body = buildMultipartBody({ boundary, stt_request_id: "stt-1", audio });
    const stream = Readable.from([body]);

    const parsed = await parseSttAudioUploadMultipart({
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      stream,
      max_file_bytes: 2_500_000
    });

    expect(parsed.stt_request_id).toBe("stt-1");
    expect(Buffer.compare(parsed.wav, audio)).toBe(0);
  });

  it("throws body_too_large when audio exceeds max_file_bytes", async () => {
    const boundary = "testboundary";
    const audio = Buffer.alloc(50, 0x33);
    const body = buildMultipartBody({ boundary, stt_request_id: "stt-1", audio });
    const stream = Readable.from([body]);

    await expect(
      parseSttAudioUploadMultipart({
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        stream,
        max_file_bytes: 10
      })
    ).rejects.toThrowError("body_too_large");
  });

  it("throws invalid_multipart when multipart contains unexpected fields", async () => {
    const boundary = "testboundary";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`, "utf8"),
      Buffer.from(`Content-Disposition: form-data; name="nope"\r\n\r\n`, "utf8"),
      Buffer.from("x\r\n", "utf8"),
      Buffer.from(`--${boundary}--\r\n`, "utf8")
    ]);
    const stream = Readable.from([body]);

    await expect(
      parseSttAudioUploadMultipart({
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        stream,
        max_file_bytes: 2_500_000
      })
    ).rejects.toThrowError("invalid_multipart");
  });

  it("throws invalid_multipart when multipart contains more than one field", async () => {
    const boundary = "testboundary";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`, "utf8"),
      Buffer.from(`Content-Disposition: form-data; name="stt_request_id"\r\n\r\n`, "utf8"),
      Buffer.from("stt-1\r\n", "utf8"),
      Buffer.from(`--${boundary}\r\n`, "utf8"),
      Buffer.from(`Content-Disposition: form-data; name="stt_request_id"\r\n\r\n`, "utf8"),
      Buffer.from("stt-2\r\n", "utf8"),
      Buffer.from(`--${boundary}--\r\n`, "utf8")
    ]);
    const stream = Readable.from([body]);

    await expect(
      parseSttAudioUploadMultipart({
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        stream,
        max_file_bytes: 2_500_000
      })
    ).rejects.toThrowError("invalid_multipart");
  });

  it("throws invalid_multipart when multipart contains more than one file", async () => {
    const boundary = "testboundary";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`, "utf8"),
      Buffer.from(`Content-Disposition: form-data; name="stt_request_id"\r\n\r\n`, "utf8"),
      Buffer.from("stt-1\r\n", "utf8"),
      Buffer.from(`--${boundary}\r\n`, "utf8"),
      Buffer.from(`Content-Disposition: form-data; name="audio"; filename="a.wav"\r\n`, "utf8"),
      Buffer.from(`Content-Type: audio/wav\r\n\r\n`, "utf8"),
      Buffer.from("abc", "utf8"),
      Buffer.from(`\r\n--${boundary}\r\n`, "utf8"),
      Buffer.from(`Content-Disposition: form-data; name="audio"; filename="b.wav"\r\n`, "utf8"),
      Buffer.from(`Content-Type: audio/wav\r\n\r\n`, "utf8"),
      Buffer.from("def", "utf8"),
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
    ]);
    const stream = Readable.from([body]);

    await expect(
      parseSttAudioUploadMultipart({
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        stream,
        max_file_bytes: 2_500_000
      })
    ).rejects.toThrowError("invalid_multipart");
  });

  it("throws invalid_multipart when file field name is not audio", async () => {
    const boundary = "testboundary";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`, "utf8"),
      Buffer.from(`Content-Disposition: form-data; name="stt_request_id"\r\n\r\n`, "utf8"),
      Buffer.from("stt-1\r\n", "utf8"),
      Buffer.from(`--${boundary}\r\n`, "utf8"),
      Buffer.from(`Content-Disposition: form-data; name="not_audio"; filename="x.bin"\r\n`, "utf8"),
      Buffer.from(`Content-Type: application/octet-stream\r\n\r\n`, "utf8"),
      Buffer.from("abc", "utf8"),
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
    ]);
    const stream = Readable.from([body]);

    await expect(
      parseSttAudioUploadMultipart({
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        stream,
        max_file_bytes: 2_500_000
      })
    ).rejects.toThrowError("invalid_multipart");
  });
});
