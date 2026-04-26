import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "**/dist/**",
      "**/artifacts/**",
      "**/coverage/**",
      ".agents/**",
      "**/routeTree.gen.ts",
    ],
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/artifacts/**",
      "**/coverage/**",
      ".agents/**",
      "**/routeTree.gen.ts",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
