// Shared Vitest setup for the web workspace.

// React 18: Vitest prints noisy warnings unless this flag is set.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom: HTMLCanvasElement.getContext is not implemented and emits warnings.
// Returning null matches the "no WebGL" path without changing runtime behavior.
if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
  });
}
