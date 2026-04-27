import { describe, expect, it } from "vite-plus/test";
import { resolveBackendTarget } from "./backendTarget";

describe("resolveBackendTarget", () => {
  const windowOrigin = "http://127.0.0.1:5173";

  it("prefers the desktop bootstrap when present", () => {
    const target = resolveBackendTarget({
      desktopBootstrap: {
        label: "Lensflare 0.1.0",
        httpBaseUrl: "http://127.0.0.1:43110",
        wsBaseUrl: "ws://127.0.0.1:43110",
        serverInstanceId: "server-1",
      },
      configuredHttpUrl: "http://irrelevant:1234",
      configuredWsUrl: "ws://irrelevant:1234",
      windowOrigin,
    });

    expect(target).toEqual({
      source: "desktop-managed",
      httpBaseUrl: "http://127.0.0.1:43110/",
      wsBaseUrl: "ws://127.0.0.1:43110/",
      mcpUrl: "http://127.0.0.1:43110/mcp",
      serverInstanceId: "server-1",
    });
  });

  it("rejects a desktop bootstrap missing base URLs", () => {
    expect(() =>
      resolveBackendTarget({
        desktopBootstrap: {
          label: "Lensflare 0.1.0",
          httpBaseUrl: "",
          wsBaseUrl: "ws://127.0.0.1:43110",
          serverInstanceId: "server-1",
        },
        configuredHttpUrl: undefined,
        configuredWsUrl: undefined,
        windowOrigin,
      }),
    ).toThrow(/httpBaseUrl and wsBaseUrl/);
  });

  it("uses the configured HTTP URL and derives the WS URL", () => {
    const target = resolveBackendTarget({
      desktopBootstrap: null,
      configuredHttpUrl: "http://127.0.0.1:43110",
      configuredWsUrl: undefined,
      windowOrigin,
    });

    expect(target).toEqual({
      source: "configured",
      httpBaseUrl: "http://127.0.0.1:43110/",
      wsBaseUrl: "ws://127.0.0.1:43110/",
      mcpUrl: "http://127.0.0.1:43110/mcp",
    });
  });

  it("uses the configured WS URL and derives the HTTP URL", () => {
    const target = resolveBackendTarget({
      desktopBootstrap: null,
      configuredHttpUrl: undefined,
      configuredWsUrl: "wss://example.com/rpc",
      windowOrigin,
    });

    expect(target).toEqual({
      source: "configured",
      httpBaseUrl: "https://example.com/rpc",
      wsBaseUrl: "wss://example.com/rpc",
      mcpUrl: "https://example.com/mcp",
    });
  });

  it("ignores blank configured URLs", () => {
    const target = resolveBackendTarget({
      desktopBootstrap: null,
      configuredHttpUrl: "   ",
      configuredWsUrl: "",
      windowOrigin,
    });

    expect(target.source).toBe("window-origin");
  });

  it("falls back to the window origin and derives the WS URL", () => {
    const target = resolveBackendTarget({
      desktopBootstrap: null,
      configuredHttpUrl: undefined,
      configuredWsUrl: undefined,
      windowOrigin: "https://lensflare.example.com",
    });

    expect(target).toEqual({
      source: "window-origin",
      httpBaseUrl: "https://lensflare.example.com/",
      wsBaseUrl: "wss://lensflare.example.com/",
      mcpUrl: "https://lensflare.example.com/mcp",
    });
  });
});
