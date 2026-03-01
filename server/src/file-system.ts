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
