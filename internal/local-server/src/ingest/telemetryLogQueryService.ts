import {
  DatasetNotFound,
  InvalidFilterError,
  type FilterNode,
  type TelemetryLogEntry,
  type TelemetryLogLevel,
  type TelemetryLogPage,
  type TelemetryTraceContext,
  type TelemetryTraceSpanStatus,
} from "@lensflare/contracts";
import type { DuckDBValue } from "@duckdb/node-api";
import { Context, Effect, Layer } from "effect";
import { Buffer } from "node:buffer";
import { SqlError } from "effect/unstable/sql";
import { DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { compileFilterToSql } from "./filterSqlCompiler.ts";
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
  readonly filter?: FilterNode | undefined;
}

interface TelemetryLogRow {
  readonly id: string;
  readonly timestamp: string;
  readonly severityNumber: number;
  readonly severityText: string;
  readonly sourceName: string | null;
  readonly message: string;
  readonly serviceName: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

interface TelemetrySpanRow {
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly serviceName: string | null;
  readonly startTime: string;
  readonly durationUs: number;
  readonly statusCode: string;
  readonly events: ReadonlyArray<TelemetryTraceContext["spans"][number]["events"][number]>;
}

const duckDbTimestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

/**
 * Static, non-filtered part of the log paging query. The filter `WHERE`
 * fragment returned by {@link compileFilterToSql} is spliced in with an
 * `AND` after `dataset_id = $dataset_id` — the caller owns parameter naming
 * and makes sure those collide with neither `project_id`, `dataset_id`,
 * `cursor_*`, `direction`, nor `limit`.
 */
const SELECT_PREFIX = `
  WITH filtered AS (
    SELECT
      LensflareRecordId AS id,
      Timestamp AS sort_timestamp,
      SeverityNumber AS severity_number,
      SeverityText AS severity_text,
      NULLIF(ServiceName, '') AS source_name,
      Body AS message,
      ServiceName AS service_name,
      TraceId AS trace_id,
      SpanId AS span_id,
      LogAttributes AS attributes
    FROM otel_logs
    WHERE TRUE
`;

const SELECT_SUFFIX = `
  )
  SELECT
    id,
    CAST(sort_timestamp AS VARCHAR) AS timestamp,
    severity_number,
    severity_text,
    source_name,
    message,
    service_name,
    trace_id,
    span_id,
    attributes
  FROM filtered
  WHERE (
    $cursor_timestamp IS NULL
    OR (
      $direction = 'older'
      AND (
        sort_timestamp < CAST($cursor_timestamp AS TIMESTAMP_NS)
        OR (sort_timestamp = CAST($cursor_timestamp AS TIMESTAMP_NS) AND id < $cursor_id)
      )
    )
    OR (
      $direction = 'newer'
      AND (
        sort_timestamp > CAST($cursor_timestamp AS TIMESTAMP_NS)
        OR (sort_timestamp = CAST($cursor_timestamp AS TIMESTAMP_NS) AND id > $cursor_id)
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
    LensflareRecordId AS id,
    SpanId AS span_id,
    NULLIF(ParentSpanId, '') AS parent_span_id,
    SpanName AS name,
    NULLIF(ServiceName, '') AS service_name,
    CAST(Timestamp AS VARCHAR) AS start_time,
    CAST(floor(Duration / 1000) AS BIGINT) AS duration_us,
    StatusCode AS status_code,
    "Events.Timestamp" AS event_timestamps,
    "Events.Name" AS event_names,
    "Events.Attributes" AS event_attributes
  FROM otel_traces
  WHERE TraceId = $trace_id
  ORDER BY Timestamp ASC, SpanId ASC
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
    severityNumber: toNullableNumber(row.severity_number) ?? 0,
    severityText: toNullableString(row.severity_text) ?? "",
    sourceName: toNullableString(row.source_name),
    message: String(row.message ?? ""),
    serviceName: toNullableString(row.service_name) ?? "",
    traceId: toNullableString(row.trace_id) ?? "",
    spanId: toNullableString(row.span_id) ?? "",
    attributes: parseMap(row.attributes),
  };
}

function decodeTelemetrySpanRow(row: Record<string, unknown>): TelemetrySpanRow {
  return {
    spanId: String(row.span_id ?? ""),
    parentSpanId: toNullableString(row.parent_span_id),
    name: String(row.name ?? ""),
    serviceName: toNullableString(row.service_name),
    startTime: String(row.start_time ?? ""),
    durationUs: toNullableNumber(row.duration_us) ?? 0,
    statusCode: String(row.status_code ?? "Unset"),
    events: decodeInlineEvents(row, String(row.id ?? "")),
  };
}

function toLevel(row: TelemetryLogRow): TelemetryLogLevel {
  const severityText = row.severityText.trim().toLowerCase();
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

  const severityNumber = row.severityNumber;
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

function parseMap(value: unknown): Readonly<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const key = String((entry as { key?: unknown }).key ?? "");
    if (key.length > 0) {
      out[key] = (entry as { value?: unknown }).value ?? "";
    }
  }
  return out;
}

function decodeInlineEvents(
  row: Record<string, unknown>,
  spanRecordId: string,
): ReadonlyArray<TelemetryTraceContext["spans"][number]["events"][number]> {
  const timestamps = Array.isArray(row.event_timestamps) ? row.event_timestamps : [];
  const names = Array.isArray(row.event_names) ? row.event_names : [];
  const attributes = Array.isArray(row.event_attributes) ? row.event_attributes : [];

  return names.map((name, index) => ({
    id: `${spanRecordId}:event:${index}`,
    timestamp: toTimestamp(String(timestamps[index] ?? "")),
    name: String(name ?? "event"),
    attributes: parseMap(attributes[index]),
  }));
}

function mapRow(row: TelemetryLogRow): TelemetryLogEntry {
  return {
    id: row.id,
    timestamp: toTimestamp(row.timestamp),
    sourceName: row.sourceName ?? "unknown",
    level: toLevel(row),
    message: row.message,
    severityNumber: row.severityNumber,
    severityText: row.severityText,
    serviceName: row.serviceName.length > 0 ? row.serviceName : null,
    traceId: row.traceId.length > 0 ? row.traceId : null,
    spanId: row.spanId.length > 0 ? row.spanId : null,
    attributes: row.attributes,
  };
}

function toTraceSpanStatus(statusCode: string): TelemetryTraceSpanStatus {
  if (statusCode === "Error") {
    return "error";
  }
  if (statusCode === "Ok") {
    return "ok";
  }
  return "unset";
}

function durationUs(row: TelemetrySpanRow): number {
  if (Number.isFinite(row.durationUs) && row.durationUs >= 0) {
    return row.durationUs;
  }
  return 0;
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
      events: row.events,
    };
  });
  const orderedSpans = orderTraceSpansForDisplay(spans);

  const selectedSpan =
    currentSpanId && orderedSpans.some((span) => span.id === currentSpanId)
      ? currentSpanId
      : orderedSpans[0]?.id;

  if (!selectedSpan) {
    return null;
  }

  return {
    traceId,
    startTime: new Date(traceStartMs).toISOString(),
    totalDurationUs,
    spans: orderedSpans,
    currentSpanId: selectedSpan,
  };
}

function orderTraceSpansForDisplay(
  spans: ReadonlyArray<TelemetryTraceContext["spans"][number]>,
): ReadonlyArray<TelemetryTraceContext["spans"][number]> {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const childrenByParent = new Map<string | null, Array<TelemetryTraceContext["spans"][number]>>();

  for (const span of spans) {
    const parentKey =
      span.parentSpanId !== null && byId.has(span.parentSpanId) ? span.parentSpanId : null;
    const siblings = childrenByParent.get(parentKey);
    if (siblings) {
      siblings.push(span);
    } else {
      childrenByParent.set(parentKey, [span]);
    }
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareTraceSpans);
  }

  const ordered: Array<TelemetryTraceContext["spans"][number]> = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (span: TelemetryTraceContext["spans"][number]) => {
    if (visited.has(span.id) || visiting.has(span.id)) {
      return;
    }
    visiting.add(span.id);
    ordered.push(span);
    for (const child of childrenByParent.get(span.id) ?? []) {
      visit(child);
    }
    visiting.delete(span.id);
    visited.add(span.id);
  };

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root);
  }

  // Defensive fallback for malformed traces (cycles, duplicate parents, etc.).
  for (const span of [...spans].sort(compareTraceSpans)) {
    visit(span);
  }

  return ordered;
}

function compareTraceSpans(
  left: TelemetryTraceContext["spans"][number],
  right: TelemetryTraceContext["spans"][number],
): number {
  if (left.startOffsetUs !== right.startOffsetUs) {
    return left.startOffsetUs - right.startOffsetUs;
  }
  if (left.durationUs !== right.durationUs) {
    return right.durationUs - left.durationUs;
  }
  return left.id.localeCompare(right.id);
}

function encodeTelemetryLogCursor(row: TelemetryLogRow): string {
  return Buffer.from(
    JSON.stringify({ timestamp: toTimestamp(row.timestamp), id: row.id }),
  ).toString("base64url");
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

/**
 * Distinct field definition surfaced to the query builder's combobox. Static
 * fields cover the wire format's top-level keys; attribute fields are harvested
 * from the OTEL log attribute map at query time.
 */
export interface TelemetryLogField {
  readonly path: ReadonlyArray<string>;
  readonly label: string;
  readonly kind: "string" | "number" | "enum";
  readonly values?: ReadonlyArray<string>;
}

const STATIC_FIELDS: ReadonlyArray<TelemetryLogField> = [
  {
    path: ["level"],
    label: "level",
    kind: "enum",
    values: ["trace", "debug", "info", "warn", "error", "fatal"],
  },
  { path: ["message"], label: "message", kind: "string" },
  { path: ["sourceName"], label: "sourceName", kind: "string" },
  { path: ["serviceName"], label: "serviceName", kind: "string" },
  { path: ["severityText"], label: "severityText", kind: "string" },
  { path: ["severityNumber"], label: "severityNumber", kind: "number" },
  { path: ["traceId"], label: "traceId", kind: "string" },
  { path: ["spanId"], label: "spanId", kind: "string" },
];

export class TelemetryLogQueryService extends Context.Service<
  TelemetryLogQueryService,
  {
    readonly listDatasetLogs: (
      projectId: string,
      datasetId: string,
      options?: ListDatasetLogsOptions,
    ) => Effect.Effect<
      TelemetryLogPage,
      DatasetNotFound | DuckDbError | InvalidFilterError | SqlError.SqlError
    >;
    readonly listFields: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<
      ReadonlyArray<TelemetryLogField>,
      DatasetNotFound | DuckDbError | SqlError.SqlError
    >;
    readonly listFieldValues: (
      projectId: string,
      datasetId: string,
      path: ReadonlyArray<string>,
      options?: { readonly limit?: number | undefined },
    ) => Effect.Effect<
      ReadonlyArray<string>,
      DatasetNotFound | DuckDbError | InvalidFilterError | SqlError.SqlError
    >;
    readonly getTraceContext: (
      projectId: string,
      datasetId: string,
      traceId: string,
      currentSpanId?: string | undefined,
    ) => Effect.Effect<
      TelemetryTraceContext | null,
      DatasetNotFound | DuckDbError | SqlError.SqlError
    >;
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

        const direction = options?.cursor ? (options.direction ?? "older") : "older";
        const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));

        // Combine legacy free-text `search` with the structured `filter` via
        // an implicit AND. Either may be absent; both being absent produces no
        // extra SQL and degenerates to the original paging query.
        const effectiveFilter = combineFilter(options?.filter, options?.search);
        const fragment = effectiveFilter
          ? yield* Effect.try({
              try: () => compileFilterToSql(effectiveFilter),
              catch: (error) =>
                error instanceof InvalidFilterError
                  ? error
                  : new InvalidFilterError({
                      reason: error instanceof Error ? error.message : "filter compile failed",
                    }),
            })
          : null;

        const sql = fragment
          ? `${SELECT_PREFIX} AND ${fragment.whereClause}${SELECT_SUFFIX}`
          : `${SELECT_PREFIX}${SELECT_SUFFIX}`;

        const params: Record<string, DuckDBValue> = {
          cursor_timestamp: options?.cursor?.timestamp ?? null,
          cursor_id: options?.cursor?.id ?? null,
          direction,
          limit: limit + 1,
          ...(fragment?.params ?? {}),
        };

        const rows = yield* telemetry.queryRows<Record<string, unknown>>(datasetId, sql, params);
        return toLogPage(rows, { direction, limit });
      });

      const listFields = Effect.fn("TelemetryLogQueryService.listFields")(function* (
        projectId: string,
        datasetId: string,
      ) {
        const dataset = yield* datasets.findById(projectId, datasetId);
        if (dataset === undefined) {
          return yield* new DatasetNotFound({ datasetId, projectId });
        }

        // Harvest distinct attribute keys (top-level only — the builder UI
        // offers free-form path entry for nested attributes). LIMITed so a
        // misbehaving producer can't balloon the response.
        const rows = yield* telemetry.queryRows<Record<string, unknown>>(
          datasetId,
          `
          SELECT DISTINCT unnest(map_keys(LogAttributes)) AS key
          FROM otel_logs
          LIMIT 10000
        `,
          {},
        );

        const attributeFields: ReadonlyArray<TelemetryLogField> = rows
          .map((row) => String(row.key ?? ""))
          .filter((key) => key.length > 0)
          .sort()
          .map((key) => ({
            path: ["attributes", key],
            label: `attributes.${key}`,
            kind: "string" as const,
          }));

        return [...STATIC_FIELDS, ...attributeFields];
      });

      const listFieldValues = Effect.fn("TelemetryLogQueryService.listFieldValues")(function* (
        projectId: string,
        datasetId: string,
        path: ReadonlyArray<string>,
        options?: { readonly limit?: number | undefined },
      ) {
        const dataset = yield* datasets.findById(projectId, datasetId);
        if (dataset === undefined) {
          return yield* new DatasetNotFound({ datasetId, projectId });
        }

        const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
        const expr = yield* Effect.try({
          try: () => stringExprForPath(path),
          catch: (error) =>
            error instanceof InvalidFilterError
              ? error
              : new InvalidFilterError({
                  reason: error instanceof Error ? error.message : "invalid field path",
                }),
        });

        const rows = yield* telemetry.queryRows<Record<string, unknown>>(
          datasetId,
          `
          SELECT DISTINCT ${expr} AS value
          FROM otel_logs
          WHERE TRUE
            AND ${expr} IS NOT NULL
          ORDER BY value
          LIMIT $limit
        `,
          { limit },
        );

        return rows
          .map((row) => row.value)
          .filter(
            (value): value is string | number | boolean => value !== null && value !== undefined,
          )
          .map((value) => String(value));
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

        const rows = yield* telemetry.queryRows<Record<string, unknown>>(
          datasetId,
          selectTraceSpansSql,
          {
            trace_id: traceId,
          },
        );

        return toTraceContext(
          traceId,
          rows.map((row) => decodeTelemetrySpanRow(row)),
          currentSpanId,
        );
      });

      return TelemetryLogQueryService.of({
        listDatasetLogs,
        listFields,
        listFieldValues,
        getTraceContext,
      });
    }),
  );
}

function combineFilter(filter?: FilterNode, search?: string): FilterNode | null {
  const trimmed = search?.trim();
  if (!filter && !trimmed) {
    return null;
  }
  if (!trimmed) {
    return filter ?? null;
  }
  const textNode: FilterNode = { _tag: "text", query: trimmed, mode: "substring" };
  if (!filter) {
    return textNode;
  }
  return { _tag: "and", children: [filter, textNode] };
}

function stringExprForPath(path: ReadonlyArray<string>): string {
  const [head, ...rest] = path;
  if (head === undefined) {
    throw new InvalidFilterError({ reason: "field path is empty" });
  }
  if (head === "attributes") {
    if (rest.length === 0) {
      throw new InvalidFilterError({ reason: "attribute path requires at least one segment" });
    }
    for (const segment of rest) {
      // Re-use the same whitelist the SQL compiler enforces.
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(segment)) {
        throw new InvalidFilterError({ reason: `unsafe attribute segment: '${segment}'` });
      }
    }
    const exactKey = rest.join(".");
    return `COALESCE(LogAttributes['${exactKey}'], LogAttributes['${rest.at(-1) ?? ""}'])`;
  }

  if (rest.length > 0) {
    throw new InvalidFilterError({ reason: `unknown filter field: '${path.join(".")}'` });
  }

  switch (head) {
    case "level":
    case "severityText":
      return "SeverityText";
    case "message":
      return "Body";
    case "sourceName":
      return "NULLIF(ServiceName, '')";
    case "severityNumber":
      return "CAST(SeverityNumber AS VARCHAR)";
    case "serviceName":
      return "NULLIF(ServiceName, '')";
    case "traceId":
      return "NULLIF(TraceId, '')";
    case "spanId":
      return "NULLIF(SpanId, '')";
    default:
      throw new InvalidFilterError({ reason: `unknown filter field: '${head}'` });
  }
}
