import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    outDir: "dist",
    format: ["cjs"],
    platform: "node",
    target: "node20",
    sourcemap: true,
    clean: true,
    define: {
      "import.meta": "{}",
    },
    deps: {
      alwaysBundle: [/^@lensflare\//, /^effect/, /^ws$/],
      onlyBundle: false,
    },
    outExtensions() {
      return {
        js: ".cjs",
      };
    },
  },
});
