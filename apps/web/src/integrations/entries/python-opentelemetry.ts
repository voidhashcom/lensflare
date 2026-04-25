import type { Integration } from "../types";

/**
 * Python + the OpenTelemetry SDK. Uses the HTTP/protobuf exporter because
 * that's the officially supported "batteries included" path — users who
 * need gRPC can swap the exporter package without changing the rest of
 * the flow.
 */
const pythonOpenTelemetry: Integration = {
  id: "python-opentelemetry",
  language: "python",
  library: {
    id: "opentelemetry-sdk",
    label: "OpenTelemetry SDK",
    homepageUrl: "https://opentelemetry.io/docs/languages/python/",
  },
  protocol: "otlp-http",
  signals: ["logs", "traces"],
  summary:
    "Export Python logs and traces over OTLP HTTP using the official OpenTelemetry SDK.",
  steps: [
    {
      title: "Install the SDK + HTTP exporter",
      body: "The `-proto-http` variant ships the protobuf-over-HTTP exporter, matching Lensflare's OTLP ingest.",
      snippet: {
        lang: "bash",
        code: "pip install opentelemetry-sdk \\\n  opentelemetry-exporter-otlp-proto-http",
      },
    },
    {
      title: "Wire the tracer + log provider",
      body: "The two exporters point at the logs and traces endpoints separately — Lensflare ingest URLs embed the slugs, so there's no shared base endpoint env var.",
      snippet: {
        lang: "python",
        filename: "telemetry.py",
        code: `from opentelemetry import trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
import logging

resource = Resource.create({"service.name": "my-service"})

# Traces
tracer_provider = TracerProvider(resource=resource)
tracer_provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(
        endpoint="{{serverOrigin}}/ingest/otlp/v1/traces/{{datasetSlug}}",
    ))
)
trace.set_tracer_provider(tracer_provider)

# Logs
logger_provider = LoggerProvider(resource=resource)
logger_provider.add_log_record_processor(
    BatchLogRecordProcessor(OTLPLogExporter(
        endpoint="{{serverOrigin}}/ingest/otlp/v1/logs/{{datasetSlug}}",
    ))
)
set_logger_provider(logger_provider)

# Bridge stdlib logging into OpenTelemetry
logging.getLogger().addHandler(LoggingHandler(logger_provider=logger_provider))
logging.getLogger().setLevel(logging.INFO)
`,
      },
    },
    {
      title: "Emit a log and a span",
      body: "`logging.info(...)` goes through the OTel bridge we set up above. `tracer.start_as_current_span(...)` emits a span once the block exits.",
      snippet: {
        lang: "python",
        code: `import logging
from opentelemetry import trace
import telemetry  # runs the setup

logger = logging.getLogger(__name__)
tracer = trace.get_tracer("my-service")

with tracer.start_as_current_span("checkout"):
    logger.info("Starting checkout", extra={"user_id": 42})
`,
      },
      note:
        "The batch processors flush on interpreter exit. For short-lived scripts, call `tracer_provider.shutdown()` and `logger_provider.shutdown()` explicitly.",
    },
  ],
};

export default pythonOpenTelemetry;
