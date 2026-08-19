import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "esbuild.config.mjs",
      "eslint.config.mjs",
      "main.js",
      "node_modules/**",
      "scripts/check-task-header-spacing.mjs"
    ]
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" }
    }
  }
]);
