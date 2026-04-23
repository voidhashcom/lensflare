import { defineConfig } from "vite-plus";

// The main and preload bundles are built by **separate** `vp pack`
// invocations (see `package.json` scripts). A single multi-entry pack
// makes rolldown extract shared modules (including its own CJS runtime
// helpers) into auxiliary chunks and emit cross-entry `require(...)`
// calls — both of which break at runtime because Electron's sandboxed
// preload `require` only resolves Electron + Node built-ins, not
// relative paths. Running one invocation per entry forces each bundle
// to be fully self-contained. The options below apply to both.
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
