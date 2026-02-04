import { describe, expect, it } from "vitest";

import { parseKioskToolCallsData } from "./kiosk-tool-calls";

describe("parseKioskToolCallsData", () => {
  it("returns tool calls when valid", () => {
    const parsed = parseKioskToolCallsData({
      tool_calls: [
        {
          id: "call-1",
          function: {
            name: "get_weather",
            arguments: '{"location":"Tokyo"}',
          },
        },
      ],
    });
    expect(parsed).toEqual([{ id: "call-1", function: { name: "get_weather" } }]);
    expect("arguments" in (parsed[0]?.function ?? {})).toBe(false);
  });

  it("filters malformed tool calls", () => {
    const parsed = parseKioskToolCallsData({
      tool_calls: [
        null,
        {},
        { id: 1, function: { name: "x" } },
        { id: "ok", function: null },
        { id: "ok2", function: { name: 2 } },
        { id: "ok3", function: { name: "get_weather" } },
      ],
    });
    expect(parsed).toEqual([{ id: "ok3", function: { name: "get_weather" } }]);
  });

  it("returns empty array when invalid", () => {
    expect(parseKioskToolCallsData(null)).toEqual([]);
    expect(parseKioskToolCallsData({})).toEqual([]);
    expect(parseKioskToolCallsData({ tool_calls: "nope" })).toEqual([]);
  });
});
