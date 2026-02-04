import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { VrmAvatar } from "./VrmAvatar";

describe("VrmAvatar", () => {
  it("shows fallback in jsdom without WebGL", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<VrmAvatar vrmUrl="/assets/vrm/mascot.vrm" expression="neutral" mouthOpen={0} />);
    });

    const fallback = container.querySelector('[data-testid="mascot-stage-fallback"]');
    expect(fallback).toBeTruthy();

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });
});
