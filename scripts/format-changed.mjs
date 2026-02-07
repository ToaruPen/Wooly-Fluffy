import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getChangedFiles } from "./changed-files.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const parseArgs = () => {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const mode = args.includes("--check") ? "check" : args.includes("--write") ? "write" : null;
  if (!mode) {
    throw new Error("Usage: node scripts/format-changed.mjs (--check|--write) [--all]");
  }
  return { mode, all };
};

const isFormattablePath = (p) => /\.(ts|tsx|js|jsx|json|yml|yaml|css|html|md)$/i.test(p);

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

const { mode, all } = parseArgs();

const targets = all
  ? ["."]
  : getChangedFiles().filter((p) => fs.existsSync(p) && isFormattablePath(p));

if (!all && targets.length === 0) {
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
