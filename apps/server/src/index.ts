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
    analytics: {
      enabled: config.posthogEnabled,
      host: config.posthogHost,
      debug: config.posthogDebug,
      ...(config.posthogApiKey ? { apiKey: config.posthogApiKey } : {}),
    },
    bootstrapOtelCatalog: config.lensflareDev,
  });

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = () => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = server
      .stop()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("ManagedRuntime disposed")) {
          throw error;
        }
      })
      .finally(() => {
        process.exit(0);
      });

    return shutdownPromise;
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error("[lensflare] failed to start server", error);
  process.exit(1);
});
