import type { Integration } from "../types";

/**
 * Browser-side OTLP using `@opentelemetry/sdk-trace-web` + the logs
 * OTLP HTTP exporter. The snippet keeps the surface minimal — a single
 * `initTelemetry()` call at the top of the bundle entry point and
 * `logger.emit(...)` / `tracer.startSpan(...)` after that.
 *
 * The browser also enables CORS on `/ingest/otlp/*`, so no extra proxy
 * setup is required for local dev.
 */
const browserOtlp: Integration = {
  id: "browser-otlp",
  language: "browser",
  library: {
    id: "opentelemetry-web",
    label: "OpenTelemetry Web",
    homepageUrl: "https://opentelemetry.io/docs/languages/js/getting-started/browser/",
  },
  protocol: "otlp-http",
  signals: ["logs", "traces"],
  summary:
    "Export frontend logs and spans straight to Lensflare using the OpenTelemetry web SDK.",
  steps: [
    {
      title: "Install the browser OTel packages",
      body: "`sdk-trace-web` and `sdk-logs` are the browser-friendly counterparts to the Node SDK. The OTLP HTTP exporters work unchanged in both environments.",
      snippet: {
        lang: "bash",
        code: "npm install @opentelemetry/api @opentelemetry/api-logs \\\n  @opentelemetry/sdk-trace-web @opentelemetry/sdk-logs \\\n  @opentelemetry/exporter-trace-otlp-http \\\n  @opentelemetry/exporter-logs-otlp-http \\\n  @opentelemetry/resources",
      },
    },
    {
      title: "Initialise OTel at the top of your entry module",
      body: "Call `initTelemetry()` as early as possible so instrumentation sees every subsequent request. The batch processors flush automatically on `pagehide`.",
      snippet: {
        lang: "ts",
        filename: "telemetry.ts",
        code: `import { logs } from "@opentelemetry/api-logs";
import { trace } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { WebTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-web";

export function initTelemetry() {
  const resource = resourceFromAttributes({
    "service.name": "my-web-app",
    "browser.user_agent": navigator.userAgent,
  });

  const tracerProvider = new WebTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: "{{serverOrigin}}/ingest/otlp/v1/traces/{{projectSlug}}/{{datasetSlug}}",
        }),
      ),
    ],
  });
  tracerProvider.register();

  const loggerProvider = new LoggerProvider({ resource });
  loggerProvider.addLogRecordProcessor(
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: "{{serverOrigin}}/ingest/otlp/v1/logs/{{projectSlug}}/{{datasetSlug}}",
      }),
    ),
  );
  logs.setGlobalLoggerProvider(loggerProvider);
}
`,
      },
    },
    {
      title: "Emit events from anywhere in the app",
      body: "Once `initTelemetry()` has run, the global trace and logs APIs route through Lensflare. No per-call configuration is needed.",
      snippet: {
        lang: "ts",
        code: `import { logs } from "@opentelemetry/api-logs";
import { trace } from "@opentelemetry/api";
import { initTelemetry } from "./telemetry";

initTelemetry();

const tracer = trace.getTracer("my-web-app");
const logger = logs.getLogger("my-web-app");

const span = tracer.startSpan("checkout-click");
try {
  logger.emit({
    severityText: "INFO",
    body: "User clicked checkout",
    attributes: { variant: "A" },
  });
} finally {
  span.end();
}
`,
      },
    },
  ],
  verifyHint:
    "Open DevTools → Network and confirm the POST to `/ingest/otlp/v1/*` returns 200. Once it does, the live tab will populate.",
};

export default browserOtlp;
