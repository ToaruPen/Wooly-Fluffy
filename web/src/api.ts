export const getJson = (path: string) =>
  fetch(path, {
    method: "GET",
    headers: {
      accept: "application/json"
    },
    credentials: "include"
  });

export const postJson = (path: string, body: unknown) =>
  fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(body),
    credentials: "include"
  });

export const postEmpty = (path: string) =>
  fetch(path, {
    method: "POST",
    headers: {
      accept: "application/json"
    },
    credentials: "include"
  });

export const readJson = async <T>(res: Response): Promise<T> => {
  const json = (await res.json()) as unknown;
  return json as T;
};
