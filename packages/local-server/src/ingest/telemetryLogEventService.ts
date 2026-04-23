import {
  evaluateFilter,
  type FilterNode,
  type TelemetryLogEntry,
  type TelemetryLogLevel,
} from "@lensflare/contracts";
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import type { IngestWriteRequest, NormalizedLogRecord, WrittenLogRecord } from "./types.ts";

interface TelemetryLogEvent {
  readonly projectId: string;
  readonly datasetId: string;
  readonly entry: TelemetryLogEntry;
}

function toTimestamp(raw: string | null, fallback: string): string {
  const parsed = new Date(raw ?? fallback);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function toLevel(record: NormalizedLogRecord): TelemetryLogLevel {
  const severityText = record.severityText?.trim().toLowerCase();
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

  const severityNumber = record.severityNumber ?? 0;
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
function parseAttributes(raw: string | null): Readonly<Record<string, unknown>> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function toTelemetryLogEntry(request: IngestWriteRequest, written: WrittenLogRecord): TelemetryLogEntry {
  const record = written.record;

  return {
    id: written.id,
    timestamp: toTimestamp(record.timestamp, request.receivedAt),
    sourceName: record.serviceName ?? request.datasetSlug ?? request.providerKind,
    level: toLevel(record),
    message: record.bodyText || record.bodyJson || record.rawRecordJson,
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    serviceName: record.serviceName,
    traceId: record.traceId,
    spanId: record.spanId,
    attributes: parseAttributes(record.attributesJson),
  };
}

export class TelemetryLogEventService extends Context.Service<
  TelemetryLogEventService,
  {
    readonly publishBatch: (
      request: IngestWriteRequest,
      records: ReadonlyArray<WrittenLogRecord>,
    ) => Effect.Effect<void>;
    readonly streamDatasetLogs: (
      projectId: string,
      datasetId: string,
      filter?: FilterNode | undefined,
    ) => Stream.Stream<TelemetryLogEntry>;
  }
>()("@lensflare/local-server/TelemetryLogEventService") {
  static readonly layer = Layer.effect(
    TelemetryLogEventService,
    Effect.gen(function* () {
      const pubsub = yield* PubSub.unbounded<TelemetryLogEvent>();
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
              entry: toTelemetryLogEntry(request, record),
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
        );
        return filter === undefined
          ? byDataset
          : byDataset.pipe(Stream.filter((entry) => evaluateFilter(filter, entry)));
      };

      return TelemetryLogEventService.of({ publishBatch, streamDatasetLogs });
    }),
  );
}
