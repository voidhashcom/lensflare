import type {
  DesktopBridge,
  DesktopEnvironmentBootstrap,
  DesktopLocalServerState,
} from "@lensflare/contracts";
import { contextBridge, ipcRenderer } from "electron";
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

/**
 * The main process serializes the initial bootstrap as a
 * `--lensflare-bootstrap=<base64-json>` entry via
 * `webPreferences.additionalArguments` before opening the window, so the
 * renderer's backend-target resolver can answer synchronously — before any
 * IPC round-trip — during module evaluation. Subsequent updates
 * (fresh `serverInstanceId` after a restart, failure transitions) arrive
 * via the `LOCAL_SERVER_STATE_CHANNEL` event stream.
 */
const BOOTSTRAP_ARG_PREFIX = "--lensflare-bootstrap=";

function readBootstrapFromArgs(): DesktopEnvironmentBootstrap | null {
  for (const arg of process.argv) {
    if (!arg.startsWith(BOOTSTRAP_ARG_PREFIX)) {
      continue;
    }

    try {
      const bytes = Uint8Array.from(atob(arg.slice(BOOTSTRAP_ARG_PREFIX.length)), (char) =>
        char.charCodeAt(0),
      );
      const json = new TextDecoder().decode(bytes);
      return JSON.parse(json) as DesktopEnvironmentBootstrap;
    } catch {
      return null;
    }
  }
  return null;
}

let latestBootstrap: DesktopEnvironmentBootstrap | null = readBootstrapFromArgs();

ipcRenderer.on(LOCAL_SERVER_STATE_CHANNEL, (_event, state: DesktopLocalServerState) => {
  if (state.status === "ready") {
    latestBootstrap = state.bootstrap;
  }
});

const bridge = {
  getLocalServerState: (): Promise<DesktopLocalServerState> =>
    ipcRenderer.invoke(GET_LOCAL_SERVER_STATE_CHANNEL) as Promise<DesktopLocalServerState>,
  restartLocalServer: (): Promise<DesktopLocalServerState> =>
    ipcRenderer.invoke(RESTART_LOCAL_SERVER_CHANNEL) as Promise<DesktopLocalServerState>,
  onLocalServerState: (listener: (state: DesktopLocalServerState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopLocalServerState) => {
      if (state.status === "ready") {
        latestBootstrap = state.bootstrap;
      }
      listener(state);
    };

    ipcRenderer.on(LOCAL_SERVER_STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.off(LOCAL_SERVER_STATE_CHANNEL, handler);
    };
  },
  getLocalServerBootstrap: (): DesktopEnvironmentBootstrap | null => latestBootstrap,
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme) as Promise<void>,
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  setUpdateChannel: (channel) => ipcRenderer.invoke(UPDATE_SET_CHANNEL_CHANNEL, channel),
  checkForUpdate: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) {
        return;
      }
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.off(UPDATE_STATE_CHANNEL, handler);
    };
  },
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld("lensflareDesktop", bridge);
contextBridge.exposeInMainWorld("desktopBridge", bridge);
