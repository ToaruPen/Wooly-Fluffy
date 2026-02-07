import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { getChangedFiles } from "./changed-files.mjs";

const parseAll = () => process.argv.slice(2).includes("--all");

const listAllFiles = () => {
  const res = spawnSync("git", ["ls-files"], {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error("git ls-files failed");
  }
  return String(res.stdout)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
};

const isIgnoredPath = (p) =>
  p.startsWith(".agent/") ||
  p.startsWith(".claude/") ||
  p.startsWith(".sisyphus/") ||
  p.startsWith("docs/") ||
  p.startsWith("skills/") ||
  p.startsWith("node_modules/") ||
  p.startsWith("dist/") ||
  p.startsWith("coverage/") ||
  p.startsWith("web/dist/") ||
  p.startsWith("web/coverage/") ||
  p.startsWith("server/dist/") ||
  p.startsWith("server/coverage/") ||
  p.startsWith("var/");

const shouldCheckExtension = (p) => /\.(ts|tsx|js|jsx|css|md|yml|yaml|json|html)$/i.test(p);

const isKebabSegment = (s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);

const isAllowedSpecialCase = (p) =>
  p === "AGENTS.md" ||
  p === "CLAUDE.md" ||
  p.endsWith("/AGENTS.md") ||
  p === ".github/pull_request_template.md" ||
  p === "README.md" ||
  (p.startsWith("docs/") && path.posix.basename(p).startsWith("_"));

const validateFileName = (p) => {
  const base = path.posix.basename(p);

  // Dotfiles are treated as special configuration files.
  if (base.startsWith(".")) {
    return true;
  }

  const parts = base.split(".");
  const stemParts = parts.length > 1 ? parts.slice(0, -1) : parts;
  const stem = stemParts.join(".");

  // Allow dot-separated kebab segments (e.g. http-server.test.ts, eslint.config.js).
  for (const seg of stem.split(".")) {
    if (!seg) return false;
    if (!isKebabSegment(seg)) return false;
  }
  return true;
};

const all = parseAll();
const changed = all ? listAllFiles() : getChangedFiles();
const targets = changed
  .filter((p) => fs.existsSync(p))
  .filter((p) => !isIgnoredPath(p))
  .filter((p) => shouldCheckExtension(p))
  .filter((p) => !isAllowedSpecialCase(p));

const violations = targets.filter((p) => !validateFileName(p));

if (violations.length) {
  process.stderr.write("Invalid file names (expected kebab-case segments):\n");
  for (const v of violations) {
    process.stderr.write(`- ${v}\n`);
  }
  process.exit(1);
}

process.stdout.write(`Filename check passed (${all ? "all files" : "changed files"}).\n`);
