import type { DesktopBridge, DesktopUpdateState } from "@lensflare/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureDesktopUpdateStoreInitialized,
  getDesktopUpdateSnapshot,
  resetDesktopUpdateStoreForTests,
  subscribeToDesktopUpdateStore,
} from "./desktopUpdateStore";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  resetDesktopUpdateStoreForTests();
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

function installWindow(bridge: DesktopBridge | null): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: bridge ? { desktopBridge: bridge } : {},
  });
}

function createBridge(initialState: DesktopUpdateState) {
  let updateListener: ((state: DesktopUpdateState) => void) | null = null;
  const bridge: DesktopBridge = {
    getLocalServerState: vi.fn(),
    restartLocalServer: vi.fn(),
    onLocalServerState: vi.fn(() => () => {}),
    getLocalServerBootstrap: vi.fn(() => null),
    getUpdateState: vi.fn(async () => initialState),
    setUpdateChannel: vi.fn(),
    checkForUpdate: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    onUpdateState: vi.fn((listener) => {
      updateListener = listener;
      return () => {
        updateListener = null;
      };
    }),
  };

  return {
    bridge,
    emitUpdate: (state: DesktopUpdateState) => {
      updateListener?.(state);
    },
  };
}

describe("desktopUpdateStore", () => {
  it("fetches the initial desktop updater state", async () => {
    const { bridge } = createBridge(baseState);
    installWindow(bridge);

    await ensureDesktopUpdateStoreInitialized();

    expect(bridge.getUpdateState).toHaveBeenCalledTimes(1);
    expect(getDesktopUpdateSnapshot()).toEqual({
      bridgeAvailable: true,
      initialized: true,
      state: baseState,
      error: null,
    });
  });

  it("returns a desktop-only snapshot when no bridge is available", async () => {
    installWindow(null);

    await ensureDesktopUpdateStoreInitialized();

    expect(getDesktopUpdateSnapshot()).toEqual({
      bridgeAvailable: false,
      initialized: true,
      state: null,
      error: null,
    });
  });

  it("publishes subscription updates from the bridge", async () => {
    const { bridge, emitUpdate } = createBridge(baseState);
    installWindow(bridge);
    const listener = vi.fn();
    const unsubscribe = subscribeToDesktopUpdateStore(listener);

    await ensureDesktopUpdateStoreInitialized();
    const availableState: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.1.0",
    };

    emitUpdate(availableState);

    expect(listener).toHaveBeenCalled();
    expect(getDesktopUpdateSnapshot().state).toEqual(availableState);
    unsubscribe();
  });

  it("shares one bridge subscription and state across consumers", async () => {
    const { bridge, emitUpdate } = createBridge(baseState);
    installWindow(bridge);
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    const unsubscribeFirst = subscribeToDesktopUpdateStore(firstListener);
    const unsubscribeSecond = subscribeToDesktopUpdateStore(secondListener);

    await ensureDesktopUpdateStoreInitialized();
    expect(bridge.getUpdateState).toHaveBeenCalledTimes(1);
    expect(bridge.onUpdateState).toHaveBeenCalledTimes(1);

    const downloadedState: DesktopUpdateState = {
      ...baseState,
      status: "downloaded",
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
      downloadPercent: 100,
    };
    emitUpdate(downloadedState);

    expect(firstListener).toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalled();
    expect(getDesktopUpdateSnapshot().state).toEqual(downloadedState);

    unsubscribeFirst();
    unsubscribeSecond();
  });
});
