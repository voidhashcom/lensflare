import { describe, expect, it } from "vitest";
import { decodeServerEvent, decodeServerSnapshot } from "./index.ts";

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
});
