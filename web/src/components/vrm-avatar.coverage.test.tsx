import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let loadAsyncImpl: ((url: string) => Promise<unknown>) | null = null;
let registerImpl: ((cb: unknown) => void) | null = null;

const sceneAdds: unknown[] = [];
const rendererRenders: unknown[] = [];
const rendererPixelRatios: number[] = [];
const deepDisposes: unknown[] = [];
const removeVerticesCalls: unknown[] = [];
const removeJointsCalls: unknown[] = [];
const rotateCalls: unknown[] = [];

let rafCalls = 0;

vi.mock("three", () => {
  class Color {
    value: string;
    constructor(value: string) {
      this.value = value;
    }
  }

  class Scene {
    background: unknown = null;
    add(obj: unknown) {
      sceneAdds.push(obj);
    }
  }

  class PerspectiveCamera {
    aspect = 1;
    position = { set: (_x: number, _y: number, _z: number) => undefined };
    updateProjectionMatrix() {
      return undefined;
    }
  }

  class HemisphereLight {
    constructor(_a: number, _b: number, _c: number) {
      // noop
    }
  }

  class DirectionalLight {
    position = { set: (_x: number, _y: number, _z: number) => undefined };
    constructor(_a: number, _b: number) {
      // noop
    }
  }

  class Clock {
    getDelta() {
      return 0.016;
    }
  }

  class WebGLRenderer {
    domElement: HTMLCanvasElement;
    constructor(_opts: unknown) {
      this.domElement = document.createElement("canvas");
    }
    setPixelRatio(_ratio: number) {
      rendererPixelRatios.push(_ratio);
      return undefined;
    }
    setSize(_w: number, _h: number, shouldUpdateStyle: boolean) {
      void shouldUpdateStyle;
      return undefined;
    }
    render(scene: unknown, camera: unknown) {
      rendererRenders.push({ scene, camera });
    }
    dispose() {
      return undefined;
    }
  }

  return {
    Color,
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    HemisphereLight,
    DirectionalLight,
    Clock,
  };
});

vi.mock("three/addons/loaders/GLTFLoader.js", () => {
  class GLTFLoader {
    register(cb: unknown) {
      registerImpl?.(cb);
    }
    async loadAsync(url: string) {
      if (!loadAsyncImpl) {
        throw new Error("loadAsyncImpl not set");
      }
      return await loadAsyncImpl(url);
    }
  }
  return { GLTFLoader };
});

vi.mock("@pixiv/three-vrm", () => {
  class VRMLoaderPlugin {
    constructor(_parser: unknown) {
      // noop
    }
  }

  const VRMUtils = {
    removeUnnecessaryVertices: (scene: unknown) => {
      removeVerticesCalls.push(scene);
    },
    removeUnnecessaryJoints: (scene: unknown) => {
      removeJointsCalls.push(scene);
    },
    rotateVRM0: (vrm: unknown) => {
      rotateCalls.push(vrm);
    },
    deepDispose: (scene: unknown) => {
      deepDisposes.push(scene);
    },
  };

  return { VRMLoaderPlugin, VRMUtils };
});

describe("VrmAvatar (coverage)", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalDevicePixelRatio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");

  beforeEach(() => {
    sceneAdds.length = 0;
    rendererRenders.length = 0;
    rendererPixelRatios.length = 0;
    deepDisposes.length = 0;
    removeVerticesCalls.length = 0;
    removeJointsCalls.length = 0;
    rotateCalls.length = 0;
    loadAsyncImpl = null;
    registerImpl = null;
    rafCalls = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCalls += 1;
      if (rafCalls === 1) {
        cb(0);
      }
      return rafCalls;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    if (originalDevicePixelRatio) {
      Object.defineProperty(window, "devicePixelRatio", originalDevicePixelRatio);
    } else {
      delete (window as unknown as { devicePixelRatio?: unknown }).devicePixelRatio;
    }
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("exports helper functions and handles missing managers", async () => {
    HTMLCanvasElement.prototype.getContext = () => null;
    const mod = await import("./vrm-avatar");
    const { __test__ } = mod;

    const setValue = vi.fn();
    const vrmWithManager = {
      expressionManager: { setValue },
    };
    const vrmWithoutManager = {
      expressionManager: null,
    };

    __test__.resetExpressions(vrmWithoutManager as never);
    __test__.applyExpression(vrmWithoutManager as never, "happy");
    __test__.applyMouthOpen(vrmWithoutManager as never, 0.5);

    __test__.applyExpression(vrmWithManager as never, "neutral");
    __test__.applyExpression(vrmWithManager as never, "happy");
    __test__.applyMouthOpen(vrmWithManager as never, 2);

    HTMLCanvasElement.prototype.getContext = () => {
      throw new Error("boom");
    };
    expect(__test__.isWebGlAvailable()).toBe(false);

    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl") {
        return null;
      }
      if (contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;
    expect(__test__.isWebGlAvailable()).toBe(true);

    expect(setValue).toHaveBeenCalledWith("happy", 0);
    expect(setValue).toHaveBeenCalledWith("sad", 0);
    expect(setValue).toHaveBeenCalledWith("surprised", 0);
    expect(setValue).toHaveBeenCalledWith("happy", 1);
    expect(setValue).toHaveBeenCalledWith("aa", 1);
  });

  it("renders fallback when WebGL is not available", async () => {
    HTMLCanvasElement.prototype.getContext = () => null;
    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<VrmAvatar vrmUrl="/x.vrm" expression="neutral" mouthOpen={0} />);
    });

    expect(container.querySelector('[data-testid="mascot-stage-fallback"]')).toBeTruthy();

    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("renders fallback when vrmUrl is empty", async () => {
    HTMLCanvasElement.prototype.getContext = () => null;
    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<VrmAvatar vrmUrl="" expression="neutral" mouthOpen={0} />);
    });

    expect(container.textContent ?? "").toContain("VRM model is not configured");

    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("loads VRM, updates expressions in animation loop, and disposes on unmount", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    Object.defineProperty(window, "devicePixelRatio", { value: 3, configurable: true });

    registerImpl = vi.fn();

    const setValue = vi.fn();
    const fakeVrm = {
      scene: { tag: "vrm-scene" },
      expressionManager: { setValue },
      update: vi.fn(),
    };
    loadAsyncImpl = async (url: string) => {
      expect(url).toBe("/x.vrm");
      return { userData: { vrm: fakeVrm } };
    };

    type RafCb = (time: number) => void;
    const rafHolder: { cb: RafCb | null } = { cb: null };
    vi.stubGlobal("requestAnimationFrame", (cb: RafCb) => {
      rafHolder.cb = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<VrmAvatar vrmUrl="/x.vrm" expression="happy" mouthOpen={0.4} />);
      await Promise.resolve();
    });

    if (rafHolder.cb) {
      rafHolder.cb(0);
    }

    window.dispatchEvent(new Event("resize"));

    expect(registerImpl).toHaveBeenCalledTimes(1);
    expect(removeVerticesCalls.length).toBe(1);
    expect(removeJointsCalls.length).toBe(1);
    expect(rotateCalls.length).toBe(1);
    expect(sceneAdds).toContain(fakeVrm.scene);

    expect(rendererPixelRatios).toEqual([2]);

    // Expression + mouth updates happen in the animation loop.
    expect(setValue).toHaveBeenCalledWith("happy", 1);
    expect(setValue).toHaveBeenCalledWith("aa", 0.4);
    expect(fakeVrm.update).toHaveBeenCalled();
    expect(rendererRenders.length).toBeGreaterThan(0);

    act(() => root.unmount());
    expect(deepDisposes).toContain(fakeVrm.scene);
    document.body.removeChild(container);
  });

  it("shows fallback when VRM is missing from gltf.userData", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    Object.defineProperty(window, "devicePixelRatio", { value: undefined, configurable: true });

    loadAsyncImpl = async () => ({ userData: {} });
    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<VrmAvatar vrmUrl="/x.vrm" expression="neutral" mouthOpen={0} />);
      await Promise.resolve();
    });

    expect(rendererPixelRatios).toEqual([1]);

    expect(container.textContent ?? "").toContain("Failed to load VRM");

    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("shows fallback on loadAsync rejection and ignores fulfillment after unmount", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    let deferredResolve!: (value: unknown) => void;
    const deferred = new Promise<unknown>((resolve) => {
      deferredResolve = resolve;
    });

    let callCount = 0;
    loadAsyncImpl = async () => {
      callCount += 1;
      if (callCount === 1) {
        throw "boom";
      }
      return await deferred;
    };

    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<VrmAvatar vrmUrl="/x.vrm" expression="neutral" mouthOpen={0} />);
      await Promise.resolve();
    });

    expect(container.textContent ?? "").toContain("Failed to load VRM");

    act(() => root.unmount());

    // Resolve after unmount: disposed guard should prevent state updates.
    deferredResolve({
      userData: { vrm: { scene: {}, expressionManager: null, update: () => undefined } },
    });
    await Promise.resolve();

    document.body.removeChild(container);
  });

  it("shows fallback on loadAsync rejection with an Error", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    loadAsyncImpl = async () => {
      throw new Error("bad");
    };

    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<VrmAvatar vrmUrl="/x.vrm" expression="neutral" mouthOpen={0} />);
      await Promise.resolve();
    });

    expect(container.textContent ?? "").toContain("bad");

    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("swallows cleanup errors", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    const setValue = vi.fn();
    const fakeVrm = {
      scene: { tag: "vrm-scene" },
      expressionManager: { setValue },
      update: vi.fn(),
    };
    loadAsyncImpl = async () => ({ userData: { vrm: fakeVrm } });

    const three = await import("three");
    (three.WebGLRenderer as unknown as { prototype: { dispose: () => void } }).prototype.dispose =
      () => {
        throw new Error("dispose");
      };

    const vrm = await import("@pixiv/three-vrm");
    vrm.VRMUtils.deepDispose = () => {
      throw new Error("deepDispose");
    };

    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<VrmAvatar vrmUrl="/x.vrm" expression="happy" mouthOpen={0.2} />);
      await Promise.resolve();
    });

    const rendererCanvas = container.querySelector("canvas");
    expect(rendererCanvas).toBeTruthy();
    const stageElement = rendererCanvas?.parentElement as HTMLElement | null;
    expect(stageElement).toBeTruthy();
    const originalRemoveChild = stageElement!.removeChild.bind(stageElement);
    stageElement!.removeChild = ((node: Node) => {
      if (node === rendererCanvas) {
        throw new Error("removeChild");
      }
      return originalRemoveChild(node);
    }) as unknown as typeof originalRemoveChild;

    expect(() => root.unmount()).not.toThrow();
    document.body.removeChild(container);
  });

  it("ignores rejection after unmount", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    let deferredReject!: (reason?: unknown) => void;
    loadAsyncImpl = async () =>
      await new Promise<unknown>((_resolve, reject) => {
        deferredReject = reject;
      });

    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<VrmAvatar vrmUrl="/x.vrm" expression="neutral" mouthOpen={0} />);
    });
    act(() => root.unmount());

    deferredReject(new Error("late"));
    await Promise.resolve();

    document.body.removeChild(container);
  });

  it("ignores fulfillment after unmount", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    let deferredResolve!: (value: unknown) => void;
    loadAsyncImpl = async () =>
      await new Promise<unknown>((resolve) => {
        deferredResolve = resolve;
      });

    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<VrmAvatar vrmUrl="/x.vrm" expression="neutral" mouthOpen={0} />);
    });

    act(() => root.unmount());

    deferredResolve({
      userData: { vrm: { scene: {}, expressionManager: null, update: () => undefined } },
    });
    await Promise.resolve();

    document.body.removeChild(container);
  });
});
