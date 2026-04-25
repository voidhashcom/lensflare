import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["**/dist/**", "**/artifacts/**", "**/coverage/**", ".agents/**"],
  },
  lint: {
    ignorePatterns: ["**/dist/**", "**/artifacts/**", "**/coverage/**", ".agents/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
