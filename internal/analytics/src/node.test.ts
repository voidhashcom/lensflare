import { afterEach, describe, expect, it, vi } from "vitest";

let captureMock = vi.fn<(...args: Array<unknown>) => Promise<void>>();
let shutdownMock = vi.fn<() => Promise<void>>();

vi.mock("posthog-node", () => ({
  PostHog: class {
    capture(...args: Array<unknown>) {
      return captureMock(...args);
    }

    shutdown() {
      return shutdownMock();
    }
  },
}));

describe("createNodeAnalyticsRecorder", () => {
  afterEach(() => {
    vi.useRealTimers();
    captureMock.mockReset();
    shutdownMock.mockReset();
  });

  it("does not await PostHog capture during app flows", async () => {
    let resolveCapture!: () => void;
    captureMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCapture = resolve;
        }),
    );
    shutdownMock.mockResolvedValue();

    const { createNodeAnalyticsRecorder } = await import("./node.ts");
    const recorder = createNodeAnalyticsRecorder(
      {
        enabled: true,
        apiKey: "phc_test",
        host: "https://us.i.posthog.com",
        debug: false,
        distinctId: "anonymous",
      },
      {
        surface: "server",
        mode: "server",
        platform: "test",
        devMode: false,
      },
    );

    expect(() => recorder.capture("server_started")).not.toThrow();
    expect(captureMock).toHaveBeenCalledOnce();

    resolveCapture?.();
  });

  it("bounds shutdown time when PostHog flush stalls", async () => {
    vi.useFakeTimers();
    captureMock.mockResolvedValue();
    shutdownMock.mockImplementation(() => new Promise<void>(() => {}));

    const { createNodeAnalyticsRecorder } = await import("./node.ts");
    const recorder = createNodeAnalyticsRecorder(
      {
        enabled: true,
        apiKey: "phc_test",
        host: "https://us.i.posthog.com",
        debug: false,
        distinctId: "anonymous",
      },
      {
        surface: "server",
        mode: "server",
        platform: "test",
        devMode: false,
      },
    );

    const shutdown = recorder.shutdown();
    await vi.advanceTimersByTimeAsync(250);
    await expect(shutdown).resolves.toBeUndefined();
    expect(shutdownMock).toHaveBeenCalledOnce();
  });
});
