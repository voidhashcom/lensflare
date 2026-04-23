import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { type LocalServerHandle, startLocalServer } from "@lensflare/local-server";
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  readRuntimeConfigFromEnv,
  resolveWebDevUrl,
} from "@lensflare/shared";
import { RESTART_LOCAL_SERVER_CHANNEL } from "../ipc.ts";

const config = readRuntimeConfigFromEnv(process.env);
let mainWindow: BrowserWindow | null = null;

function resolveEmbeddedWebDir(): string | undefined {
  const candidate = app.isPackaged
    ? resolve(process.resourcesPath, "web")
    : resolve(process.cwd(), "../web/dist");

  return existsSync(candidate) ? candidate : undefined;
}

function resolvePreloadPath(): string {
  return resolve(app.getAppPath(), "dist/preload.cjs");
}

async function main(): Promise<void> {
  const embeddedWebDir = resolveEmbeddedWebDir();
  const localServerOptions = {
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
  } as const;

  let localServer: LocalServerHandle | null = await startLocalServer(localServerOptions);
  let restartLocalServerPromise: Promise<void> | null = null;
  let stoppingServer: Promise<void> | null = null;

  async function startDesktopLocalServer(): Promise<void> {
    if (localServer !== null) {
      return;
    }

    localServer = await startLocalServer(localServerOptions);
  }

  function stopLocalServer(): Promise<void> {
    if (localServer === null) {
      return stoppingServer ?? Promise.resolve();
    }

    if (!stoppingServer) {
      const server = localServer;
      localServer = null;
      stoppingServer = server.stop().finally(() => {
        stoppingServer = null;
      });
    }

    return stoppingServer;
  }

  function restartLocalServer(): Promise<void> {
    if (!restartLocalServerPromise) {
      restartLocalServerPromise = (async () => {
        await stopLocalServer();
        await startDesktopLocalServer();
      })().finally(() => {
        restartLocalServerPromise = null;
      });
    }

    return restartLocalServerPromise;
  }

  async function createMainWindow(): Promise<void> {
    const isMac = process.platform === "darwin";
    const display = screen.getPrimaryDisplay();
    const x = Math.round((display.workArea.width - DEFAULT_WINDOW_WIDTH) / 2) + display.workArea.x;
    const y =
      Math.round((display.workArea.height - DEFAULT_WINDOW_HEIGHT) / 2) + display.workArea.y;

    const windowUrl = config.desktopDev ? resolveWebDevUrl(config) : localServer?.origin;

    if (!windowUrl) {
      throw new Error("Local server is unavailable.");
    }

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
        preload: resolvePreloadPath(),
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

  ipcMain.handle(RESTART_LOCAL_SERVER_CHANNEL, async () => {
    await restartLocalServer();
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
