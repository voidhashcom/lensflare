import type { DesktopEnvironmentBootstrap, DesktopLocalServerState } from "@lensflare/contracts";
import { contextBridge, ipcRenderer } from "electron";
import { Buffer } from "node:buffer";
import {
  GET_LOCAL_SERVER_STATE_CHANNEL,
  LOCAL_SERVER_STATE_CHANNEL,
  RESTART_LOCAL_SERVER_CHANNEL,
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
      const json = Buffer.from(arg.slice(BOOTSTRAP_ARG_PREFIX.length), "base64").toString("utf8");
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

contextBridge.exposeInMainWorld("lensflareDesktop", {
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
});
