import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/main/index.ts", "src/preload/index.ts"],
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
      neverBundle: [
        "electron",
        "@duckdb/node-api",
        "@duckdb/node-bindings",
        "bindings",
        "file-uri-to-path",
      ],
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
