import type { Integration } from "../types";

/**
 * Go + the OpenTelemetry SDK using the `otelslog` bridge for logs and the
 * native tracer provider for spans. `otlploghttp` and `otlptracehttp`
 * match Lensflare's OTLP HTTP ingest. We use `WithEndpointURL` so the
 * entire path — not just the host — is copied from the template var.
 */
const goOpenTelemetry: Integration = {
  id: "go-opentelemetry",
  language: "go",
  library: {
    id: "opentelemetry-sdk",
    label: "OpenTelemetry SDK",
    homepageUrl: "https://opentelemetry.io/docs/languages/go/",
  },
  protocol: "otlp-http",
  signals: ["logs", "traces"],
  summary:
    "Use the Go OpenTelemetry SDK with `log/slog` to ship structured logs and traces over OTLP HTTP.",
  steps: [
    {
      title: "Install the required modules",
      body: "`otelslog` bridges the standard-library `log/slog` package into the OpenTelemetry log pipeline. `otlploghttp` and `otlptracehttp` handle the export.",
      snippet: {
        lang: "bash",
        code: `go get go.opentelemetry.io/otel \\
  go.opentelemetry.io/otel/sdk/log \\
  go.opentelemetry.io/otel/sdk/trace \\
  go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp \\
  go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp \\
  go.opentelemetry.io/contrib/bridges/otelslog`,
      },
    },
    {
      title: "Create a `telemetry.go` initialiser",
      body: "`WithEndpointURL` takes the full URL including the slug path, matching the shape Lensflare expects.",
      snippet: {
        lang: "go",
        filename: "telemetry.go",
        code: `package main

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func initTelemetry(ctx context.Context) (func(context.Context) error, error) {
	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName("my-service"),
		),
	)
	if err != nil {
		return nil, err
	}

	traceExp, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL(
			"{{serverOrigin}}/ingest/otlp/v1/traces/{{datasetSlug}}",
		),
	)
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(traceExp),
	)
	otel.SetTracerProvider(tp)

	logExp, err := otlploghttp.New(ctx,
		otlploghttp.WithEndpointURL(
			"{{serverOrigin}}/ingest/otlp/v1/logs/{{datasetSlug}}",
		),
	)
	if err != nil {
		return nil, err
	}
	lp := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(logExp)),
	)

	slog.SetDefault(otelslog.NewLogger("my-service",
		otelslog.WithLoggerProvider(lp),
	))

	return func(ctx context.Context) error {
		_ = tp.Shutdown(ctx)
		return lp.Shutdown(ctx)
	}, nil
}
`,
      },
    },
    {
      title: "Log and trace from `main`",
      body: "Defer the shutdown returned by `initTelemetry` so the final batch is flushed. After that, every `slog` call lands in Lensflare.",
      snippet: {
        lang: "go",
        code: `package main

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel"
)

func main() {
	ctx := context.Background()
	shutdown, err := initTelemetry(ctx)
	if err != nil {
		panic(err)
	}
	defer func() { _ = shutdown(ctx) }()

	tracer := otel.Tracer("my-service")
	ctx, span := tracer.Start(ctx, "checkout")
	defer span.End()

	slog.InfoContext(ctx, "Starting checkout", "user_id", 42)
}
`,
      },
    },
  ],
};

export default goOpenTelemetry;
