import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const serverOrigin = process.env.LENSFLARE_SERVER_ORIGIN?.trim() || "http://127.0.0.1:43110";
const webPort = Number(process.env.LENSFLARE_WEB_PORT ?? 5173);
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "~": srcDir,
    },
    tsconfigPaths: true,
  },
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
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
