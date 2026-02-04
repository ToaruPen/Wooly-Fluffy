import { describe, expect, it } from "vitest";
import { clamp01, computeRmsFromByteTimeDomainData, smoothValue } from "./AudioPlayer";

describe("AudioPlayer helpers", () => {
  it("clamp01 clamps range", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(2)).toBe(1);
  });

  it("computeRmsFromByteTimeDomainData returns 0 for silence", () => {
    const data = new Uint8Array(256).fill(128);
    expect(computeRmsFromByteTimeDomainData(data)).toBe(0);
  });

  it("computeRmsFromByteTimeDomainData returns 0 for empty", () => {
    expect(computeRmsFromByteTimeDomainData(new Uint8Array([]))).toBe(0);
  });

  it("computeRmsFromByteTimeDomainData returns >0 for signal", () => {
    const data = new Uint8Array([128, 255, 128, 1]);
    expect(computeRmsFromByteTimeDomainData(data)).toBeGreaterThan(0);
  });

  it("smoothValue applies attack when increasing", () => {
    expect(smoothValue(0, 1, 0.5, 0.1)).toBeCloseTo(0.5);
  });

  it("smoothValue applies release when decreasing", () => {
    expect(smoothValue(1, 0, 0.5, 0.1)).toBeCloseTo(0.9);
  });
});
