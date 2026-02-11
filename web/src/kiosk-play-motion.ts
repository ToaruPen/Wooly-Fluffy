export type MotionId = "idle" | "greeting" | "cheer" | "thinking";

export type PlayMotionCommand = {
  motionId: MotionId;
  motionInstanceId: string;
};

const motionIdAllowlist: Record<MotionId, true> = {
  idle: true,
  greeting: true,
  cheer: true,
  thinking: true,
};

const isMotionId = (value: string): value is MotionId => {
  return Object.hasOwn(motionIdAllowlist, value);
};

export const parseKioskPlayMotionData = (value: unknown): PlayMotionCommand | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const motionId = record.motion_id;
  const motionInstanceId = record.motion_instance_id;
  if (typeof motionId !== "string" || typeof motionInstanceId !== "string") {
    return null;
  }
  if (!isMotionId(motionId)) {
    return null;
  }
  return { motionId, motionInstanceId };
};
