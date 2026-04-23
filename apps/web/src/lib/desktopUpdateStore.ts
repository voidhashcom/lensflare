import type {
  DesktopBridge,
  DesktopUpdateActionResult,
  DesktopUpdateChannel,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
} from "@lensflare/contracts";
import { useSyncExternalStore } from "react";

export interface DesktopUpdateSnapshot {
  readonly bridgeAvailable: boolean;
  readonly initialized: boolean;
  readonly state: DesktopUpdateState | null;
  readonly error: string | null;
}

const initialSnapshot: DesktopUpdateSnapshot = {
  bridgeAvailable: false,
  initialized: false,
  state: null,
  error: null,
};

let snapshot = initialSnapshot;
let initializePromise: Promise<void> | null = null;
let unsubscribeFromBridge: (() => void) | null = null;
const listeners = new Set<() => void>();

function readDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  const bridge = window.desktopBridge ?? window.lensflareDesktop ?? null;
  if (!bridge || typeof bridge.getUpdateState !== "function") {
    return null;
  }
  return bridge;
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function updateSnapshot(patch: Partial<DesktopUpdateSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

export function getDesktopUpdateSnapshot(): DesktopUpdateSnapshot {
  return snapshot;
}

export function setDesktopUpdateState(state: DesktopUpdateState): void {
  updateSnapshot({
    bridgeAvailable: true,
    initialized: true,
    state,
    error: null,
  });
}

export function ensureDesktopUpdateStoreInitialized(): Promise<void> {
  if (initializePromise) {
    return initializePromise;
  }

  const bridge = readDesktopBridge();
  if (!bridge) {
    updateSnapshot({
      bridgeAvailable: false,
      initialized: true,
      state: null,
      error: null,
    });
    initializePromise = Promise.resolve();
    return initializePromise;
  }

  updateSnapshot({
    bridgeAvailable: true,
  });

  if (!unsubscribeFromBridge && typeof bridge.onUpdateState === "function") {
    unsubscribeFromBridge = bridge.onUpdateState((state) => {
      setDesktopUpdateState(state);
    });
  }

  initializePromise = bridge
    .getUpdateState()
    .then((state) => {
      setDesktopUpdateState(state);
    })
    .catch((error: unknown) => {
      updateSnapshot({
        bridgeAvailable: true,
        initialized: true,
        error: error instanceof Error ? error.message : "Could not load desktop update state.",
      });
    });

  return initializePromise;
}

export function subscribeToDesktopUpdateStore(listener: () => void): () => void {
  listeners.add(listener);
  void ensureDesktopUpdateStoreInitialized();
  return () => {
    listeners.delete(listener);
  };
}

export function useDesktopUpdateSnapshot(): DesktopUpdateSnapshot {
  return useSyncExternalStore(
    subscribeToDesktopUpdateStore,
    getDesktopUpdateSnapshot,
    getDesktopUpdateSnapshot,
  );
}

export function useDesktopUpdateState(): DesktopUpdateState | null {
  return useDesktopUpdateSnapshot().state;
}

export async function setDesktopUpdateChannel(
  channel: DesktopUpdateChannel,
): Promise<DesktopUpdateState | null> {
  const bridge = readDesktopBridge();
  if (!bridge) {
    return null;
  }
  const state = await bridge.setUpdateChannel(channel);
  setDesktopUpdateState(state);
  return state;
}

export async function checkForDesktopUpdate(): Promise<DesktopUpdateCheckResult | null> {
  const bridge = readDesktopBridge();
  if (!bridge) {
    return null;
  }
  const result = await bridge.checkForUpdate();
  setDesktopUpdateState(result.state);
  return result;
}

export async function downloadDesktopUpdate(): Promise<DesktopUpdateActionResult | null> {
  const bridge = readDesktopBridge();
  if (!bridge) {
    return null;
  }
  const result = await bridge.downloadUpdate();
  setDesktopUpdateState(result.state);
  return result;
}

export async function installDesktopUpdate(): Promise<DesktopUpdateActionResult | null> {
  const bridge = readDesktopBridge();
  if (!bridge) {
    return null;
  }
  const result = await bridge.installUpdate();
  setDesktopUpdateState(result.state);
  return result;
}

export function resetDesktopUpdateStoreForTests(): void {
  unsubscribeFromBridge?.();
  unsubscribeFromBridge = null;
  initializePromise = null;
  snapshot = initialSnapshot;
  listeners.clear();
}
