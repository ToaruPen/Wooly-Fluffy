type EnvIntOptions = {
  name: string;
  defaultValue: number;
  min?: number;
  max?: number;
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

export const readEnvInt = (
  env: Record<string, string | undefined>,
  options: EnvIntOptions,
): number => {
  const raw = env[options.name];
  if (raw === undefined) {
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
