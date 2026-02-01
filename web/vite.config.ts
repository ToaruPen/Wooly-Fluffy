import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000"
    }
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      },
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/vite-env.d.ts"]
    }
  }
});
