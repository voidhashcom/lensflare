import { existsSync } from "node:fs";
import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { app, BrowserWindow, ipcMain, screen, type WebContents } from "electron";
import type { DesktopEnvironmentBootstrap, DesktopLocalServerState } from "@lensflare/contracts";
import { type LocalServerHandle, startLocalServer } from "@lensflare/local-server";
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  readRuntimeConfigFromEnv,
  resolveWebDevUrl,
} from "@lensflare/shared";
import { BackendReadinessAbortedError, waitForHttpReady } from "../backendReadiness.ts";
import {
  GET_LOCAL_SERVER_STATE_CHANNEL,
  LOCAL_SERVER_STATE_CHANNEL,
  RESTART_LOCAL_SERVER_CHANNEL,
} from "../ipc.ts";

const config = readRuntimeConfigFromEnv(process.env);
let mainWindow: BrowserWindow | null = null;

function resolveEmbeddedWebDir(): string | undefined {
  const candidate = app.isPackaged
    ? resolve(process.resourcesPath, "web")
    : resolve(process.cwd(), "../web/dist");

  return existsSync(candidate) ? candidate : undefined;
}

function resolvePreloadPath(): string {
  return resolve(app.getAppPath(), "dist/preload/index.cjs");
}

function encodeBootstrapForPreload(bootstrap: DesktopEnvironmentBootstrap): string {
  return `--lensflare-bootstrap=${Buffer.from(JSON.stringify(bootstrap), "utf8").toString("base64")}`;
}

function deriveBootstrap(handle: LocalServerHandle): DesktopEnvironmentBootstrap {
  return {
    label: `${APP_NAME} ${APP_VERSION}`,
    httpBaseUrl: handle.httpBaseUrl,
    wsBaseUrl: handle.wsBaseUrl,
    serverInstanceId: handle.serverInstanceId,
  };
}

async function main(): Promise<void> {
  const embeddedWebDir = resolveEmbeddedWebDir();
  const devClientUrl = config.desktopDev ? resolveWebDevUrl(config) : undefined;
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
    ...(devClientUrl ? { devClientUrl } : {}),
  } as const;

  /**
   * Lifecycle state. The main process owns the source of truth for the
   * local server's lifecycle; the renderer mirrors it through
   * {@link LOCAL_SERVER_STATE_CHANNEL}. `starting` is the initial value
   * before the first window opens; every successful transition is
   * broadcast to any attached `WebContents`. Failures are surfaced as
   * `{ status: "failed", message }` so the renderer can render an error
   * affordance instead of spinning forever.
   */
  let currentState: DesktopLocalServerState = { status: "starting" };
  let currentHandle: LocalServerHandle | null = null;
  let restartPromise: Promise<DesktopLocalServerState> | null = null;
  let readinessAbortController: AbortController | null = null;
  let quitting = false;

  function broadcastState(state: DesktopLocalServerState): void {
    currentState = state;
    for (const contents of BrowserWindow.getAllWindows().map((win) => win.webContents)) {
      if (!contents.isDestroyed()) {
        contents.send(LOCAL_SERVER_STATE_CHANNEL, state);
      }
    }
  }

  function transitionStarting(): void {
    broadcastState({ status: "starting" });
  }

  function transitionRestarting(): void {
    broadcastState({ status: "restarting" });
  }

  function transitionReady(handle: LocalServerHandle): void {
    currentHandle = handle;
    broadcastState({ status: "ready", bootstrap: deriveBootstrap(handle) });
  }

  function transitionFailed(error: unknown): void {
    const message =
      error instanceof Error && error.message.length > 0
        ? error.message
        : "Local server failed to start.";
    broadcastState({ status: "failed", message });
  }

  async function waitForServerReady(handle: LocalServerHandle): Promise<void> {
    readinessAbortController?.abort();
    const controller = new AbortController();
    readinessAbortController = controller;

    try {
      await waitForHttpReady({
        url: `${handle.httpBaseUrl}/api/health`,
        signal: controller.signal,
      });
    } finally {
      if (readinessAbortController === controller) {
        readinessAbortController = null;
      }
    }
  }

  async function bootLocalServer(): Promise<LocalServerHandle> {
    const handle = await startLocalServer(localServerOptions);
    try {
      await waitForServerReady(handle);
    } catch (error) {
      // If readiness is aborted mid-wait (e.g. the app is quitting or a
      // newer restart superseded us), stop the now-orphaned handle before
      // rethrowing so we never leak a listening socket.
      try {
        await handle.stop();
      } catch {
        // Best effort — the caller is already going to surface `error`.
      }
      throw error;
    }
    return handle;
  }

  async function stopCurrentServer(): Promise<void> {
    if (!currentHandle) {
      return;
    }

    readinessAbortController?.abort();
    const handle = currentHandle;
    currentHandle = null;
    try {
      await handle.stop();
    } catch (error) {
      console.error("[lensflare] failed to stop local server", error);
    }
  }

  async function restartLocalServer(): Promise<DesktopLocalServerState> {
    if (restartPromise) {
      return restartPromise;
    }

    restartPromise = (async () => {
      transitionRestarting();
      await stopCurrentServer();

      try {
        const handle = await bootLocalServer();
        transitionReady(handle);
      } catch (error) {
        if (error instanceof BackendReadinessAbortedError) {
          // The restart was superseded or the app is shutting down; keep
          // the last broadcast state so callers observe the newer flow.
          return currentState;
        }
        transitionFailed(error);
      }

      return currentState;
    })().finally(() => {
      restartPromise = null;
    });

    return restartPromise;
  }

  async function createMainWindow(): Promise<void> {
    if (!currentHandle || currentState.status !== "ready") {
      throw new Error("Local server is unavailable.");
    }

    const bootstrap = deriveBootstrap(currentHandle);
    const isMac = process.platform === "darwin";
    const display = screen.getPrimaryDisplay();
    const x = Math.round((display.workArea.width - DEFAULT_WINDOW_WIDTH) / 2) + display.workArea.x;
    const y =
      Math.round((display.workArea.height - DEFAULT_WINDOW_HEIGHT) / 2) + display.workArea.y;

    const windowUrl = devClientUrl ?? currentHandle.httpBaseUrl;

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
        // Hands the synchronous bootstrap to the preload script so the
        // renderer's backend-target resolver can answer before any IPC
        // round-trip. Subsequent transitions flow through
        // {@link LOCAL_SERVER_STATE_CHANNEL}.
        additionalArguments: [encodeBootstrapForPreload(bootstrap)],
      },
    });

    await mainWindow.loadURL(windowUrl);

    if (config.desktopDev) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }

    // Any newly-created `WebContents` needs the current state eagerly so
    // it doesn't sit on `starting` during the tiny gap between preload
    // eval and the next state transition broadcast.
    pushStateTo(mainWindow.webContents);

    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }

  function pushStateTo(contents: WebContents): void {
    if (!contents.isDestroyed()) {
      contents.send(LOCAL_SERVER_STATE_CHANNEL, currentState);
    }
  }

  app.setName(APP_NAME);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (mainWindow === null && currentState.status === "ready") {
      void createMainWindow();
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    readinessAbortController?.abort();
    void stopCurrentServer();
  });

  ipcMain.handle(GET_LOCAL_SERVER_STATE_CHANNEL, () => currentState);
  ipcMain.handle(RESTART_LOCAL_SERVER_CHANNEL, async () => {
    if (quitting) {
      return currentState;
    }
    return restartLocalServer();
  });

  transitionStarting();

  try {
    const handle = await bootLocalServer();
    transitionReady(handle);
  } catch (error) {
    transitionFailed(error);
    throw error;
  }

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
