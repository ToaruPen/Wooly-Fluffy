import { describe, expect, it } from "vitest";

import { parseKioskPlayMotionData } from "./kiosk-play-motion";

describe("parseKioskPlayMotionData", () => {
  it("returns command when valid and allowlisted", () => {
    const parsed = parseKioskPlayMotionData({
      motion_id: "idle",
      motion_instance_id: "m-1",
    });
    expect(parsed).toEqual({ motionId: "idle", motionInstanceId: "m-1" });
  });

  it("returns null for non-allowlisted motion_id", () => {
    expect(parseKioskPlayMotionData({ motion_id: "dance", motion_instance_id: "m-1" })).toBeNull();
  });

  it("returns null when invalid", () => {
    expect(parseKioskPlayMotionData(null)).toBeNull();
    expect(parseKioskPlayMotionData({})).toBeNull();
    expect(parseKioskPlayMotionData({ motion_id: 1, motion_instance_id: "m-1" })).toBeNull();
    expect(parseKioskPlayMotionData({ motion_id: "idle", motion_instance_id: 1 })).toBeNull();
  });
});
