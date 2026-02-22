import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nodeFileSystemAdapter } from "./file-system.js";

describe("file-system adapter", () => {
  it("reads text from existing file", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const filePath = join(currentDir, "file-system.ts");

    const text = nodeFileSystemAdapter.readTextFileSync(filePath);

    expect(text).toContain("nodeFileSystemAdapter");
  });

  it("returns stat shape for existing file", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const filePath = join(currentDir, "file-system.ts");

    const stat = nodeFileSystemAdapter.statFileSync(filePath);

    expect(stat.isFile).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
    expect(stat.mtimeMs).toBeGreaterThan(0);
  });
});
