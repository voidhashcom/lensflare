import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tsrxReact } from "./tsrx-react-plugin.ts";

const serverOrigin = process.env.LENSFLARE_SERVER_ORIGIN?.trim() || "http://127.0.0.1:43110";
const webPort = Number(process.env.LENSFLARE_WEB_PORT ?? 5173);

export default defineConfig({
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
      "/ws": {
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
