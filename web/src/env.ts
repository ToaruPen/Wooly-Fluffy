type ViteIntOptions = {
  name: string;
  defaultValue: number;
  min?: number;
  max?: number;
};

type ViteBoolOptions = {
  name: string;
  defaultValue: boolean;
};

const clamp = (value: number, min?: number, max?: number): number => {
  let out = value;
  if (typeof min === "number" && out < min) {
    out = min;
  }
  if (typeof max === "number" && out > max) {
    out = max;
  }
  return out;
};

const getEnvRecord = (): Record<string, unknown> =>
  import.meta.env as unknown as Record<string, unknown>;

export const readViteInt = (options: ViteIntOptions): number => {
  const raw = getEnvRecord()[options.name];
  if (typeof raw !== "string") {
    return clamp(options.defaultValue, options.min, options.max);
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return clamp(options.defaultValue, options.min, options.max);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return clamp(options.defaultValue, options.min, options.max);
  }
  return clamp(parsed, options.min, options.max);
};

export const readViteBool = (options: ViteBoolOptions): boolean => {
  const raw = getEnvRecord()[options.name];
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return options.defaultValue;
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return options.defaultValue;
  }
  if (trimmed === "1" || trimmed === "true") {
    return true;
  }
  if (trimmed === "0" || trimmed === "false") {
    return false;
  }
  return options.defaultValue;
};
