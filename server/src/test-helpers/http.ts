import { request } from "http";
import type { IncomingHttpHeaders } from "http";

/**
 * Create HTTP test helpers bound to a dynamic port accessor.
 *
 * The `getPort` callback is invoked on each request so the caller can
 * update the port between tests (e.g. in `beforeEach`).
 */
export const createHttpTestHelpers = (getPort: () => number) => {
  let staffCookie = "";

  const sendRequest = (
    method: string,
    path: string,
    options?: { headers?: Record<string, string>; body?: string | Buffer },
  ) =>
    new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>(
      (resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: getPort(), method, path }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
          });
        });

        req.on("error", reject);
        if (options?.headers) {
          for (const [key, value] of Object.entries(options.headers)) {
            req.setHeader(key, value);
          }
        }
        if (options?.body) {
          req.write(options.body);
        }
        req.end();
      },
    );

  const sendRequestBuffer = (
    method: string,
    path: string,
    options?: { headers?: Record<string, string>; body?: string | Buffer },
  ) =>
    new Promise<{ status: number; body: Buffer; headers: IncomingHttpHeaders }>(
      (resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: getPort(), method, path }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => {
            chunks.push(chunk as Buffer);
          });
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks),
              headers: res.headers,
            });
          });
        });

        req.on("error", reject);
        if (options?.headers) {
          for (const [key, value] of Object.entries(options.headers)) {
            req.setHeader(key, value);
          }
        }
        if (options?.body) {
          req.write(options.body);
        }
        req.end();
      },
    );

  const cookieFromSetCookie = (setCookie: string): string => {
    const [first] = setCookie.split(";", 1);
    if (!first) {
      throw new Error("missing_set_cookie");
    }
    return first;
  };

  const loginStaff = async (): Promise<string> => {
    const response = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "test-pass" }),
    });
    if (response.status !== 200) {
      throw new Error(`staff_login_failed:${response.status}`);
    }
    const setCookie = response.headers["set-cookie"];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    staffCookie = cookieFromSetCookie(String(first ?? ""));
    return staffCookie;
  };

  const withStaffCookie = (headers?: Record<string, string>): Record<string, string> => ({
    ...(headers ?? {}),
    cookie: staffCookie,
  });

  const resetStaffCookie = () => {
    staffCookie = "";
  };

  return {
    sendRequest,
    sendRequestBuffer,
    cookieFromSetCookie,
    loginStaff,
    withStaffCookie,
    resetStaffCookie,
  };
};
