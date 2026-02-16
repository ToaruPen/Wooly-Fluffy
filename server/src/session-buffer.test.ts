import { describe, expect, it } from "vitest";
import {
  appendToSessionBuffer,
  buildSessionSummaryMessages,
  createEmptySessionBuffer,
  type SessionBufferLimits,
} from "./session-buffer.js";

const repeat = (s: string, n: number) => Array.from({ length: n }, () => s).join("");

describe("session-buffer", () => {
  const limits: SessionBufferLimits = {
    max_messages: 3,
    max_message_chars: 4,
    max_total_chars: 100,
    max_running_summary_chars: 50,
    fold_excerpt_chars: 3,
  };

  it("truncates a single message to max_message_chars", () => {
    const buf = appendToSessionBuffer(
      createEmptySessionBuffer(),
      {
        role: "user",
        text: repeat("a", 10),
      },
      limits,
    );

    expect(buf.messages).toEqual([{ role: "user", text: "aaaa" }]);
  });

  it("folds old messages into running_summary when max_messages is exceeded", () => {
    let buf = createEmptySessionBuffer();
    buf = appendToSessionBuffer(buf, { role: "user", text: "1111" }, limits);
    buf = appendToSessionBuffer(buf, { role: "assistant", text: "2222" }, limits);
    buf = appendToSessionBuffer(buf, { role: "user", text: "3333" }, limits);
    buf = appendToSessionBuffer(buf, { role: "assistant", text: "4444" }, limits);

    expect(buf.messages.length).toBe(3);
    expect(buf.running_summary.length).toBeGreaterThan(0);
  });

  it("keeps running_summary + recent messages for session_summary input", () => {
    let buf = createEmptySessionBuffer();
    buf = appendToSessionBuffer(buf, { role: "user", text: "1111" }, limits);
    buf = appendToSessionBuffer(buf, { role: "assistant", text: "2222" }, limits);
    buf = appendToSessionBuffer(buf, { role: "user", text: "3333" }, limits);
    buf = appendToSessionBuffer(buf, { role: "assistant", text: "4444" }, limits);

    const messages = buildSessionSummaryMessages(buf, limits);
    expect(messages[0]?.role).toBe("assistant");
    expect(messages.length).toBeGreaterThan(0);
  });

  it("folds messages when max_total_chars is exceeded", () => {
    const tight: SessionBufferLimits = {
      ...limits,
      max_messages: 10,
      max_total_chars: 6,
      max_message_chars: 4,
      max_running_summary_chars: 50,
      fold_excerpt_chars: 3,
    };

    let buf = createEmptySessionBuffer();
    buf = appendToSessionBuffer(buf, { role: "user", text: "1111" }, tight);
    buf = appendToSessionBuffer(buf, { role: "assistant", text: "2222" }, tight);

    expect(buf.running_summary.length).toBeGreaterThan(0);
    expect(buf.messages.length).toBeLessThan(2);
    expect(buf.running_summary.length).toBeLessThanOrEqual(tight.max_running_summary_chars);
  });

  it("clamps running_summary to max_running_summary_chars", () => {
    const tight: SessionBufferLimits = {
      ...limits,
      max_messages: 0,
      max_total_chars: 2,
      max_message_chars: 400,
      max_running_summary_chars: 2,
      fold_excerpt_chars: 10,
    };

    const buf = appendToSessionBuffer(
      createEmptySessionBuffer(),
      { role: "user", text: "1111" },
      tight,
    );
    expect(buf.messages).toEqual([]);
    expect(buf.running_summary.length).toBeLessThanOrEqual(tight.max_running_summary_chars);
  });

  it("trims pre-existing running_summary when it exceeds max_running_summary_chars", () => {
    const tight: SessionBufferLimits = {
      ...limits,
      max_messages: 10,
      max_total_chars: 1_000,
      max_running_summary_chars: 2,
      max_message_chars: 10,
      fold_excerpt_chars: 10,
    };

    const buf = appendToSessionBuffer(
      { running_summary: "abcdef", messages: [] },
      { role: "user", text: "x" },
      tight,
    );

    expect(buf.running_summary).toBe("ef");
    expect(buf.messages).toEqual([{ role: "user", text: "x" }]);
  });

  it("clamps a message to empty when max_message_chars is 0", () => {
    const zero: SessionBufferLimits = {
      ...limits,
      max_messages: 10,
      max_message_chars: 0,
      max_total_chars: 100,
      max_running_summary_chars: 50,
      fold_excerpt_chars: 3,
    };

    const buf = appendToSessionBuffer(
      createEmptySessionBuffer(),
      { role: "user", text: "hello" },
      zero,
    );
    expect(buf.messages).toEqual([{ role: "user", text: "" }]);
  });

  it("clamps running_summary to max_running_summary_chars when folding", () => {
    const tight: SessionBufferLimits = {
      ...limits,
      max_messages: 0,
      max_message_chars: 400,
      max_total_chars: 100,
      max_running_summary_chars: 1,
      fold_excerpt_chars: 10,
    };

    const buf = appendToSessionBuffer(
      createEmptySessionBuffer(),
      { role: "user", text: "1111" },
      tight,
    );
    expect(buf.messages).toEqual([]);
    expect(buf.running_summary).toBe("1");
  });
});
