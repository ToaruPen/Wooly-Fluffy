import { execFileSync } from "node:child_process";
import process from "node:process";

const execGit = (args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const gitHasRef = (ref) => {
  try {
    execGit(["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
};

const resolveDiffBaseRef = () => {
  const baseRefName = (process.env.GITHUB_BASE_REF || "").trim() || "main";

  const candidates = [`origin/${baseRefName}`, baseRefName, "origin/main", "main"];

  const found = candidates.find((ref) => gitHasRef(ref));
  if (!found) {
    throw new Error(`No base ref found. Tried: ${candidates.join(", ")}`);
  }
  return found;
};

export const getChangedFiles = ({ baseRef } = {}) => {
  const base = baseRef || resolveDiffBaseRef();
  const mergeBase = execGit(["merge-base", "HEAD", base]);

  const collect = (out, set) => {
    if (!out) return;
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) set.add(trimmed);
    }
  };

  const files = new Set();

  // 1) Changes introduced on this branch (commit-level diff)
  collect(execGit(["diff", "--name-only", "--diff-filter=ACMRT", `${mergeBase}...HEAD`]), files);

  // 2) Unstaged/staged/untracked changes (local dev)
  collect(execGit(["diff", "--name-only", "--diff-filter=ACMRT"]), files);
  collect(execGit(["diff", "--name-only", "--diff-filter=ACMRT", "--cached"]), files);
  collect(execGit(["ls-files", "--others", "--exclude-standard"]), files);

  return Array.from(files);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = getChangedFiles();
  process.stdout.write(files.join("\n"));
  if (files.length) {
    process.stdout.write("\n");
  }
}
