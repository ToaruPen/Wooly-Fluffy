// eslint-disable-next-line no-restricted-imports
import { createReadStream as nodeCreateReadStream, readFileSync, statSync } from "node:fs";

export type FileSystemStat = {
  isFile: boolean;
  size: number;
  mtimeMs: number;
};

export type FileSystemAdapter = {
  readTextFileSync: (filePath: string) => string;
  statFileSync: (filePath: string) => FileSystemStat;
};

export const nodeFileSystemAdapter: FileSystemAdapter = {
  readTextFileSync: (filePath) => readFileSync(filePath, "utf8"),
  statFileSync: (filePath) => {
    const stat = statSync(filePath);
    return {
      isFile: stat.isFile(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  },
};

export { nodeCreateReadStream };

// --- fs boundary for preflight (lazy-loaded) ---

export const nodeFsAccess = async (path: string, mode: number): Promise<void> => {
  const fsPromises = await import("node:fs/promises");
  await fsPromises.access(path, mode);
};

export type FsConstants = { X_OK: number; R_OK: number };

export const nodeFsConstants = async (): Promise<FsConstants> => {
  const fs = await import("node:fs");
  return fs.constants;
};
