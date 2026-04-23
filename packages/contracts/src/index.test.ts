import { describe, expect, it } from "vite-plus/test";
import {
  decodeLensflareEnvironmentDescriptor,
  decodeServerEvent,
  decodeServerSnapshot,
} from "./index.ts";

describe("@lensflare/contracts", () => {
  it("decodes a server snapshot", () => {
    const snapshot = decodeServerSnapshot({
      name: "Lensflare",
      version: "0.1.0",
      mode: "desktop",
      platform: "darwin",
      hostname: "127.0.0.1",
      port: 43110,
      origin: "http://127.0.0.1:43110",
      startedAt: "2026-04-21T10:00:00.000Z",
      uptimeMs: 42,
      staticAssetMode: "embedded",
    });

    expect(snapshot.port).toBe(43110);
    expect(snapshot.mode).toBe("desktop");
  });

  it("decodes a server event", () => {
    const event = decodeServerEvent({
      type: "server.ready",
      sentAt: "2026-04-21T10:00:00.000Z",
      detail: "server booted",
      snapshot: {
        name: "Lensflare",
        version: "0.1.0",
        mode: "server",
        platform: "linux",
        hostname: "127.0.0.1",
        port: 43110,
        origin: "http://127.0.0.1:43110",
        startedAt: "2026-04-21T10:00:00.000Z",
        uptimeMs: 100,
        staticAssetMode: "filesystem",
      },
    });

    expect(event.type).toBe("server.ready");
    expect(event.snapshot.staticAssetMode).toBe("filesystem");
  });

  it("decodes an environment descriptor", () => {
    const descriptor = decodeLensflareEnvironmentDescriptor({
      appName: "Lensflare",
      appVersion: "0.1.0",
      mode: "desktop",
      platform: "darwin",
      host: "127.0.0.1",
      port: 43110,
      httpBaseUrl: "http://127.0.0.1:43110",
      wsBaseUrl: "ws://127.0.0.1:43110",
      serverInstanceId: "abc123",
      startedAt: "2026-04-21T10:00:00.000Z",
    });

    expect(descriptor.serverInstanceId).toBe("abc123");
    expect(descriptor.mode).toBe("desktop");
    expect(descriptor.wsBaseUrl).toBe("ws://127.0.0.1:43110");
  });
});
