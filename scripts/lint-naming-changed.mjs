import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getChangedFiles } from "./changed-files.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const isLintable = (p) => /\.(ts|tsx|js|jsx)$/i.test(p);

const runEslint = ({ workspace, configFile }) => {
  const wsDir = path.join(repoRoot, workspace);

  const changed = getChangedFiles();
  const files = changed
    .filter((p) => p.startsWith(`${workspace}/`))
    .filter((p) => fs.existsSync(p))
    .filter((p) => isLintable(p))
    .map((p) => p.slice(`${workspace}/`.length));

  if (files.length === 0) {
    process.stdout.write(`No changed files for naming check in ${workspace}/.\n`);
    return 0;
  }

  process.stdout.write(`ESLint naming check (${workspace}/): ${files.length} file(s)\n`);

  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(
    npmBin,
    ["exec", "-w", workspace, "--", "eslint", "--config", configFile, ...files],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );
  return res.status ?? 1;
};

try {
  const serverStatus = runEslint({
    workspace: "server",
    configFile: "eslint.naming.config.js",
  });
  if (serverStatus !== 0) process.exit(serverStatus);

  const webStatus = runEslint({
    workspace: "web",
    configFile: "eslint.naming.config.js",
  });
  process.exit(webStatus);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
