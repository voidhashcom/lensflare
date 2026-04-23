import {
  DatasetNotFound,
  type TelemetryLogEntry,
  type TelemetryLogPage,
  type TelemetryLogLevel,
  type TelemetryTraceContext,
  type TelemetryTraceSpanStatus,
} from "@lensflare/contracts";
import { Context, Effect, Layer } from "effect";
import { Buffer } from "node:buffer";
import { SqlError } from "effect/unstable/sql";
import { DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { DuckDbError, TelemetryStore } from "./telemetryStore.ts";

export type TelemetryLogPageDirection = "older" | "newer";

export interface TelemetryLogCursor {
  readonly timestamp: string;
  readonly id: string;
}

interface ListDatasetLogsOptions {
  readonly search?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: TelemetryLogCursor | undefined;
  readonly direction?: TelemetryLogPageDirection | undefined;
}

interface TelemetryLogRow {
  readonly id: string;
  readonly timestamp: string;
  readonly severityNumber: number | null;
  readonly severityText: string | null;
  readonly sourceName: string | null;
  readonly message: string;
  readonly traceId: string | null;
  readonly spanId: string | null;
}

interface TelemetrySpanRow {
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly serviceName: string | null;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly durationUs: number | null;
  readonly statusCode: number | null;
}

const duckDbTimestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

const selectLogsPageSql = `
  WITH filtered AS (
    SELECT
      id,
      COALESCE(timestamp, ingested_at) AS sort_timestamp,
      severity_number,
      severity_text,
      COALESCE(service_name, dataset_slug, provider_kind) AS source_name,
      COALESCE(
        NULLIF(body_text, ''),
        CAST(body_json AS VARCHAR),
        CAST(raw_record_json AS VARCHAR)
      ) AS message,
      trace_id,
      span_id
    FROM log_records
    WHERE project_id = $project_id
      AND dataset_id = $dataset_id
      AND (
        $search_pattern IS NULL
        OR LOWER(
          COALESCE(
            NULLIF(body_text, ''),
            CAST(body_json AS VARCHAR),
            CAST(raw_record_json AS VARCHAR),
            ''
          )
        ) LIKE $search_pattern
        OR LOWER(COALESCE(service_name, dataset_slug, provider_kind, '')) LIKE $search_pattern
        OR LOWER(COALESCE(severity_text, '')) LIKE $search_pattern
      )
  )
  SELECT
    id,
    CAST(sort_timestamp AS VARCHAR) AS timestamp,
    severity_number,
    severity_text,
    source_name,
    message,
    trace_id,
    span_id
  FROM filtered
  WHERE (
    $cursor_timestamp IS NULL
    OR (
      $direction = 'older'
      AND (
        sort_timestamp < CAST($cursor_timestamp AS TIMESTAMP)
        OR (sort_timestamp = CAST($cursor_timestamp AS TIMESTAMP) AND id < $cursor_id)
      )
    )
    OR (
      $direction = 'newer'
      AND (
        sort_timestamp > CAST($cursor_timestamp AS TIMESTAMP)
        OR (sort_timestamp = CAST($cursor_timestamp AS TIMESTAMP) AND id > $cursor_id)
      )
    )
  )
  ORDER BY
    CASE WHEN $direction = 'newer' THEN sort_timestamp END ASC,
    CASE WHEN $direction = 'newer' THEN id END ASC,
    CASE WHEN $direction = 'older' THEN sort_timestamp END DESC,
    CASE WHEN $direction = 'older' THEN id END DESC
  LIMIT $limit
`;

const selectTraceSpansSql = `
  SELECT
    span_id,
    parent_span_id,
    name,
    COALESCE(service_name, dataset_slug, provider_kind) AS service_name,
    CAST(start_time AS VARCHAR) AS start_time,
    CASE WHEN end_time IS NULL THEN NULL ELSE CAST(end_time AS VARCHAR) END AS end_time,
    duration_us,
    status_code
  FROM span_records
  WHERE project_id = $project_id
    AND dataset_id = $dataset_id
    AND trace_id = $trace_id
  ORDER BY start_time ASC, span_id ASC
`;

function toTimestamp(raw: string): string {
  const normalized = duckDbTimestampPattern.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toNullableString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  return value == null ? null : String(value);
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function decodeTelemetryLogRow(row: Record<string, unknown>): TelemetryLogRow {
  return {
    id: String(row.id ?? ""),
    timestamp: String(row.timestamp ?? ""),
    severityNumber: toNullableNumber(row.severity_number),
    severityText: toNullableString(row.severity_text),
    sourceName: toNullableString(row.source_name),
    message: String(row.message ?? ""),
    traceId: toNullableString(row.trace_id),
    spanId: toNullableString(row.span_id),
  };
}

function decodeTelemetrySpanRow(row: Record<string, unknown>): TelemetrySpanRow {
  return {
    spanId: String(row.span_id ?? ""),
    parentSpanId: toNullableString(row.parent_span_id),
    name: String(row.name ?? ""),
    serviceName: toNullableString(row.service_name),
    startTime: String(row.start_time ?? ""),
    endTime: toNullableString(row.end_time),
    durationUs: toNullableNumber(row.duration_us),
    statusCode: toNullableNumber(row.status_code),
  };
}

function toLevel(row: TelemetryLogRow): TelemetryLogLevel {
  const severityText = row.severityText?.trim().toLowerCase();
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

  const severityNumber = row.severityNumber ?? 0;
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

function mapRow(row: TelemetryLogRow): TelemetryLogEntry {
  return {
    id: row.id,
    timestamp: toTimestamp(row.timestamp),
    sourceName: row.sourceName ?? "unknown",
    level: toLevel(row),
    message: row.message,
    ...(row.traceId ? { traceId: row.traceId } : {}),
    ...(row.spanId ? { spanId: row.spanId } : {}),
  };
}

function toTraceSpanStatus(statusCode: number | null): TelemetryTraceSpanStatus {
  if (statusCode === 2) {
    return "error";
  }
  if (statusCode === 1) {
    return "ok";
  }
  return "unset";
}

function durationUs(row: TelemetrySpanRow): number {
  if (row.durationUs !== null && Number.isFinite(row.durationUs) && row.durationUs >= 0) {
    return row.durationUs;
  }

  if (row.endTime === null) {
    return 0;
  }

  const startMs = new Date(toTimestamp(row.startTime)).getTime();
  const endMs = new Date(toTimestamp(row.endTime)).getTime();
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
    ? (endMs - startMs) * 1_000
    : 0;
}

function toTraceContext(
  traceId: string,
  rows: ReadonlyArray<TelemetrySpanRow>,
  currentSpanId?: string | undefined,
): TelemetryTraceContext | null {
  if (rows.length === 0) {
    return null;
  }

  const startTimes = rows
    .map((row) => new Date(toTimestamp(row.startTime)).getTime())
    .filter((value) => Number.isFinite(value));
  const traceStartMs = Math.min(...startTimes);
  if (!Number.isFinite(traceStartMs)) {
    return null;
  }

  let totalDurationUs = 0;
  const spans = rows.map((row) => {
    const rowStartMs = new Date(toTimestamp(row.startTime)).getTime();
    const startOffsetUs = Number.isFinite(rowStartMs)
      ? Math.max(0, (rowStartMs - traceStartMs) * 1_000)
      : 0;
    const spanDurationUs = durationUs(row);
    totalDurationUs = Math.max(totalDurationUs, startOffsetUs + spanDurationUs);

    return {
      id: row.spanId,
      parentSpanId: row.parentSpanId && row.parentSpanId.length > 0 ? row.parentSpanId : null,
      name: row.name || "unnamed span",
      serviceName: row.serviceName ?? "unknown",
      startOffsetUs,
      durationUs: spanDurationUs,
      status: toTraceSpanStatus(row.statusCode),
    };
  });

  const selectedSpan =
    currentSpanId && spans.some((span) => span.id === currentSpanId) ? currentSpanId : spans[0]?.id;

  if (!selectedSpan) {
    return null;
  }

  return {
    traceId,
    startTime: new Date(traceStartMs).toISOString(),
    totalDurationUs,
    spans,
    currentSpanId: selectedSpan,
  };
}

function encodeTelemetryLogCursor(row: TelemetryLogRow): string {
  return Buffer.from(JSON.stringify({ timestamp: toTimestamp(row.timestamp), id: row.id })).toString(
    "base64url",
  );
}

export function decodeTelemetryLogCursor(input: string): TelemetryLogCursor | null {
  try {
    const value = JSON.parse(Buffer.from(input, "base64url").toString("utf8")) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { readonly timestamp?: unknown }).timestamp === "string" &&
      typeof (value as { readonly id?: unknown }).id === "string"
    ) {
      const timestamp = (value as { readonly timestamp: string }).timestamp;
      const id = (value as { readonly id: string }).id;
      if (!Number.isNaN(new Date(timestamp).getTime()) && id.length > 0) {
        return { timestamp, id };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function toLogPage(
  rows: ReadonlyArray<Record<string, unknown>>,
  args: {
    readonly direction: TelemetryLogPageDirection;
    readonly limit: number;
  },
): TelemetryLogPage {
  const hasMore = rows.length > args.limit;
  const pageRows = rows.slice(0, args.limit).map((row) => decodeTelemetryLogRow(row));
  const orderedRows = args.direction === "older" ? [...pageRows].reverse() : pageRows;
  const entries = orderedRows.map((row) => mapRow(row));
  const first = orderedRows[0];
  const last = orderedRows.at(-1);

  return {
    entries,
    pageInfo: {
      hasPreviousPage: args.direction === "older" ? hasMore : Boolean(first),
      hasNextPage: args.direction === "newer" ? hasMore : false,
      startCursor: first ? encodeTelemetryLogCursor(first) : null,
      endCursor: last ? encodeTelemetryLogCursor(last) : null,
    },
  };
}

export class TelemetryLogQueryService extends Context.Service<
  TelemetryLogQueryService,
  {
    readonly listDatasetLogs: (
      projectId: string,
      datasetId: string,
      options?: ListDatasetLogsOptions,
    ) => Effect.Effect<TelemetryLogPage, DatasetNotFound | DuckDbError | SqlError.SqlError>;
    readonly getTraceContext: (
      projectId: string,
      datasetId: string,
      traceId: string,
      currentSpanId?: string | undefined,
    ) => Effect.Effect<TelemetryTraceContext | null, DatasetNotFound | DuckDbError | SqlError.SqlError>;
  }
>()("@lensflare/local-server/TelemetryLogQueryService") {
  static readonly layer = Layer.effect(
    TelemetryLogQueryService,
    Effect.gen(function* () {
      const datasets = yield* DatasetsRepository;
      const telemetry = yield* TelemetryStore;

      const listDatasetLogs = Effect.fn("TelemetryLogQueryService.listDatasetLogs")(function* (
        projectId: string,
        datasetId: string,
        options?: ListDatasetLogsOptions,
      ) {
        const dataset = yield* datasets.findById(projectId, datasetId);
        if (dataset === undefined) {
          return yield* new DatasetNotFound({ datasetId, projectId });
        }

        const trimmedSearch = options?.search?.trim().toLowerCase();
        const direction = options?.cursor ? (options.direction ?? "older") : "older";
        const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
        const rows = yield* telemetry.queryRows<Record<string, unknown>>(selectLogsPageSql, {
          project_id: projectId,
          dataset_id: datasetId,
          search_pattern: trimmedSearch ? `%${trimmedSearch}%` : null,
          cursor_timestamp: options?.cursor?.timestamp ?? null,
          cursor_id: options?.cursor?.id ?? null,
          direction,
          limit: limit + 1,
        });

        return toLogPage(rows, { direction, limit });
      });

      const getTraceContext = Effect.fn("TelemetryLogQueryService.getTraceContext")(function* (
        projectId: string,
        datasetId: string,
        traceId: string,
        currentSpanId?: string | undefined,
      ) {
        const dataset = yield* datasets.findById(projectId, datasetId);
        if (dataset === undefined) {
          return yield* new DatasetNotFound({ datasetId, projectId });
        }

        const rows = yield* telemetry.queryRows<Record<string, unknown>>(selectTraceSpansSql, {
          project_id: projectId,
          dataset_id: datasetId,
          trace_id: traceId,
        });

        return toTraceContext(traceId, rows.map((row) => decodeTelemetrySpanRow(row)), currentSpanId);
      });

      return TelemetryLogQueryService.of({ listDatasetLogs, getTraceContext });
    }),
  );
}
