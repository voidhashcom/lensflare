import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_WEB_DEV_PORT,
  httpUrlToWsUrl,
  normalizeBaseUrl,
  readRuntimeConfigFromEnv,
  resolveServerOrigin,
  resolveWebDevUrl,
  resolveWebSocketOrigin,
  wsUrlToHttpUrl,
} from "./browser.ts";

describe("@lensflare/shared/browser", () => {
  it("falls back to default ports", () => {
    const config = readRuntimeConfigFromEnv({});

    expect(config.serverPort).toBe(DEFAULT_SERVER_PORT);
    expect(config.webDevPort).toBe(DEFAULT_WEB_DEV_PORT);
  });

  it("enables self telemetry defaults only for Lensflare development", () => {
    const productionConfig = readRuntimeConfigFromEnv({});
    const devConfig = readRuntimeConfigFromEnv({ LENSFLARE_DEV: "1" });

    expect(productionConfig.otelEnabled).toBe(false);
    expect(productionConfig.otelProjectSlug).toBe("lensflare");
    expect(productionConfig.otelDatasetSlug).toBe("dev");
    expect(devConfig.lensflareDev).toBe(true);
    expect(devConfig.otelEnabled).toBe(true);
  });

  it("builds stable URLs", () => {
    expect(resolveServerOrigin({ host: "127.0.0.1", serverPort: 43110 })).toBe(
      "http://127.0.0.1:43110",
    );
    expect(resolveWebSocketOrigin("http://127.0.0.1:43110")).toBe("ws://127.0.0.1:43110/");
    expect(resolveWebDevUrl({ host: "localhost", webDevPort: 5173 })).toBe("http://localhost:5173");
  });

  describe("httpUrlToWsUrl", () => {
    it("converts http to ws", () => {
      expect(httpUrlToWsUrl("http://127.0.0.1:43110/")).toBe("ws://127.0.0.1:43110/");
    });

    it("converts https to wss", () => {
      expect(httpUrlToWsUrl("https://example.test/")).toBe("wss://example.test/");
    });

    it("preserves ws/wss inputs", () => {
      expect(httpUrlToWsUrl("ws://127.0.0.1:43110/rpc")).toBe("ws://127.0.0.1:43110/rpc");
      expect(httpUrlToWsUrl("wss://example.test/rpc")).toBe("wss://example.test/rpc");
    });

    it("rejects unsupported protocols", () => {
      expect(() => httpUrlToWsUrl("file:///tmp")).toThrow(/Unsupported base URL protocol/);
    });
  });

  describe("wsUrlToHttpUrl", () => {
    it("converts ws/wss back to http/https", () => {
      expect(wsUrlToHttpUrl("ws://127.0.0.1:43110/")).toBe("http://127.0.0.1:43110/");
      expect(wsUrlToHttpUrl("wss://example.test/")).toBe("https://example.test/");
    });

    it("preserves http/https inputs", () => {
      expect(wsUrlToHttpUrl("http://127.0.0.1:43110/api")).toBe("http://127.0.0.1:43110/api");
    });
  });

  describe("normalizeBaseUrl", () => {
    it("returns absolute URLs verbatim", () => {
      expect(normalizeBaseUrl("http://127.0.0.1:43110/", "http://example.test")).toBe(
        "http://127.0.0.1:43110/",
      );
    });

    it("resolves relative URLs against the provided base", () => {
      expect(normalizeBaseUrl("/rpc", "http://127.0.0.1:43110/anywhere")).toBe(
        "http://127.0.0.1:43110/rpc",
      );
    });
  });
});
