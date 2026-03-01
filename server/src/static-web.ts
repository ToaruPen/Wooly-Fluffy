// eslint-disable-next-line no-restricted-imports
import { createReadStream } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "http";

export type StaticWebResult = { handled: true } | { handled: false };

const SPA_PREFIXES = ["/kiosk", "/staff"];
const ASSETS_PREFIX = "/assets/";

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
};

export function tryServeStaticWeb(
  _req: IncomingMessage,
  res: ServerResponse,
  webDistPath: string,
  path: string,
): StaticWebResult {
  const resolvedWebDistPath = resolve(webDistPath);

  if (isSpaPath(path)) {
    const indexPath = resolve(resolvedWebDistPath, "index.html");
    /* v8 ignore next 4 — resolve(base, "index.html") never escapes base */
    if (!isSafePath(indexPath, resolvedWebDistPath)) {
      sendNotFound(res);
      return { handled: true };
    }
    serveFile(res, indexPath);
    return { handled: true };
  }

  if (!path.startsWith(ASSETS_PREFIX)) {
    return { handled: false };
  }

  const rawRelativeAssetPath = path.slice(1);
  const decodedRelativeAssetPath = decodePathSegment(rawRelativeAssetPath);
  if (!decodedRelativeAssetPath || hasTraversalSegment(decodedRelativeAssetPath)) {
    sendNotFound(res);
    return { handled: true };
  }

  const targetPath = resolve(resolvedWebDistPath, decodedRelativeAssetPath);
  /* v8 ignore next 4 — hasTraversalSegment already catches ".." before here */
  if (!isSafePath(targetPath, resolvedWebDistPath)) {
    sendNotFound(res);
    return { handled: true };
  }

  serveFile(res, targetPath);
  return { handled: true };
}

const isSpaPath = (path: string): boolean => {
  if (path === "/") {
    return true;
  }

  for (const prefix of SPA_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return true;
    }
  }

  return false;
};

const decodePathSegment = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const hasTraversalSegment = (relativePath: string): boolean => {
  return relativePath.split("/").includes("..");
};

const isSafePath = (targetPath: string, basePath: string): boolean => {
  return targetPath === basePath || targetPath.startsWith(`${basePath}${sep}`);
};

const serveFile = (res: ServerResponse, filePath: string) => {
  res.statusCode = 200;
  res.setHeader("content-type", getContentType(filePath));

  const stream = createReadStream(filePath);
  stream.on("error", () => {
    sendNotFound(res);
  });
  stream.pipe(res);
};

const getContentType = (filePath: string): string => {
  const extension = extname(filePath).toLowerCase();
  return MIME_BY_EXT[extension] ?? "application/octet-stream";
};

const sendNotFound = (res: ServerResponse) => {
  if (!res.headersSent) {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
  }
  if (!res.writableEnded) {
    res.end("Not Found");
  }
};
