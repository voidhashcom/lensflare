import { afterEach, describe, expect, it, vi } from "vitest";

function installBrowserTimerStub() {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    location: {
      hash: "",
      href: "http://localhost/",
      reload: vi.fn(),
      search: "",
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
  });
}

async function importManager() {
  vi.doMock("~/analytics", () => ({
    captureWebEvent: vi.fn(),
  }));

  return import("./rpcConnectionManager");
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("rpcConnectionManager", () => {
  it("starts reconnect recovery for stringified socket close errors", async () => {
    installBrowserTimerStub();

    const { getConnectionState, reportRpcConnectionFailure } = await importManager();

    reportRpcConnectionFailure(new Error("SocketCloseError: 1006"));

    expect(getConnectionState()).toMatchObject({
      autoRetrying: true,
      issue: {
        title: "Local server connection lost",
        detail: "SocketCloseError: 1006",
      },
    });
  });

  it("finds stringified socket errors wrapped in an Error cause", async () => {
    installBrowserTimerStub();

    const { getConnectionState, reportRpcConnectionFailure } = await importManager();

    reportRpcConnectionFailure(new Error("Collection sync failed", {
      cause: new Error("SocketOpenError: timeout waiting for open"),
    }));

    expect(getConnectionState()).toMatchObject({
      autoRetrying: true,
      issue: {
        title: "Local server unavailable",
        detail: "SocketOpenError: timeout waiting for open",
      },
    });
  });
});
