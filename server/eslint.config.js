import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "fs",
              message: "Do not use fs directly (persistence/logs must not write to disk).",
            },
            {
              name: "node:fs",
              message: "Do not use fs directly (persistence/logs must not write to disk).",
            },
            {
              name: "fs/promises",
              message: "Do not use fs directly (persistence/logs must not write to disk).",
            },
            {
              name: "node:fs/promises",
              message: "Do not use fs directly (persistence/logs must not write to disk).",
            },
          ],
        },
      ],
    },
  },
];
