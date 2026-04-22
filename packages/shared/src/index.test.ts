import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_WEB_DEV_PORT,
  readRuntimeConfigFromEnv,
  resolveServerOrigin,
  resolveWebDevUrl,
  resolveWebSocketOrigin,
} from "./index.ts";

describe("@lensflare/shared", () => {
  it("falls back to default ports", () => {
    const config = readRuntimeConfigFromEnv({});

    expect(config.serverPort).toBe(DEFAULT_SERVER_PORT);
    expect(config.webDevPort).toBe(DEFAULT_WEB_DEV_PORT);
  });

  it("builds stable URLs", () => {
    expect(resolveServerOrigin({ host: "127.0.0.1", serverPort: 43110 })).toBe(
      "http://127.0.0.1:43110",
    );
    expect(resolveWebSocketOrigin("http://127.0.0.1:43110")).toBe(
      "ws://127.0.0.1:43110/",
    );
    expect(resolveWebDevUrl({ host: "localhost", webDevPort: 5173 })).toBe(
      "http://localhost:5173",
    );
  });
});
