import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    outDir: "dist",
    format: ["esm"],
    platform: "node",
    target: "node20",
    clean: true,
    dts: true,
    publint: true,
    attw: true,
    deps: {
      neverBundle: ["effect"],
    },
    outExtensions() {
      return {
        js: ".js",
        dts: ".d.ts",
      };
    },
  },
});
