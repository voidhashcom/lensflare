import {
  evaluateFilter,
  type FilterNode,
  type TelemetryLogEntry,
  type TelemetryLogLevel,
  type TelemetryRecord,
  type TelemetrySpanRecord,
} from "@lensflare/contracts";
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import type {
  IngestWriteRequest,
  NormalizedLogRecord,
  SpanIngestWriteRequest,
  WrittenLogRecord,
  WrittenSpanRecord,
} from "./types.ts";

interface TelemetryEvent {
  readonly projectId: string;
  readonly datasetId: string;
  readonly entry: TelemetryRecord;
}

function toTimestamp(raw: string | null, fallback: string): string {
  const parsed = new Date(raw ?? fallback);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function toLevel(record: NormalizedLogRecord): TelemetryLogLevel {
  const severityText = record.severityText.trim().toLowerCase();
  if (severityText === "fatal") {
    return "fatal";
  }
  if (severityText === "error") {
    return "error";
  }
  if (severityText === "warn" || severityText === "warning") {
    return "warn";
  }
  if (severityText === "info") {
    return "info";
  }
  if (severityText === "debug") {
    return "debug";
  }
  if (severityText === "trace") {
    return "trace";
  }

  const severityNumber = record.severityNumber;
  if (severityNumber >= 21) {
    return "fatal";
  }
  if (severityNumber >= 17) {
    return "error";
  }
  if (severityNumber >= 13) {
    return "warn";
  }
  if (severityNumber >= 9) {
    return "info";
  }
  if (severityNumber >= 5) {
    return "debug";
  }
  return "trace";
}

/**
 * Best-effort JSON decode for the OTLP attribute map persisted alongside each
 * row. We tolerate malformed blobs (returning `{}`) because the live stream
 * should keep flowing even if an upstream producer sends weird payloads — the
 * caller can still filter on non-attribute fields.
 */
function toApiAttributes(attributes: Readonly<Record<string, string>>): Readonly<Record<string, unknown>> {
  return attributes;
}

function nullableId(value: string): string | null {
  return value.length === 0 ? null : value;
}

function toTelemetryLogEntry(request: IngestWriteRequest, written: WrittenLogRecord): TelemetryLogEntry {
  const record = written.record;

  return {
    id: written.id,
    timestamp: toTimestamp(record.timestamp, request.receivedAt),
    sourceName: record.serviceName || request.datasetSlug || request.providerKind,
    level: toLevel(record),
    message: record.body,
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    serviceName: record.serviceName || null,
    traceId: nullableId(record.traceId),
    spanId: nullableId(record.spanId),
    attributes: toApiAttributes(record.logAttributes),
  };
}

function toTelemetryLogRecord(request: IngestWriteRequest, written: WrittenLogRecord): TelemetryRecord {
  return {
    kind: "log",
    ...toTelemetryLogEntry(request, written),
  };
}

function toSpanStatus(statusCode: string): TelemetrySpanRecord["status"] {
  if (statusCode === "Error") {
    return "error";
  }
  if (statusCode === "Ok") {
    return "ok";
  }
  return "unset";
}

function durationUs(durationNs: number): number {
  return Math.floor(durationNs / 1_000);
}

function toTelemetrySpanRecord(
  request: SpanIngestWriteRequest,
  written: WrittenSpanRecord,
): TelemetryRecord {
  const record = written.record;
  return {
    id: written.id,
    kind: "span",
    timestamp: toTimestamp(record.timestamp, request.receivedAt),
    sourceName: record.serviceName || request.datasetSlug || request.providerKind,
    traceId: record.traceId,
    spanId: record.spanId,
    parentSpanId: record.parentSpanId.length > 0 ? record.parentSpanId : null,
    name: record.spanName,
    serviceName: record.serviceName || null,
    status: toSpanStatus(record.statusCode),
    statusMessage: record.statusMessage,
    durationUs: durationUs(record.durationNs),
    attributes: toApiAttributes(record.spanAttributes),
    events: record.events.map((event, index) => ({
      id: `${written.id}:event:${index}`,
      timestamp: event.timestamp,
      name: event.name,
      attributes: toApiAttributes(event.attributes),
    })),
  };
}

function toTelemetrySpanEventRecord(
  request: SpanIngestWriteRequest,
  written: WrittenSpanRecord,
  eventIndex: number,
): TelemetryRecord {
  const span = written.record;
  const record = span.events[eventIndex];
  if (record === undefined) {
    throw new Error("span event index out of bounds");
  }
  return {
    id: `${written.id}:event:${eventIndex}`,
    kind: "spanEvent",
    timestamp: toTimestamp(record.timestamp, request.receivedAt),
    sourceName: span.serviceName || request.datasetSlug || request.providerKind,
    traceId: span.traceId,
    spanId: span.spanId,
    name: record.name,
    serviceName: span.serviceName || null,
    attributes: toApiAttributes(record.attributes),
  };
}

export class TelemetryLogEventService extends Context.Service<
  TelemetryLogEventService,
  {
    readonly publishBatch: (
      request: IngestWriteRequest,
      records: ReadonlyArray<WrittenLogRecord>,
    ) => Effect.Effect<void>;
    readonly publishSpanBatch: (
      request: SpanIngestWriteRequest,
      records: ReadonlyArray<WrittenSpanRecord>,
    ) => Effect.Effect<void>;
    readonly streamDatasetLogs: (
      projectId: string,
      datasetId: string,
      filter?: FilterNode | undefined,
    ) => Stream.Stream<TelemetryLogEntry>;
    readonly streamDatasetTelemetry: (
      projectId: string,
      datasetId: string,
      filter?: FilterNode | undefined,
    ) => Stream.Stream<TelemetryRecord>;
  }
>()("@lensflare/local-server/TelemetryLogEventService") {
  static readonly layer = Layer.effect(
    TelemetryLogEventService,
    Effect.gen(function* () {
      const pubsub = yield* PubSub.unbounded<TelemetryEvent>();
      const stream = Stream.fromPubSub(pubsub);

      const publishBatch = Effect.fn("TelemetryLogEventService.publishBatch")(function* (
        request: IngestWriteRequest,
        records: ReadonlyArray<WrittenLogRecord>,
      ) {
        yield* Effect.forEach(
          records,
          (record) =>
            PubSub.publish(pubsub, {
              projectId: request.projectId,
                datasetId: request.datasetId,
              entry: toTelemetryLogRecord(request, record),
            }),
          { discard: true },
        );
      });

      const publishSpanBatch = Effect.fn("TelemetryLogEventService.publishSpanBatch")(function* (
        request: SpanIngestWriteRequest,
        records: ReadonlyArray<WrittenSpanRecord>,
      ) {
        const spanEvents = records.flatMap((record) =>
          record.record.events.map((_, index) => toTelemetrySpanEventRecord(request, record, index)),
        );
        yield* Effect.forEach(
          [
            ...records.map((record) => toTelemetrySpanRecord(request, record)),
            ...spanEvents,
          ],
          (entry) =>
            PubSub.publish(pubsub, {
              projectId: request.projectId,
              datasetId: request.datasetId,
              entry,
            }),
          { discard: true },
        );
      });

      const streamDatasetLogs = (
        projectId: string,
        datasetId: string,
        filter?: FilterNode | undefined,
      ) => {
        const byDataset = stream.pipe(
          Stream.filter(
            (event) => event.projectId === projectId && event.datasetId === datasetId,
          ),
          Stream.map((event) => event.entry),
          Stream.filter((entry): entry is TelemetryRecord & { readonly kind: "log" } => entry.kind === "log"),
        );
        return filter === undefined
          ? byDataset
          : byDataset.pipe(Stream.filter((entry) => evaluateFilter(filter, entry)));
      };

      const streamDatasetTelemetry = (
        projectId: string,
        datasetId: string,
        filter?: FilterNode | undefined,
      ) => {
        const byDataset = stream.pipe(
          Stream.filter(
            (event) => event.projectId === projectId && event.datasetId === datasetId,
          ),
          Stream.map((event) => event.entry),
        );
        return filter === undefined
          ? byDataset
          : byDataset.pipe(Stream.filter((entry) => evaluateFilter(filter, entry)));
      };

      return TelemetryLogEventService.of({
        publishBatch,
        publishSpanBatch,
        streamDatasetLogs,
        streamDatasetTelemetry,
      });
    }),
  );
}
