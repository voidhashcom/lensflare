import { existsSync, readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import {
  bucketDurationMs,
  classifyError,
  type AnalyticsEventName,
  type AnalyticsRecorder,
} from "@lensflare/analytics";
import { createNodeAnalyticsRecorder } from "@lensflare/analytics/node";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import type {
  DesktopEnvironmentBootstrap,
  DesktopLocalServerState,
  DesktopTheme,
  DesktopUpdateActionResult,
  DesktopUpdateChannel,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
} from "@lensflare/contracts";
import {
  type LocalServerHandle,
  resolveAnalyticsBootstrap,
  startLocalServer,
} from "@lensflare/local-server";
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  readRuntimeConfigFromEnv,
  resolveWebDevUrl,
} from "@lensflare/shared";
import { autoUpdater } from "electron-updater";
import { BackendReadinessAbortedError, waitForHttpReady } from "../backendReadiness.ts";
import {
  GET_LOCAL_SERVER_STATE_CHANNEL,
  LOCAL_SERVER_STATE_CHANNEL,
  RESTART_LOCAL_SERVER_CHANNEL,
  SET_THEME_CHANNEL,
  UPDATE_CHECK_CHANNEL,
  UPDATE_DOWNLOAD_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  UPDATE_SET_CHANNEL_CHANNEL,
  UPDATE_STATE_CHANNEL,
} from "../ipc.ts";
import {
  readDesktopSettings,
  setDesktopUpdateChannelPreference,
  writeDesktopSettings,
  type DesktopSettings,
} from "../desktopSettings.ts";
import { isArm64HostRunningIntelBuild, resolveDesktopRuntimeInfo } from "../runtimeArch.ts";
import { doesVersionMatchDesktopUpdateChannel } from "../updateChannels.ts";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "../updateMachine.ts";
import { getAutoUpdateDisabledReason, shouldBroadcastDownloadProgress } from "../updateState.ts";

const config = readRuntimeConfigFromEnv(process.env);
let mainWindow: BrowserWindow | null = null;
let quitting = false;

const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEVELOPMENT_ICON_RELATIVE_PATH =
  process.platform === "darwin"
    ? "../../assets/dev/lightflare-macos-1024.png"
    : process.platform === "win32"
      ? "../../assets/dev/lightflare-windows.ico"
      : "../../assets/dev/lightflare-linux-512.png";
const desktopRuntimeInfo = resolveDesktopRuntimeInfo({
  platform: process.platform,
  processArch: process.arch,
  runningUnderArm64Translation:
    (app as typeof app & { runningUnderARM64Translation?: boolean })
      .runningUnderARM64Translation === true,
});

let desktopSettings: DesktopSettings | null = null;
let updatePollTimer: ReturnType<typeof setInterval> | null = null;
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updateInstallInFlight = false;
let updaterConfigured = false;
let allowImmediateQuit = false;
let quitCleanupPromise: Promise<void> | null = null;
let updateState: DesktopUpdateState = createInitialDesktopUpdateState(
  app.getVersion(),
  desktopRuntimeInfo,
  "latest",
);
const desktopStartedAtMs = Date.now();

let desktopAnalyticsSignature: string | null = null;
let desktopAnalyticsRecorder: AnalyticsRecorder = {
  enabled: false,
  capture: () => {},
  shutdown: async () => {},
};

function resolveDesktopStaticAssetMode(): "embedded" | "filesystem" | "proxy" | "none" {
  if (config.desktopDev) {
    return "proxy";
  }
  return resolveEmbeddedWebDir() ? "embedded" : "none";
}

async function resolveDesktopAnalyticsRecorder(): Promise<AnalyticsRecorder> {
  const bootstrap = await resolveAnalyticsBootstrap(config);
  const signature = JSON.stringify(bootstrap);
  if (desktopAnalyticsSignature === signature) {
    return desktopAnalyticsRecorder;
  }

  await Promise.resolve(desktopAnalyticsRecorder.shutdown());
  desktopAnalyticsRecorder = createNodeAnalyticsRecorder(bootstrap, {
    surface: "desktop",
    mode: "desktop",
    platform: `${process.platform}-${process.arch}`,
    devMode: config.desktopDev || config.lensflareDev,
    staticAssetMode: resolveDesktopStaticAssetMode(),
  });
  desktopAnalyticsSignature = signature;
  return desktopAnalyticsRecorder;
}

async function captureDesktopEvent(
  event: AnalyticsEventName,
  properties?: Readonly<Record<string, unknown>>,
): Promise<void> {
  const recorder = await resolveDesktopAnalyticsRecorder();
  await Promise.resolve(recorder.capture(event, properties));
}

function captureDesktopEventBestEffort(
  event: AnalyticsEventName,
  properties?: Readonly<Record<string, unknown>>,
): void {
  void captureDesktopEvent(event, properties).catch(() => {
    // Analytics must not interrupt app behavior.
  });
}

async function shutdownDesktopAnalytics(): Promise<void> {
  await Promise.resolve(desktopAnalyticsRecorder.shutdown());
}

function destroyAllWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

function resolveDevelopmentIconPath(): string | undefined {
  if (!config.desktopDev) {
    return undefined;
  }

  const iconPath = resolve(app.getAppPath(), DEVELOPMENT_ICON_RELATIVE_PATH);
  return existsSync(iconPath) ? iconPath : undefined;
}

function resolveEmbeddedWebDir(): string | undefined {
  const candidate = app.isPackaged
    ? resolve(process.resourcesPath, "web")
    : resolve(process.cwd(), "../web/dist");

  return existsSync(candidate) ? candidate : undefined;
}

function resolvePreloadPath(): string {
  return resolve(app.getAppPath(), "dist/preload/preload.cjs");
}

function encodeBootstrapForPreload(bootstrap: DesktopEnvironmentBootstrap): string {
  return `--lensflare-bootstrap=${Buffer.from(JSON.stringify(bootstrap), "utf8").toString("base64")}`;
}

/**
 * Match `node:http`'s `EADDRINUSE` error so we can surface a friendlier
 * dialog instead of the raw stack. The error can arrive either as a Node
 * `Error` with `code === "EADDRINUSE"` or as a wrapped Effect failure
 * whose message contains the same code, so check both.
 */
function isAddressInUseError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }
  if (typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "EADDRINUSE") {
      return true;
    }
  }
  if (error instanceof Error && error.message.includes("EADDRINUSE")) {
    return true;
  }
  return false;
}

function deriveBootstrap(handle: LocalServerHandle): DesktopEnvironmentBootstrap {
  return {
    label: `${APP_NAME} ${APP_VERSION}`,
    httpBaseUrl: handle.httpBaseUrl,
    wsBaseUrl: handle.wsBaseUrl,
    serverInstanceId: handle.serverInstanceId,
  };
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveDesktopSettingsPath(): string {
  return resolve(app.getPath("userData"), "desktop-settings.json");
}

function getDesktopSettings(): DesktopSettings {
  if (!desktopSettings) {
    desktopSettings = readDesktopSettings(resolveDesktopSettingsPath(), app.getVersion());
  }
  return desktopSettings;
}

function persistDesktopSettings(settings: DesktopSettings): void {
  desktopSettings = settings;
  writeDesktopSettings(resolveDesktopSettingsPath(), settings);
}

function normalizeDesktopTheme(input: unknown): DesktopTheme | null {
  if (input === "light" || input === "dark" || input === "system") {
    return input;
  }
  return null;
}

function emitUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(UPDATE_STATE_CHANNEL, updateState);
    }
  }
}

function setUpdateState(nextState: DesktopUpdateState): void {
  updateState = nextState;
  emitUpdateState();
}

function createBaseUpdateState(
  channel: DesktopUpdateChannel,
  enabled: boolean,
  disabledReason: string | null = null,
): DesktopUpdateState {
  return {
    ...createInitialDesktopUpdateState(app.getVersion(), desktopRuntimeInfo, channel),
    enabled,
    status: enabled ? "idle" : "disabled",
    message: enabled ? null : disabledReason,
  };
}

function readAppUpdateYml(): Record<string, string> | null {
  try {
    const ymlPath = app.isPackaged
      ? resolve(process.resourcesPath, "app-update.yml")
      : resolve(app.getAppPath(), "dev-app-update.yml");
    const raw = readFileSync(ymlPath, "utf8");
    const entries: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match?.[1] && match[2]) {
        entries[match[1]] = match[2].trim();
      }
    }
    return entries.provider ? entries : null;
  } catch {
    return null;
  }
}

function resolveGitHubUpdateRepository(): { readonly owner: string; readonly repo: string } | null {
  const rawRepository = process.env.LENSFLARE_DESKTOP_UPDATE_REPOSITORY?.trim() || "";
  if (!rawRepository) {
    return null;
  }

  const [owner, repo, ...rest] = rawRepository.split("/");
  if (!owner || !repo || rest.length > 0) {
    console.warn(
      `[lensflare-updater] ignoring invalid LENSFLARE_DESKTOP_UPDATE_REPOSITORY=${rawRepository}`,
    );
    return null;
  }

  return { owner, repo };
}

function hasUpdateFeedConfig(): boolean {
  return (
    readAppUpdateYml() !== null ||
    resolveGitHubUpdateRepository() !== null ||
    parseBooleanEnv(process.env.LENSFLARE_DESKTOP_MOCK_UPDATES)
  );
}

function resolveAutoUpdateDisabledReason(): string | null {
  return getAutoUpdateDisabledReason({
    isDevelopment: config.desktopDev,
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImage: process.env.APPIMAGE,
    disabledByEnv: parseBooleanEnv(process.env.LENSFLARE_DISABLE_AUTO_UPDATE),
    hasUpdateFeedConfig: hasUpdateFeedConfig(),
  });
}

function applyAutoUpdaterChannel(channel: DesktopUpdateChannel): void {
  autoUpdater.channel = channel;
  autoUpdater.allowPrerelease = channel === "nightly";
  autoUpdater.allowDowngrade = channel === "nightly";
}

function clearUpdateTimers(): void {
  if (updateStartupTimer) {
    clearTimeout(updateStartupTimer);
    updateStartupTimer = null;
  }
  if (updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }
}

function configureUpdaterFeed(): void {
  const repository = resolveGitHubUpdateRepository();
  const githubToken =
    process.env.LENSFLARE_DESKTOP_UPDATE_GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || "";

  if (repository) {
    autoUpdater.setFeedURL({
      provider: "github",
      owner: repository.owner,
      repo: repository.repo,
      ...(githubToken ? { private: true, token: githubToken } : {}),
    });
  } else if (githubToken) {
    const appUpdateYml = readAppUpdateYml();
    if (appUpdateYml?.provider === "github") {
      autoUpdater.setFeedURL({
        ...appUpdateYml,
        provider: "github" as const,
        private: true,
        token: githubToken,
      });
    }
  }

  if (parseBooleanEnv(process.env.LENSFLARE_DESKTOP_MOCK_UPDATES)) {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: `http://localhost:${process.env.LENSFLARE_DESKTOP_MOCK_UPDATE_SERVER_PORT ?? 3000}`,
    });
  }
}

async function checkForUpdates(reason: string): Promise<boolean> {
  if (quitting || !updaterConfigured || updateCheckInFlight) {
    return false;
  }
  if (updateState.status === "downloading" || updateState.status === "downloaded") {
    console.info(
      `[lensflare-updater] skipping update check (${reason}) while status=${updateState.status}`,
    );
    return false;
  }

  updateCheckInFlight = true;
  captureDesktopEventBestEffort("desktop_update_check_requested", { reason });
  setUpdateState(reduceDesktopUpdateStateOnCheckStart(updateState, new Date().toISOString()));
  console.info(`[lensflare-updater] checking for updates (${reason})`);

  try {
    await autoUpdater.checkForUpdates();
    return true;
  } catch (error) {
    const message = formatErrorMessage(error);
    captureDesktopEventBestEffort("desktop_update_error", {
      stage: "check",
      reasonClass: classifyError(error),
    });
    setUpdateState(
      reduceDesktopUpdateStateOnCheckFailure(updateState, message, new Date().toISOString()),
    );
    console.error(`[lensflare-updater] failed to check for updates: ${message}`);
    return true;
  } finally {
    updateCheckInFlight = false;
  }
}

function handleCheckForUpdatesMenuClick(): void {
  const disabledReason = resolveAutoUpdateDisabledReason();
  if (disabledReason) {
    console.info("[lensflare-updater] manual update check requested while updates are disabled");
    void dialog.showMessageBox({
      type: "info",
      title: "Updates unavailable",
      message: "Automatic updates are not available right now.",
      detail: disabledReason,
      buttons: ["OK"],
    });
    return;
  }

  void checkForUpdatesFromMenu();
}

async function checkForUpdatesFromMenu(): Promise<void> {
  await checkForUpdates("menu");

  if (updateState.status === "up-to-date") {
    void dialog.showMessageBox({
      type: "info",
      title: "You're up to date",
      message: `${APP_NAME} ${updateState.currentVersion} is currently the newest version available.`,
      buttons: ["OK"],
    });
  } else if (updateState.status === "error") {
    void dialog.showMessageBox({
      type: "warning",
      title: "Update check failed",
      message: "Could not check for updates.",
      detail: updateState.message ?? "An unknown error occurred. Please try again later.",
      buttons: ["OK"],
    });
  }
}

async function downloadAvailableUpdate(): Promise<{ accepted: boolean; completed: boolean }> {
  if (!updaterConfigured || updateDownloadInFlight || updateState.status !== "available") {
    return { accepted: false, completed: false };
  }

  updateDownloadInFlight = true;
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(desktopRuntimeInfo);
  setUpdateState(reduceDesktopUpdateStateOnDownloadStart(updateState));
  captureDesktopEventBestEffort("desktop_update_download_started", {
    channel: updateState.channel,
  });
  console.info("[lensflare-updater] downloading update");

  try {
    await autoUpdater.downloadUpdate();
    return { accepted: true, completed: true };
  } catch (error) {
    const message = formatErrorMessage(error);
    captureDesktopEventBestEffort("desktop_update_error", {
      stage: "download",
      reasonClass: classifyError(error),
    });
    setUpdateState(reduceDesktopUpdateStateOnDownloadFailure(updateState, message));
    console.error(`[lensflare-updater] failed to download update: ${message}`);
    return { accepted: true, completed: false };
  } finally {
    updateDownloadInFlight = false;
  }
}

async function installDownloadedUpdate(stopCurrentServer: () => Promise<void>): Promise<{
  accepted: boolean;
  completed: boolean;
}> {
  if (quitting || !updaterConfigured || updateState.status !== "downloaded") {
    return { accepted: false, completed: false };
  }

  quitting = true;
  updateInstallInFlight = true;
  clearUpdateTimers();

  try {
    await captureDesktopEvent("desktop_update_install_requested", {
      channel: updateState.channel,
    });
    destroyAllWindows();
    await Promise.all([shutdownDesktopAnalytics(), stopCurrentServer()]);
    autoUpdater.quitAndInstall(true, true);
    return { accepted: true, completed: false };
  } catch (error) {
    const message = formatErrorMessage(error);
    updateInstallInFlight = false;
    quitting = false;
    captureDesktopEventBestEffort("desktop_update_error", {
      stage: "install",
      reasonClass: classifyError(error),
    });
    setUpdateState(reduceDesktopUpdateStateOnInstallFailure(updateState, message));
    console.error(`[lensflare-updater] failed to install update: ${message}`);
    return { accepted: true, completed: false };
  }
}

function configureAutoUpdater(): void {
  const settings = getDesktopSettings();
  const disabledReason = resolveAutoUpdateDisabledReason();
  const enabled = disabledReason === null;

  configureUpdaterFeed();
  setUpdateState(createBaseUpdateState(settings.updateChannel, enabled, disabledReason));

  if (!enabled) {
    console.info(`[lensflare-updater] disabled: ${disabledReason}`);
    return;
  }

  updaterConfigured = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(desktopRuntimeInfo);
  applyAutoUpdaterChannel(settings.updateChannel);

  if (isArm64HostRunningIntelBuild(desktopRuntimeInfo)) {
    console.info(
      "[lensflare-updater] Apple Silicon host detected while running an Intel build; updates will prefer arm64 artifacts.",
    );
  }

  let lastLoggedDownloadMilestone = -1;

  autoUpdater.on("checking-for-update", () => {
    console.info("[lensflare-updater] looking for updates");
  });

  autoUpdater.on("update-available", (info) => {
    if (!doesVersionMatchDesktopUpdateChannel(info.version, updateState.channel)) {
      console.info(
        `[lensflare-updater] ignoring ${info.version}; it does not match channel ${updateState.channel}`,
      );
      setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
      lastLoggedDownloadMilestone = -1;
      return;
    }

    setUpdateState(
      reduceDesktopUpdateStateOnUpdateAvailable(
        updateState,
        info.version,
        new Date().toISOString(),
      ),
    );
    captureDesktopEventBestEffort("desktop_update_available", {
      channel: updateState.channel,
      releaseType: info.version.includes("-") ? "nightly" : "stable",
    });
    lastLoggedDownloadMilestone = -1;
    console.info(`[lensflare-updater] update available: ${info.version}`);
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
    lastLoggedDownloadMilestone = -1;
    console.info("[lensflare-updater] no updates available");
  });

  autoUpdater.on("error", (error) => {
    const message = formatErrorMessage(error);
    const stage = updateInstallInFlight ? "install" : updateDownloadInFlight ? "download" : "check";
    captureDesktopEventBestEffort("desktop_update_error", {
      stage,
      reasonClass: classifyError(error),
    });
    if (updateInstallInFlight) {
      updateInstallInFlight = false;
      quitting = false;
      setUpdateState(reduceDesktopUpdateStateOnInstallFailure(updateState, message));
      console.error(`[lensflare-updater] updater install error: ${message}`);
      return;
    }
    if (!updateCheckInFlight && !updateDownloadInFlight) {
      setUpdateState({
        ...updateState,
        status: "error",
        message,
        checkedAt: new Date().toISOString(),
        downloadPercent: null,
        errorContext: updateDownloadInFlight
          ? "download"
          : updateCheckInFlight
            ? "check"
            : updateState.errorContext,
        canRetry: updateState.availableVersion !== null || updateState.downloadedVersion !== null,
      });
    }
    console.error(`[lensflare-updater] updater error: ${message}`);
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.floor(progress.percent);
    if (
      shouldBroadcastDownloadProgress(updateState, progress.percent) ||
      updateState.message !== null
    ) {
      setUpdateState(reduceDesktopUpdateStateOnDownloadProgress(updateState, progress.percent));
    }

    const milestone = percent - (percent % 10);
    if (milestone > lastLoggedDownloadMilestone) {
      lastLoggedDownloadMilestone = milestone;
      console.info(`[lensflare-updater] download progress: ${percent}%`);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState(reduceDesktopUpdateStateOnDownloadComplete(updateState, info.version));
    captureDesktopEventBestEffort("desktop_update_download_completed", {
      channel: updateState.channel,
    });
    console.info(`[lensflare-updater] update downloaded: ${info.version}`);
  });

  clearUpdateTimers();
  updateStartupTimer = setTimeout(() => {
    updateStartupTimer = null;
    void checkForUpdates("startup");
  }, AUTO_UPDATE_STARTUP_DELAY_MS);
  updateStartupTimer.unref();

  updatePollTimer = setInterval(() => {
    void checkForUpdates("poll");
  }, AUTO_UPDATE_POLL_INTERVAL_MS);
  updatePollTimer.unref();
}

function configureApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: () => handleCheckForUpdatesMenuClick(),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu: [{ role: process.platform === "darwin" ? "close" : "quit" }],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+Plus", visible: false },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Check for Updates...",
          click: () => handleCheckForUpdatesMenuClick(),
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function main(): Promise<void> {
  const embeddedWebDir = resolveEmbeddedWebDir();
  const devClientUrl = config.desktopDev ? resolveWebDevUrl(config) : undefined;
  const localServerOptions = {
    mode: "desktop",
    host: config.host,
    port: config.serverPort,
    staticAssetMode: resolveDesktopStaticAssetMode(),
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
    const portInUse = isAddressInUseError(error);
    const message = portInUse
      ? `Port ${localServerOptions.port} is already in use. Quit the other process or set LENSFLARE_SERVER_PORT, then relaunch ${APP_NAME}.`
      : error instanceof Error && error.message.length > 0
        ? error.message
        : "Local server failed to start.";
    broadcastState({ status: "failed", message });

    if (portInUse) {
      // Synchronous, system-modal — guarantees the user sees the actionable
      // copy even when the renderer hasn't loaded yet (the failure can fire
      // before the first window is created).
      dialog.showErrorBox(`${APP_NAME} could not start`, message);
    }
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

  async function createMainWindow(developmentIconPath?: string): Promise<void> {
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
      ...(developmentIconPath ? { icon: developmentIconPath } : {}),
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
    mainWindow.webContents.send(UPDATE_STATE_CHANNEL, updateState);

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
      void createMainWindow(resolveDevelopmentIconPath());
    }
  });

  app.on("before-quit", (event) => {
    if (allowImmediateQuit || updateInstallInFlight) {
      quitting = true;
      readinessAbortController?.abort();
      clearUpdateTimers();
      void stopCurrentServer();
      return;
    }
    if (quitCleanupPromise) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    quitting = true;
    readinessAbortController?.abort();
    clearUpdateTimers();
    quitCleanupPromise = (async () => {
      try {
        captureDesktopEventBestEffort("app_closed", {
          sessionDurationBucket: bucketDurationMs(Date.now() - desktopStartedAtMs),
        });
        destroyAllWindows();
        await Promise.all([stopCurrentServer(), shutdownDesktopAnalytics()]);
      } catch (error) {
        console.error("[lensflare] failed during quit cleanup", error);
      } finally {
        allowImmediateQuit = true;
        app.quit();
      }
    })();
  });

  ipcMain.handle(GET_LOCAL_SERVER_STATE_CHANNEL, () => currentState);
  ipcMain.handle(RESTART_LOCAL_SERVER_CHANNEL, async () => {
    if (quitting) {
      return currentState;
    }
    return restartLocalServer();
  });
  ipcMain.handle(SET_THEME_CHANNEL, (_event, rawTheme: unknown) => {
    const theme = normalizeDesktopTheme(rawTheme);
    if (theme) {
      nativeTheme.themeSource = theme;
    }
  });
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, () => updateState);
  ipcMain.handle(UPDATE_SET_CHANNEL_CHANNEL, async (_event, rawChannel: unknown) => {
    if (rawChannel !== "latest" && rawChannel !== "nightly") {
      throw new Error("Invalid desktop update channel input.");
    }
    if (updateCheckInFlight || updateDownloadInFlight || updateInstallInFlight) {
      throw new Error("Cannot change update tracks while an update action is in progress.");
    }

    const nextChannel = rawChannel as DesktopUpdateChannel;
    persistDesktopSettings(setDesktopUpdateChannelPreference(getDesktopSettings(), nextChannel));

    if (nextChannel === updateState.channel) {
      return updateState;
    }

    const disabledReason = resolveAutoUpdateDisabledReason();
    const enabled = disabledReason === null;
    setUpdateState(createBaseUpdateState(nextChannel, enabled, disabledReason));

    if (!enabled || !updaterConfigured) {
      return updateState;
    }

    applyAutoUpdaterChannel(nextChannel);
    const allowDowngrade = autoUpdater.allowDowngrade;
    autoUpdater.allowDowngrade = true;
    try {
      await checkForUpdates("channel-change");
    } finally {
      autoUpdater.allowDowngrade = allowDowngrade;
    }
    return updateState;
  });
  ipcMain.handle(UPDATE_CHECK_CHANNEL, async () => {
    if (!updaterConfigured) {
      return {
        checked: false,
        state: updateState,
      } satisfies DesktopUpdateCheckResult;
    }
    const checked = await checkForUpdates("web-ui");
    return {
      checked,
      state: updateState,
    } satisfies DesktopUpdateCheckResult;
  });
  ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, async () => {
    const result = await downloadAvailableUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, async () => {
    const result = await installDownloadedUpdate(stopCurrentServer);
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
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
  await captureDesktopEvent("app_opened", {
    shell: "desktop",
  });
  configureApplicationMenu();
  const developmentIconPath = resolveDevelopmentIconPath();
  if (developmentIconPath && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(developmentIconPath);
  }
  configureAutoUpdater();
  await createMainWindow(developmentIconPath);
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
