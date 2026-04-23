import type { DesktopLocalServerState } from "@lensflare/contracts";

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

export type LensflareIpcChannel =
  | typeof GET_LOCAL_SERVER_STATE_CHANNEL
  | typeof LOCAL_SERVER_STATE_CHANNEL
  | typeof RESTART_LOCAL_SERVER_CHANNEL;

export type LocalServerStatePayload = DesktopLocalServerState;
