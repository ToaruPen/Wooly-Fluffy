import { readViteInt } from "./env";

const getFetchTimeoutMs = (): number =>
  readViteInt({
    name: "VITE_FETCH_TIMEOUT_MS",
    defaultValue: 0,
    min: 0,
    max: 120_000,
  });

const fetchWithOptionalTimeout = (
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    credentials?: RequestCredentials;
  },
  timeoutMsOverride: number | null,
) => {
  const envTimeoutMs = getFetchTimeoutMs();
  const timeoutMs = timeoutMsOverride ?? envTimeoutMs;
  if (timeoutMs <= 0) {
    return fetch(path, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(path, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
};

export const getJson = (path: string) =>
  fetchWithOptionalTimeout(
    path,
    {
      method: "GET",
      headers: {
        accept: "application/json",
      },
      credentials: "include",
    },
    null,
  );

export const postJson = (path: string, body: unknown) =>
  fetchWithOptionalTimeout(
    path,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      credentials: "include",
    },
    null,
  );

export const postJsonWithTimeout = (path: string, body: unknown, timeoutMs: number) =>
  fetchWithOptionalTimeout(
    path,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      credentials: "include",
    },
    timeoutMs,
  );

export const postFormData = (path: string, body: FormData) =>
  fetchWithOptionalTimeout(
    path,
    {
      method: "POST",
      headers: {
        accept: "application/json",
      },
      body,
      credentials: "include",
    },
    null,
  );

export const postEmpty = (path: string) =>
  fetchWithOptionalTimeout(
    path,
    {
      method: "POST",
      headers: {
        accept: "application/json",
      },
      credentials: "include",
    },
    null,
  );

export const readJson = async <T>(res: Response): Promise<T> => {
  const timeoutMs = getFetchTimeoutMs();
  if (timeoutMs <= 0) {
    const json = (await res.json()) as unknown;
    return json as T;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const json = (await Promise.race([
      res.json(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("fetch_timeout")), timeoutMs);
      }),
    ])) as unknown;
    return json as T;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};
