import type { Integration } from "../types";

/**
 * Effect-ts via the official `@effect/opentelemetry` package. Effect ships
 * first-class OTel layers, so the snippet wires the standard
 * `@opentelemetry/exporter-*-otlp-http` exporters into `NodeSdk.layer`
 * and lets every `Effect.log` / `Effect.withSpan` flow through unchanged.
 *
 * The shape mirrors the plain Node + OpenTelemetry SDK entry so a user
 * who already has an OTel-instrumented service can drop the layer in
 * without rewiring exporter URLs.
 */
const effectOpenTelemetry: Integration = {
  id: "effect-opentelemetry",
  language: "effect",
  library: {
    id: "opentelemetry-sdk",
    label: "OpenTelemetry SDK",
    homepageUrl: "https://effect.website/docs/observability/telemetry/",
    logo: "opentelemetry",
  },
  protocol: "otlp-http",
  signals: ["logs", "traces"],
  summary:
    "Use Effect's built-in OpenTelemetry support to send logs and spans straight to Lensflare over OTLP HTTP.",
  steps: [
    {
      title: "Install Effect + OpenTelemetry packages",
      body: "`@effect/opentelemetry` provides the Effect-friendly layer; the OTLP exporter packages are the standard ones from the OpenTelemetry SDK.",
      snippet: {
        lang: "bash",
        code: "pnpm add effect @effect/opentelemetry \\\n  @opentelemetry/sdk-trace-base \\\n  @opentelemetry/sdk-logs \\\n  @opentelemetry/exporter-trace-otlp-http \\\n  @opentelemetry/exporter-logs-otlp-http",
      },
    },
    {
      title: "Create production and Lensflare dev configs",
      body: "`NodeSdk.layer` wires the OTel SDK into your Effect runtime. Pick the Lensflare endpoints in development and your production collector otherwise.",
      snippet: {
        lang: "ts",
        filename: "tracing.ts",
        code: `import { NodeSdk } from "@effect/opentelemetry";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

const isDevelopment = true;

const productionConfig = {
  serviceName: "my-service",
  serviceVersion: "0.1.0",
  logsUrl: "https://otel-collector.example.com/v1/logs",
  tracesUrl: "https://otel-collector.example.com/v1/traces",
};

const lensflareDevConfig = {
  serviceName: "my-service",
  serviceVersion: "0.1.0",
  logsUrl: "{{serverOrigin}}/ingest/otlp/v1/logs/{{datasetSlug}}",
  tracesUrl: "{{serverOrigin}}/ingest/otlp/v1/traces/{{datasetSlug}}",
};

const config = isDevelopment ? lensflareDevConfig : productionConfig;

export const TracingLive = NodeSdk.layer(() => ({
  resource: {
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
  },
  spanProcessor: new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: config.tracesUrl,
    }),
  ),
  logRecordProcessor: new BatchLogRecordProcessor(
    new OTLPLogExporter({
      url: config.logsUrl,
    }),
  ),
}));
`,
      },
    },
    {
      title: "Provide the layer to your program",
      body: "Once `TracingLive` is merged in, every `Effect.log`, `Effect.withSpan`, and `Effect.annotateLogs` call flows through the active OTLP exporters. No other code changes are needed.",
      snippet: {
        lang: "ts",
        code: `import { Effect } from "effect";
import { TracingLive } from "./tracing";

const program = Effect.gen(function* () {
  yield* Effect.log("Service starting");
});

Effect.runPromise(program.pipe(Effect.provide(TracingLive)));
`,
      },
      note: "Set `isDevelopment` from your app's existing runtime config.",
    },
  ],
  verifyHint:
    "Run your Effect program in development — both logs and spans should land in this dataset within a few seconds.",
};

export default effectOpenTelemetry;
