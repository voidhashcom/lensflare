import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    outDir: "dist",
    format: ["esm", "cjs"],
    platform: "node",
    target: "node20",
    clean: true,
    dts: true,
    publint: true,
    attw: true,
    deps: {
      neverBundle: ["effect"],
    },
    outExtensions({ format }) {
      return {
        js: format === "cjs" ? ".cjs" : ".js",
        dts: format === "cjs" ? ".d.cts" : ".d.ts",
      };
    },
  },
});
