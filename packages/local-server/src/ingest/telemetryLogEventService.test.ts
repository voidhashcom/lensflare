import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream, Duration } from "effect";
import { TestClock } from "effect/testing";
import { TelemetryLogEventService } from "./telemetryLogEventService.ts";
import type {
  IngestWriteRequest,
  NormalizedLogRecord,
  NormalizedSpanRecord,
  SpanIngestWriteRequest,
  WrittenLogRecord,
  WrittenSpanRecord,
} from "./types.ts";

describe("TelemetryLogEventService", () => {
  it.effect("buffers telemetry events until the cooldown and emits them sorted", () =>
    Effect.gen(function* () {
      const service = yield* TelemetryLogEventService;
      const fiber = yield* service
        .streamDatasetTelemetry("project", "dataset")
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);

      yield* service.publishBatch(logRequest(), [
        writtenLog("log-late", timestampAtMs(10), "log late"),
      ]);
      yield* service.publishSpanBatch(spanRequest(), [
        writtenSpan("span-early", timestampAtMs(5), "span early"),
      ]);

      yield* TestClock.adjust(Duration.millis(35));

      const events = Array.from(yield* Fiber.join(fiber));
      expect(events.map((event) => event.id)).toEqual(["span-early", "log-late"]);
    }).pipe(
      Effect.provide(
        TelemetryLogEventService.layerWithOptions({
          cooldownMs: 20,
          flushIntervalMs: 5,
        }),
      ),
    ));
});

function timestampAtMs(ms: number): string {
  return new Date(ms).toISOString();
}

function logRequest(): IngestWriteRequest {
  return {
    providerKind: "otlp_http_logs",
    signal: "logs",
    projectId: "project",
    projectSlug: "project",
    datasetId: "dataset",
    datasetSlug: "dataset",
    requestContentType: "application/json",
    requestContentEncoding: null,
    requestBytes: 1,
    clientAddr: null,
    receivedAt: timestampAtMs(0),
    records: [],
  };
}

function spanRequest(): SpanIngestWriteRequest {
  return {
    providerKind: "otlp_http_traces",
    signal: "traces",
    projectId: "project",
    projectSlug: "project",
    datasetId: "dataset",
    datasetSlug: "dataset",
    requestContentType: "application/json",
    requestContentEncoding: null,
    requestBytes: 1,
    clientAddr: null,
    receivedAt: timestampAtMs(0),
    spans: [],
  };
}

function writtenLog(id: string, timestamp: string, body: string): WrittenLogRecord {
  return {
    id,
    record: {
      timestamp,
      observedTimestamp: null,
      traceId: "",
      spanId: "",
      traceFlags: 0,
      severityNumber: 9,
      severityText: "INFO",
      serviceName: "api",
      body,
      resourceSchemaUrl: "",
      resourceAttributes: {},
      scopeSchemaUrl: "",
      scopeName: "test",
      scopeVersion: "1.0.0",
      scopeAttributes: {},
      logAttributes: {},
    } satisfies NormalizedLogRecord,
  };
}

function writtenSpan(id: string, timestamp: string, name: string): WrittenSpanRecord {
  return {
    id,
    record: {
      traceId: `trace-${id}`,
      spanId: `span-${id}`,
      parentSpanId: "",
      traceState: "",
      timestamp,
      spanName: name,
      spanKind: "internal",
      serviceName: "api",
      resourceAttributes: {},
      scopeName: "test",
      scopeVersion: "1.0.0",
      spanAttributes: {},
      durationNs: 1_000_000,
      statusCode: "Ok",
      statusMessage: "",
      events: [],
      links: [],
    } satisfies NormalizedSpanRecord,
  };
}
