import type { DesktopBridge, DesktopLocalServerState } from "@lensflare/contracts";

function readBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.desktopBridge ?? window.lensflareDesktop ?? null;
}

/**
 * True when the renderer is running inside the Electron desktop shell and
 * the preload bridge has been exposed on `window`.
 */
export function hasDesktopBridge(): boolean {
  return readBridge() !== null;
}

/**
 * Ask the desktop shell to restart its local server. Returns the resulting
 * {@link DesktopLocalServerState} once the main process has settled on a
 * terminal state (`ready` or `failed`). Returns `null` when called outside
 * the desktop shell so web-only callers can fall through to their own
 * reconnect strategy.
 */
export async function restartDesktopLocalServer(): Promise<DesktopLocalServerState | null> {
  const bridge = readBridge();
  if (!bridge) {
    return null;
  }

  return bridge.restartLocalServer();
}

/**
 * Fetch the current {@link DesktopLocalServerState} from the main process.
 * Used by the connection manager on startup to avoid racing against the
 * initial broadcast when a restart happened while the renderer was
 * loading.
 */
export async function getDesktopLocalServerState(): Promise<DesktopLocalServerState | null> {
  const bridge = readBridge();
  if (!bridge) {
    return null;
  }

  return bridge.getLocalServerState();
}

/**
 * Subscribe to desktop lifecycle transitions. Returns a disposer that
 * unregisters the listener. Safe to call outside the desktop shell — it
 * simply returns a no-op.
 */
export function subscribeToDesktopLocalServerState(
  listener: (state: DesktopLocalServerState) => void,
): () => void {
  const bridge = readBridge();
  if (!bridge) {
    return () => {};
  }

  return bridge.onLocalServerState(listener);
}
