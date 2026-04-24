import {
  evaluateFilter,
  type FilterNode,
  type TelemetryLogEntry,
  type TelemetryLogLevel,
  type TelemetryRecord,
  type TelemetrySpanRecord,
} from "@lensflare/contracts";
import { Clock, Context, Duration, Effect, Layer, PubSub, Schedule, Stream } from "effect";
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

interface BufferedTelemetryEvent extends TelemetryEvent {
  readonly receivedAtMs: number;
}

interface TelemetryEventBufferOptions {
  readonly cooldownMs?: number;
  readonly flushIntervalMs?: number;
}

const TELEMETRY_EVENT_COOLDOWN_MS = 2_000;
const TELEMETRY_EVENT_FLUSH_INTERVAL_MS = 100;

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

function telemetryEventKey(event: TelemetryEvent): string {
  return `${event.projectId}:${event.datasetId}:${event.entry.id}`;
}

function telemetryEventTimeMs(event: BufferedTelemetryEvent): number {
  const parsed = Date.parse(event.entry.timestamp);
  return Number.isNaN(parsed) ? event.receivedAtMs : parsed;
}

function normalizeTimestampForSort(timestamp: string): string {
  const trimmed = timestamp.trim();
  const match =
    /^(?<prefix>.+[T ]\d{2}:\d{2}:\d{2})(?:\.(?<fraction>\d+))?(?<zone>Z|[+-]\d{2}:?\d{2})?$/u.exec(
      trimmed,
    );
  if (!match?.groups) {
    return trimmed;
  }

  const prefix = match.groups.prefix;
  if (prefix === undefined) {
    return trimmed;
  }

  const fraction = (match.groups.fraction ?? "").padEnd(9, "0").slice(0, 9);
  return `${prefix.replace(" ", "T")}.${fraction}${match.groups.zone ?? "Z"}`;
}

function compareBufferedTelemetryEvents(
  left: BufferedTelemetryEvent,
  right: BufferedTelemetryEvent,
): number {
  const timestampDelta = telemetryEventTimeMs(left) - telemetryEventTimeMs(right);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  const timestampComparison = normalizeTimestampForSort(left.entry.timestamp).localeCompare(
    normalizeTimestampForSort(right.entry.timestamp),
  );
  if (timestampComparison !== 0) {
    return timestampComparison;
  }

  return left.entry.id.localeCompare(right.entry.id);
}

function mergeBufferedTelemetryEvents(
  current: ReadonlyArray<BufferedTelemetryEvent>,
  incoming: ReadonlyArray<BufferedTelemetryEvent>,
): ReadonlyArray<BufferedTelemetryEvent> {
  const byKey = new Map<string, BufferedTelemetryEvent>();
  for (const event of current) {
    byKey.set(telemetryEventKey(event), event);
  }
  for (const event of incoming) {
    const existing = byKey.get(telemetryEventKey(event));
    byKey.set(telemetryEventKey(event), {
      ...event,
      receivedAtMs: existing?.receivedAtMs ?? event.receivedAtMs,
    });
  }
  return [...byKey.values()].sort(compareBufferedTelemetryEvents);
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
  static layerWithOptions(options: TelemetryEventBufferOptions = {}) {
    const cooldownMs = options.cooldownMs ?? TELEMETRY_EVENT_COOLDOWN_MS;
    const flushIntervalMs = options.flushIntervalMs ?? TELEMETRY_EVENT_FLUSH_INTERVAL_MS;

    return Layer.effect(
      TelemetryLogEventService,
      Effect.gen(function* () {
        const pubsub = yield* PubSub.unbounded<TelemetryEvent>();
        const stream = Stream.fromPubSub(pubsub);
        let bufferedEvents: ReadonlyArray<BufferedTelemetryEvent> = [];

        yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub));

        const enqueueEvents = Effect.fn("TelemetryLogEventService.enqueueEvents")(function* (
          events: ReadonlyArray<TelemetryEvent>,
        ) {
          const receivedAtMs = yield* Clock.currentTimeMillis;
          bufferedEvents = mergeBufferedTelemetryEvents(
            bufferedEvents,
            events.map((event) => ({ ...event, receivedAtMs })),
          );
        });

        const flushReadyEvents = Effect.fn("TelemetryLogEventService.flushReadyEvents")(function* () {
          const nowMs = yield* Clock.currentTimeMillis;
          const cutoffMs = nowMs - cooldownMs;
          const readyEvents = yield* Effect.sync(() => {
            const ready: Array<BufferedTelemetryEvent> = [];
            const pending: Array<BufferedTelemetryEvent> = [];

            for (const event of bufferedEvents) {
              if (telemetryEventTimeMs(event) <= cutoffMs) {
                ready.push(event);
              } else {
                pending.push(event);
              }
            }

            bufferedEvents = pending;
            return ready.sort(compareBufferedTelemetryEvents);
          });

          if (readyEvents.length === 0) {
            return;
          }

          yield* PubSub.publishAll(
            pubsub,
            readyEvents.map((event) => ({
              projectId: event.projectId,
              datasetId: event.datasetId,
              entry: event.entry,
            })),
          ).pipe(Effect.asVoid);
        });

        yield* flushReadyEvents().pipe(
          Effect.repeat(Schedule.spaced(Duration.millis(flushIntervalMs))),
          Effect.forkScoped({ startImmediately: true }),
        );

        const publishBatch = Effect.fn("TelemetryLogEventService.publishBatch")(function* (
          request: IngestWriteRequest,
          records: ReadonlyArray<WrittenLogRecord>,
        ) {
          yield* enqueueEvents(
            records.map((record) => ({
              projectId: request.projectId,
              datasetId: request.datasetId,
              entry: toTelemetryLogRecord(request, record),
            })),
          );
        });

        const publishSpanBatch = Effect.fn("TelemetryLogEventService.publishSpanBatch")(function* (
          request: SpanIngestWriteRequest,
          records: ReadonlyArray<WrittenSpanRecord>,
        ) {
          const spanEvents = records.flatMap((record) =>
            record.record.events.map((_, index) => toTelemetrySpanEventRecord(request, record, index)),
          );
          yield* enqueueEvents(
            [
              ...records.map((record) => toTelemetrySpanRecord(request, record)),
              ...spanEvents,
            ].map((entry) => ({
              projectId: request.projectId,
              datasetId: request.datasetId,
              entry,
            })),
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

  static readonly layer = TelemetryLogEventService.layerWithOptions();
}
