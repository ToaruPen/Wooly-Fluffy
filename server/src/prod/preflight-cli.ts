import { runPreflight } from "./preflight.js";

const result = await runPreflight();
if (!result.ok) {
  for (const error of result.errors) {
    process.stderr.write(`[preflight] ${error}\n`);
  }
  process.exit(1);
}
process.stderr.write("[preflight] all checks passed\n");
