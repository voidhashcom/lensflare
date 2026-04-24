import type { Integration } from "../types";

/**
 * Node.js + the official OpenTelemetry SDK. The SDK's batch exporters use
 * protobuf by default but the Lensflare OTLP ingest accepts both JSON and
 * protobuf — this guide sticks with protobuf so the snippet matches the
 * `@opentelemetry/exporter-*-otlp-http` defaults and there's no need to
 * wire `protocol: "http/json"` into the exporter config.
 */
const nodeOpenTelemetry: Integration = {
  id: "node-opentelemetry",
  language: "node",
  library: {
    id: "opentelemetry-sdk",
    label: "OpenTelemetry SDK",
    homepageUrl: "https://opentelemetry.io/docs/languages/js/",
  },
  protocol: "otlp-http",
  signals: ["logs", "traces"],
  summary:
    "Send structured logs and spans from a Node service using the official OpenTelemetry SDK over OTLP HTTP.",
  steps: [
    {
      title: "Install the OpenTelemetry SDK",
      body: "The SDK package pulls in the API, resource, and batch processors. The two exporter packages send logs and traces over OTLP HTTP.",
      snippet: {
        lang: "bash",
        code: "npm install @opentelemetry/sdk-node \\\n  @opentelemetry/exporter-logs-otlp-http \\\n  @opentelemetry/exporter-trace-otlp-http",
      },
    },
    {
      title: "Create an `otel.ts` bootstrap",
      body: "Point the two OTLP exporters at the Lensflare ingest routes. The slugs are baked into the URL; there's no auth header to set.",
      snippet: {
        lang: "ts",
        filename: "otel.ts",
        code: `import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    "service.name": "my-service",
    "service.version": "0.1.0",
  }),
  logRecordProcessor: new BatchLogRecordProcessor(
    new OTLPLogExporter({
      url: "{{serverOrigin}}/ingest/otlp/v1/logs/{{projectSlug}}/{{datasetSlug}}",
    }),
  ),
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: "{{serverOrigin}}/ingest/otlp/v1/traces/{{projectSlug}}/{{datasetSlug}}",
      }),
    ),
  ],
});

sdk.start();

process.on("SIGTERM", () => {
  void sdk.shutdown();
});
`,
      },
    },
    {
      title: "Require the bootstrap before your app starts",
      body: "Loading the SDK before any instrumented library imports is what lets the auto-instrumentations patch them. Add this to your node invocation or your entry file.",
      snippet: {
        lang: "bash",
        code: "node --require ./otel.js ./dist/index.js",
      },
      note: "If you're using ESM, use `--import ./otel.js` (Node 20.6+) instead of `--require`.",
    },
  ],
  verifyHint:
    "Start your service — this screen will switch to the live log table as soon as the first batch lands.",
};

export default nodeOpenTelemetry;
