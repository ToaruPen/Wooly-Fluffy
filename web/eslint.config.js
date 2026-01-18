import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**"]
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks
    },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "fs",
              message: "Do not use fs directly (persistence/logs must not write to disk)."
            },
            {
              name: "node:fs",
              message: "Do not use fs directly (persistence/logs must not write to disk)."
            },
            {
              name: "fs/promises",
              message: "Do not use fs directly (persistence/logs must not write to disk)."
            },
            {
              name: "node:fs/promises",
              message: "Do not use fs directly (persistence/logs must not write to disk)."
            }
          ]
        }
      ]
    }
  }
];
