import type { IncomingMessage } from "http";
import { randomUUID } from "node:crypto";

const STAFF_SESSION_COOKIE_NAME = "wf_staff_session";

type StaffSession = {
  expires_at_ms: number;
};

type StaffSessionStore = {
  create: () => string;
  validate: (token: string) => boolean;
  keepalive: (token: string) => boolean;
};

const parseCookies = (cookieHeader: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key) {
      continue;
    }
    result[key] = value;
  }
  return result;
};

export const getStaffSessionToken = (req: IncomingMessage): string | null => {
  const cookieHeader = req.headers.cookie;
  const text = (typeof cookieHeader === "string" ? cookieHeader : "").trim();
  if (!text) {
    return null;
  }
  const cookies = parseCookies(text);
  const token = cookies[STAFF_SESSION_COOKIE_NAME];
  return token ? token : null;
};

export const createSessionCookie = (token: string, sessionTtlMs: number): string => {
  const maxAge = Math.floor(sessionTtlMs / 1000);
  return `${STAFF_SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
};

export const createStaffSessionStore = (input: {
  now_ms: () => number;
  session_ttl_ms: number;
  create_token?: () => string;
}): StaffSessionStore => {
  const sessions = new Map<string, StaffSession>();
  const createToken = input.create_token ?? randomUUID;

  const validate = (token: string): boolean => {
    const session = sessions.get(token);
    if (!session) {
      return false;
    }
    if (session.expires_at_ms <= input.now_ms()) {
      sessions.delete(token);
      return false;
    }
    return true;
  };

  const create = (): string => {
    const token = createToken();
    sessions.set(token, { expires_at_ms: input.now_ms() + input.session_ttl_ms });
    return token;
  };

  const keepalive = (token: string): boolean => {
    if (!validate(token)) {
      return false;
    }
    sessions.set(token, { expires_at_ms: input.now_ms() + input.session_ttl_ms });
    return true;
  };

  return {
    create,
    validate,
    keepalive,
  };
};
