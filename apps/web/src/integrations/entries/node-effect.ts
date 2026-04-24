import type { Integration } from "../types";

/**
 * Effect-ts via the `@effect/opentelemetry` NodeSdk layer. We dogfood this
 * pattern inside Lensflare itself — the reference implementation lives at
 * `packages/local-server/src/server.ts`, where the local server wires its
 * own tracer and log record processor through the same layer.
 *
 * The snippet intentionally mirrors our internal layer as closely as
 * possible so that a user who copies it into a fresh service ends up with
 * the same shape of batch processors and shutdown hooks Lensflare uses.
 */
const nodeEffect: Integration = {
  id: "node-effect",
  language: "effect",
  library: {
    id: "effect-opentelemetry",
    label: "Effect + OpenTelemetry",
    homepageUrl: "https://effect.website/docs/platform/opentelemetry",
  },
  protocol: "otlp-http",
  signals: ["logs", "traces"],
  summary:
    "Wire Effect's built-in telemetry into OTLP HTTP using the `@effect/opentelemetry` NodeSdk layer. This is the exact pattern Lensflare uses internally.",
  steps: [
    {
      title: "Install the Effect OpenTelemetry bridge",
      body: "The `@effect/opentelemetry` package adapts Effect's tracer/logger to the OpenTelemetry SDK. The two OTLP exporter packages ship the batches over HTTP.",
      snippet: {
        lang: "bash",
        code: "pnpm add effect @effect/opentelemetry \\\n  @opentelemetry/exporter-logs-otlp-http \\\n  @opentelemetry/exporter-trace-otlp-http \\\n  @opentelemetry/sdk-logs \\\n  @opentelemetry/sdk-trace-base",
      },
    },
    {
      title: "Build a `TracingLive` layer",
      body: "`NodeSdk.layer` returns an Effect layer you can compose into your main program. The resource identifies the service; the batch processors handle the OTLP export.",
      snippet: {
        lang: "ts",
        filename: "tracing.ts",
        code: `import { NodeSdk } from "@effect/opentelemetry";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

export const TracingLive = NodeSdk.layer(() => ({
  resource: {
    serviceName: "my-service",
    serviceVersion: "0.1.0",
  },
  logRecordProcessor: new BatchLogRecordProcessor(
    new OTLPLogExporter({
      url: "{{serverOrigin}}/ingest/otlp/v1/logs/{{projectSlug}}/{{datasetSlug}}",
    }),
    { scheduledDelayMillis: 1_000, maxExportBatchSize: 100 },
  ),
  spanProcessor: new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: "{{serverOrigin}}/ingest/otlp/v1/traces/{{projectSlug}}/{{datasetSlug}}",
    }),
    { scheduledDelayMillis: 1_000, maxExportBatchSize: 100 },
  ),
  shutdownTimeout: "250 millis",
}));
`,
      },
      note:
        "Reference implementation lives at `packages/local-server/src/server.ts` in this repo — Lensflare's own local server uses the exact same layer shape.",
    },
    {
      title: "Provide the layer to your program",
      body: "Once `TracingLive` is merged in, every `Effect.log`, `Effect.withSpan`, and `Effect.annotateLogs` call becomes a record in Lensflare. No other code changes are needed.",
      snippet: {
        lang: "ts",
        code: `import { Effect, Layer } from "effect";
import { TracingLive } from "./tracing";

const program = Effect.gen(function* () {
  yield* Effect.log("Service starting");

  yield* Effect.withSpan("handle-request")(
    Effect.gen(function* () {
      yield* Effect.annotateLogs({ userId: "42" });
      yield* Effect.log("Processing request");
    }),
  );
});

Effect.runPromise(program.pipe(Effect.provide(TracingLive)));
`,
      },
    },
  ],
  verifyHint:
    "Run your Effect program — you'll see both logs and spans appear. Spans annotated with `Effect.withSpan` surface as trace entries in the dataset.",
};

export default nodeEffect;
