// ESLint flat config mirroring the Obsidian community-plugin reviewer:
// eslint-plugin-obsidianmd (Obsidian-specific rules) + typescript-eslint
// type-checked rules. Run with `npm run lint`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "scripts/**",
      "test/**",
      "src/types/**", // generated/vendored Supabase types
      "*.config.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Naive rule (lowercases proper nouns like Supabase/Spanish/Flowstate);
      // not part of the community-plugin reviewer's checks.
      "obsidianmd/ui/sentence-case": "off",
    },
  },
);
