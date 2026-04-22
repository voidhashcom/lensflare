import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tsrxReact } from "./tsrx-react-plugin.ts";

const serverOrigin = process.env.LENSFLARE_SERVER_ORIGIN?.trim() || "http://127.0.0.1:43110";
const webPort = Number(process.env.LENSFLARE_WEB_PORT ?? 5173);
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  // `vite-tsconfig-paths` only rewrites `~/` in TypeScript/JavaScript modules,
  // so `.tsrx` imports fall through to Rollup and fail. Mirror the tsconfig
  // alias here so it applies regardless of the file extension.
  resolve: {
    alias: {
      "~": srcDir,
    },
  },
  plugins: [
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackRouter({
      target: "react",
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    tsrxReact(),
    react(),
    tailwindcss(),
  ],
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: serverOrigin,
        changeOrigin: true,
      },
      "/rpc": {
        target: serverOrigin.replace(/^http/, "ws"),
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
