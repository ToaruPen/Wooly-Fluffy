import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      all: true,
      include: ["src/**/!(*.test).ts"],
      exclude: ["src/main.ts"],
    },
  },
});
