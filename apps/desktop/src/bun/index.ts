import Electrobun, { BrowserWindow, PATHS, Screen } from "electrobun/bun";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { startLocalServer } from "@lensflare/local-server";
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  readRuntimeConfigFromEnv,
  resolveWebDevUrl,
} from "@lensflare/shared";

const config = readRuntimeConfigFromEnv(process.env);

function resolveEmbeddedWebDir(): string | undefined {
  const candidate = resolve(PATHS.VIEWS_FOLDER, "..", "..", "web");
  return existsSync(candidate) ? candidate : undefined;
}

const embeddedWebDir = resolveEmbeddedWebDir();

const localServer = await startLocalServer({
  mode: "desktop",
  host: config.host,
  port: config.serverPort,
  staticAssetMode: config.desktopDev ? "proxy" : embeddedWebDir ? "embedded" : "none",
  ...(embeddedWebDir ? { staticDir: embeddedWebDir } : {}),
});

const display = Screen.getPrimaryDisplay();
const x = Math.round((display.workArea.width - DEFAULT_WINDOW_WIDTH) / 2) + display.workArea.x;
const y =
  Math.round((display.workArea.height - DEFAULT_WINDOW_HEIGHT) / 2) +
  display.workArea.y;

const windowUrl = config.desktopDev ? resolveWebDevUrl(config) : localServer.origin;
new BrowserWindow({
  title: `${APP_NAME} ${APP_VERSION}`,
  url: windowUrl,
  transparent: true,
  frame: {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    x,
    y,
  },
});

if (config.desktopDev) {
  // BrowserWindow instances expose `webview.openDevTools()` during development.
}

Electrobun.events.on("before-quit", async () => {
  await localServer.stop();
});
