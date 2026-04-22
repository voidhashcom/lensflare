import { resolve } from "node:path";
import { startLocalServer } from "@lensflare/local-server";
import { readRuntimeConfigFromEnv } from "@lensflare/shared";

const config = readRuntimeConfigFromEnv(process.env);
const webDistDir = resolve(process.cwd(), "../web/dist");

async function main(): Promise<void> {
  const server = await startLocalServer({
    mode: "server",
    host: config.host,
    port: config.serverPort,
    staticDir: webDistDir,
    staticAssetMode: "filesystem",
    otel: {
      enabled: config.otelEnabled,
      projectSlug: config.otelProjectSlug,
      datasetSlug: config.otelDatasetSlug,
    },
  });

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error("[lensflare] failed to start server", error);
  process.exit(1);
});
