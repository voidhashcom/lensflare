import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalServer } from "@lensflare/local-server";
import { readRuntimeConfigFromEnv } from "@lensflare/shared";

const config = readRuntimeConfigFromEnv(process.env);
const currentDir = dirname(fileURLToPath(import.meta.url));
const webDistDir = resolve(currentDir, "../../web/dist");

const server = await startLocalServer({
  mode: "server",
  host: config.host,
  port: config.serverPort,
  staticDir: webDistDir,
  staticAssetMode: "filesystem",
});

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
