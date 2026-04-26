import { describe, expect, it } from "@effect/vitest";
import { Lensflare, resolveLayerConfig } from "./index.ts";

describe("@lensflare.dev/effect", () => {
  it("is disabled in production by default", () => {
    expect(Lensflare.isEnabled({ env: { NODE_ENV: "production" } })).toBe(false);
  });

  it("can be forced on or off with LENSFLARE_ENABLED", () => {
    expect(Lensflare.isEnabled({ env: { NODE_ENV: "production", LENSFLARE_ENABLED: "1" } })).toBe(
      true,
    );
    expect(Lensflare.isEnabled({ env: { NODE_ENV: "development", LENSFLARE_ENABLED: "0" } })).toBe(
      false,
    );
  });

  it("builds Lensflare OTLP endpoints from the dataset slug", () => {
    const config = resolveLayerConfig("api-dev", {
      env: { NODE_ENV: "development" },
      serverOrigin: "http://localhost:43110/",
      serviceName: "api",
      serviceVersion: "1.2.3",
    });

    expect(config.enabled).toBe(true);
    expect(config.logsUrl).toBe("http://localhost:43110/ingest/otlp/v1/logs/api-dev");
    expect(config.tracesUrl).toBe("http://localhost:43110/ingest/otlp/v1/traces/api-dev");
    expect(config.resource.serviceName).toBe("api");
    expect(config.resource.serviceVersion).toBe("1.2.3");
    expect(config.resource.attributes["lensflare.dataset_slug"]).toBe("api-dev");
  });
});
