import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BackendReadinessAbortedError,
  BackendReadinessTimeoutError,
  waitForHttpReady,
} from "./backendReadiness.ts";

interface HealthServer {
  readonly server: Server;
  readonly url: string;
  setHealthy(healthy: boolean): void;
  setDelay(ms: number): void;
  stop(): Promise<void>;
}

function startHealthServer(): Promise<HealthServer> {
  return new Promise((resolve, reject) => {
    let healthy = false;
    let delayMs = 0;

    const server = createServer((_req, res) => {
      const respond = () => {
        if (healthy) {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ status: "ok" }));
        } else {
          res.statusCode = 503;
          res.end();
        }
      };

      if (delayMs > 0) {
        setTimeout(respond, delayMs);
      } else {
        respond();
      }
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/api/health`,
        setHealthy(value: boolean) {
          healthy = value;
        },
        setDelay(ms: number) {
          delayMs = ms;
        },
        stop() {
          return new Promise((resolve) => server.close(() => resolve()));
        },
      });
    });
  });
}

describe("waitForHttpReady", () => {
  let healthServer: HealthServer;

  beforeEach(async () => {
    healthServer = await startHealthServer();
  });

  afterEach(async () => {
    await healthServer.stop();
  });

  it("resolves once the server answers 2xx", async () => {
    healthServer.setHealthy(true);

    await expect(
      waitForHttpReady({
        url: healthServer.url,
        timeoutMs: 2_000,
        intervalMs: 20,
      }),
    ).resolves.toBeUndefined();
  });

  it("retries until the server becomes healthy", async () => {
    setTimeout(() => healthServer.setHealthy(true), 120);

    await expect(
      waitForHttpReady({
        url: healthServer.url,
        timeoutMs: 2_000,
        intervalMs: 20,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws BackendReadinessTimeoutError when the budget elapses", async () => {
    healthServer.setHealthy(false);

    await expect(
      waitForHttpReady({
        url: healthServer.url,
        timeoutMs: 150,
        intervalMs: 20,
        requestTimeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(BackendReadinessTimeoutError);
  });

  it("rejects with BackendReadinessAbortedError when the signal aborts", async () => {
    healthServer.setHealthy(false);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 40);

    await expect(
      waitForHttpReady({
        url: healthServer.url,
        timeoutMs: 5_000,
        intervalMs: 20,
        requestTimeoutMs: 50,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(BackendReadinessAbortedError);
  });

  it("treats a slow responder as unhealthy within the per-request timeout", async () => {
    healthServer.setHealthy(true);
    healthServer.setDelay(200);

    await expect(
      waitForHttpReady({
        url: healthServer.url,
        timeoutMs: 300,
        intervalMs: 20,
        requestTimeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(BackendReadinessTimeoutError);
  });
});
