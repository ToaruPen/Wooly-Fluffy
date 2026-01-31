import { describe, expect, it } from "vitest";
import { isLanAddress } from "./access-control.js";

describe("access-control", () => {
  describe("isLanAddress", () => {
    it("returns true for IPv4 private ranges and loopback", () => {
      expect(isLanAddress("10.0.0.1")).toBe(true);
      expect(isLanAddress("172.16.0.1")).toBe(true);
      expect(isLanAddress("192.168.0.1")).toBe(true);
      expect(isLanAddress("127.0.0.1")).toBe(true);
    });

    it("returns true for IPv6 loopback, ULA, and link-local", () => {
      expect(isLanAddress("::1")).toBe(true);
      expect(isLanAddress("fc00::1")).toBe(true);
      expect(isLanAddress("fd00::1")).toBe(true);
      expect(isLanAddress("fe80::1")).toBe(true);
    });

    it("returns true for IPv6-mapped IPv4", () => {
      expect(isLanAddress("::ffff:192.168.1.10")).toBe(true);
      expect(isLanAddress("::ffff:127.0.0.1")).toBe(true);
    });

    it("handles normalization and invalid input defensively", () => {
      expect(isLanAddress("   ")).toBe(false);
      expect(isLanAddress("[::1]")).toBe(true);
      expect(isLanAddress("fe80::1%lo0")).toBe(true);
      expect(isLanAddress("::2")).toBe(false);
      expect(isLanAddress("::ffff:10.0.0")).toBe(false);
      expect(isLanAddress("::ffff:10.0.0.x")).toBe(false);
      expect(isLanAddress("999.0.0.1")).toBe(false);
      expect(isLanAddress("::ffff:999.0.0.1")).toBe(false);
      expect(isLanAddress("not-an-ip")).toBe(false);
    });

    it("returns false for public addresses", () => {
      expect(isLanAddress("8.8.8.8")).toBe(false);
      expect(isLanAddress("1.1.1.1")).toBe(false);
      expect(isLanAddress("2001:4860:4860::8888")).toBe(false);
    });
  });
});
