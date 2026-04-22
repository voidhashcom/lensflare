import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main/index.ts"],
  outDir: "dist",
  format: ["cjs"],
  platform: "node",
  target: "node20",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ["electron"],
  noExternal: [/^@lensflare\//, /^effect/, /^ws$/],
  outExtension() {
    return {
      js: ".cjs",
    };
  },
});
