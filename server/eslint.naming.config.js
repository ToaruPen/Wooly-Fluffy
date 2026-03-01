import base from "./eslint.config.js";

export default base.map((config) => {
  if (!config.rules) {
    return config;
  }

  return {
    ...config,
    rules: {
      ...config.rules,
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
