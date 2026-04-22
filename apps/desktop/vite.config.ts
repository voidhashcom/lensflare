import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/main/index.ts"],
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
      neverBundle: ["electron", "@effect/sql-sqlite-node", "better-sqlite3", "bindings", "file-uri-to-path"],
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
