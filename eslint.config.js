import js from "@eslint/js";
import { boundaryPlugin } from "./scripts/boundaries.ts";
import query from "@tanstack/eslint-plugin-query";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/.output/**",
      "**/.nitro/**",
      "**/.tanstack/**",
      "**/.turbo/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/.data/**",
      "eslint.config.js",
      "scripts/agents/fake-pi.mjs",
      "coverage",
      "playwright-report",
      "test-results",
      "**/routeTree.gen.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  jsxA11y.flatConfigs.recommended,
  query.configs["flat/recommended"],
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    plugins: { architecture: boundaryPlugin },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "architecture/layer-boundaries": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": "off",
    },
  },
);
