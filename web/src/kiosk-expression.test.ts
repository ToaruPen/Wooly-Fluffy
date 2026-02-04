import { describe, expect, it } from "vitest";
import { parseExpressionLabel } from "./kiosk-expression";

describe("parseExpressionLabel", () => {
  it("accepts known labels", () => {
    expect(parseExpressionLabel("neutral")).toBe("neutral");
    expect(parseExpressionLabel("happy")).toBe("happy");
    expect(parseExpressionLabel("sad")).toBe("sad");
    expect(parseExpressionLabel("surprised")).toBe("surprised");
  });

  it("falls back to neutral for invalid values", () => {
    expect(parseExpressionLabel(undefined)).toBe("neutral");
    expect(parseExpressionLabel(null)).toBe("neutral");
    expect(parseExpressionLabel(123)).toBe("neutral");
    expect(parseExpressionLabel("angry")).toBe("neutral");
    expect(parseExpressionLabel({})).toBe("neutral");
  });
});
