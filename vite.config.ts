import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["**/dist/**", "**/artifacts/**", "**/coverage/**"],
  },
  lint: {
    ignorePatterns: ["**/dist/**", "**/artifacts/**", "**/coverage/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
