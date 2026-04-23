import type { DesktopLocalServerState, DesktopUpdateState } from "@lensflare/contracts";

/**
 * Invoke: renderer → main. Returns the current {@link DesktopLocalServerState}.
 */
export const GET_LOCAL_SERVER_STATE_CHANNEL = "lensflare:get-local-server-state";

/**
 * Event: main → renderer. Broadcasts every state transition for the
 * desktop-managed local server process.
 */
export const LOCAL_SERVER_STATE_CHANNEL = "lensflare:local-server-state";

/**
 * Invoke: renderer → main. Requests a restart and returns the resulting
 * {@link DesktopLocalServerState} once it settles.
 */
export const RESTART_LOCAL_SERVER_CHANNEL = "lensflare:restart-local-server";

export const UPDATE_STATE_CHANNEL = "lensflare:update-state";
export const UPDATE_GET_STATE_CHANNEL = "lensflare:update-get-state";
export const UPDATE_SET_CHANNEL_CHANNEL = "lensflare:update-set-channel";
export const UPDATE_CHECK_CHANNEL = "lensflare:update-check";
export const UPDATE_DOWNLOAD_CHANNEL = "lensflare:update-download";
export const UPDATE_INSTALL_CHANNEL = "lensflare:update-install";

export type LensflareIpcChannel =
  | typeof GET_LOCAL_SERVER_STATE_CHANNEL
  | typeof LOCAL_SERVER_STATE_CHANNEL
  | typeof RESTART_LOCAL_SERVER_CHANNEL
  | typeof UPDATE_STATE_CHANNEL
  | typeof UPDATE_GET_STATE_CHANNEL
  | typeof UPDATE_SET_CHANNEL_CHANNEL
  | typeof UPDATE_CHECK_CHANNEL
  | typeof UPDATE_DOWNLOAD_CHANNEL
  | typeof UPDATE_INSTALL_CHANNEL;

export type LocalServerStatePayload = DesktopLocalServerState;
export type UpdateStatePayload = DesktopUpdateState;
