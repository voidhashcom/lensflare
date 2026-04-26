import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

/**
 * Vite config for `apps/web`.
 *
 * After the T3-style refactor the renderer no longer infers its backend
 * target from `window.location` + a proxy, so the dev proxy is optional —
 * runtime HTTP + WebSocket traffic goes straight to the explicit base
 * URLs defined in {@link ../src/data/backendTarget.ts}. We still inject
 * defaults for `VITE_LENSFLARE_HTTP_URL` / `VITE_LENSFLARE_WS_URL` so
 * browser-only `pnpm --dir apps/web dev` workflows (no desktop shell,
 * no envfile) keep working against the local server on
 * `DEFAULT_SERVER_PORT`.
 */
const DEFAULT_SERVER_PORT = 43110;
const DEFAULT_HOST = "127.0.0.1";

const serverHost = process.env.LENSFLARE_HOST?.trim() || DEFAULT_HOST;
const serverPort = Number(process.env.LENSFLARE_SERVER_PORT ?? DEFAULT_SERVER_PORT);
const serverOrigin =
  process.env.LENSFLARE_SERVER_ORIGIN?.trim() || `http://${serverHost}:${serverPort}`;
const wsOrigin = serverOrigin.replace(/^http/, "ws");
const webPort = Number(process.env.LENSFLARE_WEB_PORT ?? 5173);
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

const httpTarget = process.env.VITE_LENSFLARE_HTTP_URL?.trim() || serverOrigin;
const wsTarget = process.env.VITE_LENSFLARE_WS_URL?.trim() || wsOrigin;

export default defineConfig({
  resolve: {
    alias: {
      "~": srcDir,
    },
    tsconfigPaths: true,
  },
  define: {
    "import.meta.env.VITE_LENSFLARE_HTTP_URL": JSON.stringify(httpTarget),
    "import.meta.env.VITE_LENSFLARE_WS_URL": JSON.stringify(wsTarget),
  },
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    tailwindcss(),
  ],
  server: {
    host: DEFAULT_HOST,
    port: webPort,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
