import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { app, BrowserWindow, screen } from "electron";
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
let mainWindow: BrowserWindow | null = null;

function resolveEmbeddedWebDir(): string | undefined {
  const candidate = app.isPackaged
    ? resolve(process.resourcesPath, "web")
    : resolve(process.cwd(), "../web/dist");

  return existsSync(candidate) ? candidate : undefined;
}

async function main(): Promise<void> {
  const embeddedWebDir = resolveEmbeddedWebDir();
  const localServer = await startLocalServer({
    mode: "desktop",
    host: config.host,
    port: config.serverPort,
    staticAssetMode: config.desktopDev ? "proxy" : embeddedWebDir ? "embedded" : "none",
    otel: {
      enabled: config.otelEnabled,
      projectSlug: config.otelProjectSlug,
      datasetSlug: config.otelDatasetSlug,
    },
    ...(embeddedWebDir ? { staticDir: embeddedWebDir } : {}),
  });
  let stoppingServer: Promise<void> | null = null;

  function stopLocalServer(): Promise<void> {
    if (!stoppingServer) {
      stoppingServer = localServer.stop();
    }

    return stoppingServer;
  }

  async function createMainWindow(): Promise<void> {
    const isMac = process.platform === "darwin";
    const display = screen.getPrimaryDisplay();
    const x = Math.round((display.workArea.width - DEFAULT_WINDOW_WIDTH) / 2) + display.workArea.x;
    const y =
      Math.round((display.workArea.height - DEFAULT_WINDOW_HEIGHT) / 2) + display.workArea.y;

    const windowUrl = config.desktopDev ? resolveWebDevUrl(config) : localServer.origin;

    mainWindow = new BrowserWindow({
      title: `${APP_NAME} ${APP_VERSION}`,
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      x,
      y,
      autoHideMenuBar: true,
      backgroundColor: "#00000000",
      ...(isMac
        ? {
            roundedCorners: true,
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 18, y: 18 },
            vibrancy: "under-window" as const,
            visualEffectState: "active" as const,
          }
        : {}),
      transparent: isMac,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    await mainWindow.loadURL(windowUrl);

    if (config.desktopDev) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }

    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }

  app.setName(APP_NAME);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (mainWindow === null) {
      void createMainWindow();
    }
  });

  app.on("before-quit", () => {
    void stopLocalServer();
  });

  await app.whenReady();
  await createMainWindow();
}

const shouldEnforceSingleInstanceLock = !config.desktopDev;
const hasSingleInstanceLock = shouldEnforceSingleInstanceLock
  ? app.requestSingleInstanceLock()
  : true;

if (!hasSingleInstanceLock) {
  console.error("[lensflare] another desktop instance is already running");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      mainWindow.focus();
    }
  });

  void main().catch((error) => {
    console.error("[lensflare] failed to start desktop runtime", error);
    app.exit(1);
  });
}
