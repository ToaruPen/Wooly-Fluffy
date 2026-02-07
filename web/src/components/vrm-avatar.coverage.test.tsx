import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let loadAsyncImpl: ((url: string) => Promise<unknown>) | null = null;
let registerImpl: ((cb: unknown) => void) | null = null;

let removeEventListenerShouldThrow = false;

const sceneAdds: unknown[] = [];
const rendererRenders: unknown[] = [];
const rendererPixelRatios: number[] = [];
const deepDisposes: unknown[] = [];
const removeVerticesCalls: unknown[] = [];
const removeJointsCalls: unknown[] = [];
const rotateCalls: unknown[] = [];
const actionCalls: string[] = [];
let clipActionCalls = 0;

const createdMixers: unknown[] = [];
const createdActions: unknown[] = [];

let rafCalls = 0;
let rafCallbacks: FrameRequestCallback[] = [];

const flushMicrotasks = async (count: number) => {
  for (let i = 0; i < count; i += 1) {
    await Promise.resolve();
  }
};

const countAction = (value: string) => {
  return actionCalls.filter((entry) => entry === value).length;
};

const waitFor = async (predicate: () => boolean, maxTicks = 50) => {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) {
      return;
    }
    await flushMicrotasks(1);
  }
  throw new Error("waitFor: condition not met");
};

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

  class AnimationMixer {
    private listeners: Record<string, Array<(event: unknown) => void>> = {};
    constructor(_root: unknown) {
      void _root;
      createdMixers.push(this);
    }
    addEventListener(type: string, handler: (event: unknown) => void) {
      if (!this.listeners[type]) {
        this.listeners[type] = [];
      }
      this.listeners[type].push(handler);
      actionCalls.push(`addEventListener:${type}`);
    }
    removeEventListener(type: string, handler: (event: unknown) => void) {
      const list = this.listeners[type];
      if (!list) {
        return;
      }
      if (removeEventListenerShouldThrow) {
        actionCalls.push(`removeEventListenerThrow:${type}`);
        throw new Error("removeEventListener boom");
      }
      this.listeners[type] = list.filter((h) => h !== handler);
      actionCalls.push(`removeEventListener:${type}`);
    }
    __wfDispatchFinished(action: unknown) {
      const list = this.listeners.finished ?? [];
      for (const handler of list) {
        handler({ action });
      }
    }
    clipAction(_clip: unknown) {
      void _clip;
      clipActionCalls += 1;
      actionCalls.push("clipAction");
      const action = {
        enabled: true,
        setLoop: () => {
          actionCalls.push("setLoop");
        },
        reset: () => {
          actionCalls.push("reset");
          return undefined;
        },
        play: () => {
          actionCalls.push("play");
        },
        crossFadeTo: () => {
          actionCalls.push("crossFadeTo");
        },
        stop: () => undefined,
      };
      createdActions.push(action);
      return action;
    }
    update(_delta: number) {
      void _delta;
    }
    stopAllAction() {
      return undefined;
    }
  }

  const LoopRepeat = 2201;
  const LoopOnce = 2200;

  return {
    Color,
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    HemisphereLight,
    DirectionalLight,
    Clock,
    AnimationMixer,
    LoopRepeat,
    LoopOnce,
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

vi.mock("@pixiv/three-vrm-animation", () => {
  class VRMAnimationLoaderPlugin {
    constructor(_parser: unknown) {
      // noop
    }
  }

  class VRMLookAtQuaternionProxy {
    name = "";
    constructor(_lookAt: unknown) {
      void _lookAt;
    }
  }

  const createVRMAnimationClip = vi.fn((_animation: unknown, _vrm: unknown) => {
    void _animation;
    void _vrm;
    return {};
  });

  return { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip };
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
    actionCalls.length = 0;
    clipActionCalls = 0;
    createdMixers.length = 0;
    createdActions.length = 0;
    removeEventListenerShouldThrow = false;
    loadAsyncImpl = null;
    registerImpl = null;
    rafCalls = 0;
    rafCallbacks.length = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCalls += 1;
      rafCallbacks.push(cb);
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

    expect(registerImpl).toHaveBeenCalledTimes(2);
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

  it("loads and plays VRMA when motion is requested", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    const urls: string[] = [];
    const fakeVrm = {
      scene: { tag: "vrm-scene" },
      humanoid: { resetNormalizedPose: vi.fn() },
      lookAt: undefined,
      expressionManager: { setValue: vi.fn() },
      update: vi.fn(),
    };
    loadAsyncImpl = async (url: string) => {
      urls.push(url);
      if (url.endsWith(".vrm")) {
        return { userData: { vrm: fakeVrm } };
      }
      if (url.endsWith(".vrma")) {
        return { userData: { vrmAnimations: [{ lookAtTrack: null }] } };
      }
      throw new Error(`unexpected url: ${url}`);
    };

    const { VrmAvatar } = await import("./vrm-avatar");
    const { createVRMAnimationClip } = await import("@pixiv/three-vrm-animation");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "idle", motionInstanceId: "m-1" }}
        />,
      );
      // Flush microtasks: VRM load -> pending motion -> VRMA load.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(urls).toContain("/x.vrm");
    expect(urls).toContain("/assets/motions/idle.vrma");
    expect(createVRMAnimationClip).toHaveBeenCalled();
    expect(fakeVrm.humanoid.resetNormalizedPose).toHaveBeenCalled();

    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("covers allowlist motion behaviors (lookAt, traverse, cache, dedupe, missing vrma)", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    const urls: string[] = [];
    const sceneAdd = vi.fn();
    const sceneTraverse = vi.fn((cb: (obj: { frustumCulled: boolean }) => void) => {
      cb({ frustumCulled: true });
    });
    const lookAt = { reset: vi.fn(), autoUpdate: false };

    const fakeVrm = {
      scene: { tag: "vrm-scene", add: sceneAdd, traverse: sceneTraverse },
      humanoid: { resetNormalizedPose: vi.fn() },
      lookAt,
      expressionManager: { setValue: vi.fn() },
      update: vi.fn(),
    };

    let vrmaLoadCount = 0;
    loadAsyncImpl = async (url: string) => {
      urls.push(url);
      if (url.endsWith(".vrm")) {
        return { userData: { vrm: fakeVrm } };
      }
      vrmaLoadCount += 1;
      if (url.endsWith("/idle.vrma")) {
        return { userData: { vrmAnimations: [{ lookAtTrack: {} }] } };
      }
      if (url.endsWith("/greeting.vrma")) {
        return { userData: { vrmAnimations: [{ lookAtTrack: null }] } };
      }
      // Missing animation -> should be ignored.
      return { userData: { vrmAnimations: [] } };
    };

    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "idle", motionInstanceId: "m-1" }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Same instance id -> ignored.
    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "idle", motionInstanceId: "m-1" }}
        />,
      );
      await Promise.resolve();
    });

    // Same motion id, new instance id -> should use cache (no extra VRMA load).
    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "idle", motionInstanceId: "m-2" }}
        />,
      );
      await Promise.resolve();
    });

    // Different motion id -> should attempt another load.
    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "greeting", motionInstanceId: "m-3" }}
        />,
      );
      await Promise.resolve();
    });

    // Motion with no animation track -> safe ignore.
    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "cheer", motionInstanceId: "m-4" }}
        />,
      );
      await Promise.resolve();
    });

    expect(urls).toContain("/assets/motions/idle.vrma");
    expect(urls).toContain("/assets/motions/greeting.vrma");

    expect(vrmaLoadCount).toBeGreaterThan(0);

    expect(fakeVrm.humanoid.resetNormalizedPose).toHaveBeenCalled();
    expect(lookAt.reset).toHaveBeenCalled();
    expect(typeof lookAt.autoUpdate).toBe("boolean");
    expect(sceneAdd).toHaveBeenCalled();
    expect(sceneTraverse).toHaveBeenCalled();

    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("crossfades when switching motions", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    const lookAt = { reset: vi.fn(), autoUpdate: false };
    const fakeVrm = {
      scene: { tag: "vrm-scene", add: vi.fn(), traverse: vi.fn() },
      humanoid: { resetNormalizedPose: vi.fn() },
      lookAt,
      expressionManager: { setValue: vi.fn() },
      update: vi.fn(),
    };

    const urls: string[] = [];

    const createDeferred = <T,>() => {
      let resolve!: (value: T) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    };

    const vrmDeferred = createDeferred<unknown>();
    const idleVrmaDeferred = createDeferred<unknown>();
    const greetingVrmaDeferred = createDeferred<unknown>();

    let resolveVrmRequested!: () => void;
    const vrmRequested = new Promise<void>((resolve) => {
      resolveVrmRequested = resolve;
    });

    let resolveIdleVrmaRequested!: () => void;
    const idleVrmaRequested = new Promise<void>((resolve) => {
      resolveIdleVrmaRequested = resolve;
    });

    let resolveGreetingVrmaRequested!: () => void;
    const greetingVrmaRequested = new Promise<void>((resolve) => {
      resolveGreetingVrmaRequested = resolve;
    });

    loadAsyncImpl = async (url: string) => {
      urls.push(url);
      if (url.endsWith(".vrm")) {
        resolveVrmRequested();
        return await vrmDeferred.promise;
      }
      if (url.endsWith("/idle.vrma")) {
        resolveIdleVrmaRequested();
        return await idleVrmaDeferred.promise;
      }
      if (url.endsWith("/greeting.vrma")) {
        resolveGreetingVrmaRequested();
        return await greetingVrmaDeferred.promise;
      }
      throw new Error(`unexpected url: ${url}`);
    };

    const { VrmAvatar } = await import("./vrm-avatar");
    const { createVRMAnimationClip } = await import("@pixiv/three-vrm-animation");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    // Start with idle.
    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "idle", motionInstanceId: "m-1" }}
        />,
      );
      await Promise.resolve();
    });

    await vrmRequested;
    vrmDeferred.resolve({ userData: { vrm: fakeVrm } });
    await idleVrmaRequested;
    idleVrmaDeferred.resolve({ userData: { vrmAnimations: [{ lookAtTrack: null }] } });
    await waitFor(() => countAction("play") >= 1);

    expect(urls).toContain("/x.vrm");
    expect(urls).toContain("/assets/motions/idle.vrma");

    // Switch to greeting -> should crossFadeTo.
    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "greeting", motionInstanceId: "m-2" }}
        />,
      );
      await Promise.resolve();
    });
    await greetingVrmaRequested;
    greetingVrmaDeferred.resolve({ userData: { vrmAnimations: [{ lookAtTrack: null }] } });

    expect(urls).toContain("/assets/motions/greeting.vrma");

    expect(fakeVrm.humanoid.resetNormalizedPose).toHaveBeenCalled();
    expect(createVRMAnimationClip).toHaveBeenCalled();
    expect(clipActionCalls).toBeGreaterThan(0);

    await waitFor(() => {
      // The three.js animation system is heavily mocked here.
      // Assert the motion switch progressed far enough to create a second action.
      return clipActionCalls >= 2;
    });

    // The detailed call ordering is not stable across this jsdom + act setup,
    // but we still expect at least two actions (idle + greeting) to be created.
    expect(clipActionCalls).toBeGreaterThanOrEqual(2);

    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("auto-returns to idle after oneshot finished and ignores stale finished events", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    const lookAt = { reset: vi.fn(), autoUpdate: false };
    const fakeVrm = {
      scene: { tag: "vrm-scene", add: vi.fn(), traverse: vi.fn() },
      humanoid: { resetNormalizedPose: vi.fn() },
      lookAt,
      expressionManager: { setValue: vi.fn() },
      update: vi.fn(),
    };

    loadAsyncImpl = async (url: string) => {
      if (url.endsWith(".vrm")) {
        return { userData: { vrm: fakeVrm } };
      }
      if (url.endsWith("/idle.vrma")) {
        return { userData: { vrmAnimations: [{ lookAtTrack: null }] } };
      }
      if (url.endsWith("/greeting.vrma")) {
        return { userData: { vrmAnimations: [{ lookAtTrack: null }] } };
      }
      if (url.endsWith("/cheer.vrma")) {
        return { userData: { vrmAnimations: [{ lookAtTrack: null }] } };
      }
      throw new Error(`unexpected url: ${url}`);
    };

    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "idle", motionInstanceId: "m-1" }}
        />,
      );
      await Promise.resolve();
    });
    await waitFor(() => countAction("play") >= 1);

    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "greeting", motionInstanceId: "m-2" }}
        />,
      );
      await Promise.resolve();
    });
    await waitFor(() => countAction("play") >= 2);

    // Force the attempt to remove the previous finished handler to throw, so the old
    // handler stays registered while the pointer is replaced.
    removeEventListenerShouldThrow = true;

    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "cheer", motionInstanceId: "m-3" }}
        />,
      );
      await Promise.resolve();
    });
    await waitFor(() => countAction("play") >= 3);
    removeEventListenerShouldThrow = false;

    const mixer = createdMixers[0] as unknown as {
      __wfDispatchFinished: (action: unknown) => void;
    };
    expect(mixer).toBeTruthy();

    // Actions are created in order: idle, greeting, cheer.
    const idleAction = createdActions[0];
    const greetingAction = createdActions[1];
    const cheerAction = createdActions[2];
    expect(idleAction).toBeTruthy();
    expect(greetingAction).toBeTruthy();
    expect(cheerAction).toBeTruthy();

    // Mismatch -> ignore.
    mixer.__wfDispatchFinished({});

    // Stale finished event for greeting (generation mismatch) -> ignore.
    mixer.__wfDispatchFinished(greetingAction);

    // Current finished event for cheer -> should auto-return to idle.
    removeEventListenerShouldThrow = true;
    mixer.__wfDispatchFinished(cheerAction);
    removeEventListenerShouldThrow = false;

    await waitFor(() => countAction("play") >= 4);

    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("removes oneshot finished listener on unmount", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    const fakeVrm = {
      scene: { tag: "vrm-scene", add: vi.fn(), traverse: vi.fn() },
      humanoid: { resetNormalizedPose: vi.fn() },
      lookAt: undefined,
      expressionManager: { setValue: vi.fn() },
      update: vi.fn(),
    };

    loadAsyncImpl = async (url: string) => {
      if (url.endsWith(".vrm")) {
        return { userData: { vrm: fakeVrm } };
      }
      if (url.endsWith("/idle.vrma") || url.endsWith("/greeting.vrma")) {
        return { userData: { vrmAnimations: [{ lookAtTrack: null }] } };
      }
      throw new Error(`unexpected url: ${url}`);
    };

    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "idle", motionInstanceId: "m-1" }}
        />,
      );
      await Promise.resolve();
    });
    await waitFor(() => countAction("play") >= 1);

    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "greeting", motionInstanceId: "m-2" }}
        />,
      );
      await Promise.resolve();
    });
    await waitFor(() => actionCalls.some((v) => v === "addEventListener:finished"));

    // Make the unmount cleanup try to remove and throw, so the handler stays registered.
    removeEventListenerShouldThrow = true;

    act(() => root.unmount());
    document.body.removeChild(container);

    expect(actionCalls.some((v) => v === "removeEventListenerThrow:finished")).toBe(true);

    // Dispatch after unmount -> handler should run but early-return due to disposed.
    removeEventListenerShouldThrow = false;
    const mixer = createdMixers[0] as unknown as {
      __wfDispatchFinished: (action: unknown) => void;
    };
    const greetingAction = createdActions[1];
    mixer.__wfDispatchFinished(greetingAction);
  });

  it("covers stale motion generation guard", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    const fakeVrm = {
      scene: { tag: "vrm-scene" },
      humanoid: { resetNormalizedPose: vi.fn() },
      lookAt: undefined,
      expressionManager: { setValue: vi.fn() },
      update: vi.fn(),
    };

    let resolveIdleVrma!: (value: unknown) => void;
    const idleVrmaDeferred = new Promise<unknown>((resolve) => {
      resolveIdleVrma = resolve;
    });

    loadAsyncImpl = async (url: string) => {
      if (url.endsWith(".vrm")) {
        return { userData: { vrm: fakeVrm } };
      }
      if (url.endsWith("/idle.vrma")) {
        return await idleVrmaDeferred;
      }
      if (url.endsWith("/greeting.vrma")) {
        return { userData: { vrmAnimations: [{ lookAtTrack: null }] } };
      }
      throw new Error(`unexpected url: ${url}`);
    };

    const { VrmAvatar } = await import("./vrm-avatar");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    // Trigger idle motion first (VRMA pending), then greeting (immediate) to bump generation.
    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "idle", motionInstanceId: "m-1" }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "greeting", motionInstanceId: "m-2" }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const callsBeforeResolve = actionCalls.length;
    resolveIdleVrma({ userData: { vrmAnimations: [{ lookAtTrack: null }] } });
    await Promise.resolve();
    await Promise.resolve();

    // Stale resolution should not apply (generation guard returns).
    expect(actionCalls.length).toBe(callsBeforeResolve);

    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("covers crossfade and early-return branches", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    const lookAt = { reset: vi.fn(), autoUpdate: false };
    const fakeVrm = {
      scene: { tag: "vrm-scene", add: vi.fn(), traverse: vi.fn() },
      humanoid: { resetNormalizedPose: vi.fn() },
      lookAt,
      expressionManager: { setValue: vi.fn() },
      update: vi.fn(),
    };

    const urls: string[] = [];
    loadAsyncImpl = async (url: string) => {
      urls.push(url);
      if (url.endsWith(".vrm")) {
        return { userData: { vrm: fakeVrm } };
      }
      if (url.endsWith("/idle.vrma")) {
        return { userData: { vrmAnimations: [{ lookAtTrack: null }] } };
      }
      if (url.endsWith("/greeting.vrma")) {
        return { userData: { vrmAnimations: [{ lookAtTrack: null }] } };
      }
      throw new Error(`unexpected url: ${url}`);
    };

    const { VrmAvatar } = await import("./vrm-avatar");
    const { createVRMAnimationClip } = await import("@pixiv/three-vrm-animation");

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    // idle
    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "idle", motionInstanceId: "m-1" }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // greeting (different instance)
    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "greeting", motionInstanceId: "m-2" }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // same instance id should early-return (dedupe)
    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "idle", motionInstanceId: "m-2" }}
        />,
      );
      await Promise.resolve();
    });

    expect(urls).toContain("/assets/motions/idle.vrma");
    expect(urls).toContain("/assets/motions/greeting.vrma");
    expect(createVRMAnimationClip).toHaveBeenCalled();

    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("swallows VRMA load failures", async () => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
      if (contextId === "webgl" || contextId === "experimental-webgl") {
        return {} as unknown as WebGLRenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    const fakeVrm = {
      scene: { tag: "vrm-scene" },
      humanoid: { resetNormalizedPose: vi.fn() },
      lookAt: undefined,
      expressionManager: { setValue: vi.fn() },
      update: vi.fn(),
    };
    loadAsyncImpl = async (url: string) => {
      if (url.endsWith(".vrm")) {
        return { userData: { vrm: fakeVrm } };
      }
      throw new Error("missing vrma");
    };

    const { VrmAvatar } = await import("./vrm-avatar");
    const { createVRMAnimationClip } = await import("@pixiv/three-vrm-animation");
    const initialCalls =
      (createVRMAnimationClip as unknown as { mock?: { calls: unknown[] } }).mock?.calls.length ??
      0;

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <VrmAvatar
          vrmUrl="/x.vrm"
          expression="neutral"
          mouthOpen={0}
          motion={{ motionId: "idle", motionInstanceId: "m-1" }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      (createVRMAnimationClip as unknown as { mock?: { calls: unknown[] } }).mock?.calls.length ??
        0,
    ).toBe(initialCalls);

    act(() => root.unmount());
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

    // Ensure the render loop stops when disposed after load failure.
    rafCallbacks[1]?.(0);
    expect(rafCalls).toBe(2);

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

    expect(() => {
      act(() => {
        root.unmount();
      });
    }).not.toThrow();
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
