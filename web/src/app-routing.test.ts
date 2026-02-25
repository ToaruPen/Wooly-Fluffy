import { afterEach, describe, expect, it, vi } from "vitest";

const resetDom = () => {
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
};

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  resetDom();
});

describe("getPage", () => {
  it("returns debug when isDev=true and pathname=/debug", async () => {
    vi.resetModules();
    const { getPage } = await import("./app");
    expect(getPage("/debug", true)).toBe("debug");
    expect(getPage("/debug/extra", true)).toBe("debug");
    expect(getPage("/debugger", true)).toBe("kiosk");
  });

  it("falls back to kiosk when isDev=false and pathname=/debug", async () => {
    vi.resetModules();
    const { getPage } = await import("./app");
    expect(getPage("/debug", false)).toBe("kiosk");
  });

  it("returns staff for /staff paths regardless of isDev", async () => {
    vi.resetModules();
    const { getPage } = await import("./app");
    expect(getPage("/staff", true)).toBe("staff");
    expect(getPage("/staff", false)).toBe("staff");
    expect(getPage("/staff/extra", true)).toBe("staff");
  });

  it("returns kiosk for other paths", async () => {
    vi.resetModules();
    const { getPage } = await import("./app");
    expect(getPage("/kiosk", true)).toBe("kiosk");
    expect(getPage("/kiosk", false)).toBe("kiosk");
    expect(getPage("/", true)).toBe("kiosk");
    expect(getPage("/anything", false)).toBe("kiosk");
  });
});

describe("app dev gating", () => {
  it("evaluates app module with DEV=false without enabling /debug", async () => {
    vi.resetModules();

    const isDevOriginal = import.meta.env.DEV;
    import.meta.env.DEV = false;
    try {
      const { getPage } = await import("./app");
      expect(getPage("/debug", import.meta.env.DEV)).toBe("kiosk");
    } finally {
      import.meta.env.DEV = isDevOriginal;
    }
  });
});
