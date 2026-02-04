import path from "node:path";
import { fileURLToPath } from "node:url";

import base from "./eslint.config.js";

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

export default base.map((config) => {
  if (!config.files) {
    return config;
  }

  return {
    ...config,
    languageOptions: {
      ...(config.languageOptions ?? {}),
      parserOptions: {
        ...(config.languageOptions?.parserOptions ?? {}),
        project: ["./tsconfig.json"],
        tsconfigRootDir,
      },
    },
    rules: {
      ...(config.rules ?? {}),
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: ["variable", "parameter"],
          types: ["boolean"],
          format: ["camelCase", "PascalCase"],
          prefix: ["is", "has", "can", "should", "did", "will"],
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
      ],
    },
  };
});
