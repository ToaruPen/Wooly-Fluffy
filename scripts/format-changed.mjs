import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getChangedFiles } from "./changed-files.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const parseMode = () => {
  const args = process.argv.slice(2);
  if (args.includes("--check")) return "check";
  if (args.includes("--write")) return "write";
  throw new Error("Usage: node scripts/format-changed.mjs (--check|--write)");
};

const isFormattablePath = (p) =>
  /\.(ts|tsx|js|jsx|json|yml|yaml|css|html|md)$/i.test(p);

const resolvePrettierBin = () => {
  const bin = path.join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prettier.cmd" : "prettier",
  );
  if (!fs.existsSync(bin)) {
    throw new Error("prettier binary not found. Run `npm install` first.");
  }
  return bin;
};

const mode = parseMode();
const changed = getChangedFiles();
const targets = changed.filter((p) => fs.existsSync(p) && isFormattablePath(p));

if (targets.length === 0) {
  process.stdout.write("No changed files to format.\n");
  process.exit(0);
}

const prettier = resolvePrettierBin();
const prettierArgs = [mode === "check" ? "--check" : "--write", ...targets];

const res = spawnSync(prettier, prettierArgs, {
  cwd: repoRoot,
  stdio: "inherit",
});
process.exit(res.status ?? 1);
