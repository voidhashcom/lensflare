import {
  DatasetNotFound,
  InvalidFilterError,
  type FilterNode,
  type TelemetryLogLevel,
  type TelemetryRecord,
  type TelemetryRecordPage,
  type TelemetrySpanEvent,
  type TelemetryTraceSpanStatus,
} from "@lensflare/contracts";
import type { DuckDBValue } from "@duckdb/node-api";
import { Context, Effect, Layer } from "effect";
import { Buffer } from "node:buffer";
import { SqlError } from "effect/unstable/sql";
import { DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { DuckDbError, TelemetryStore } from "./telemetryStore.ts";
import { compileTelemetryFilterToSql } from "./telemetryFilterSqlCompiler.ts";

export type TelemetryPageDirection = "older" | "newer";

export interface TelemetryCursor {
  readonly timestamp: string;
  readonly id: string;
}

interface ListDatasetTelemetryOptions {
  readonly search?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: TelemetryCursor | undefined;
  readonly direction?: TelemetryPageDirection | undefined;
  readonly filter?: FilterNode | undefined;
}

export interface TelemetryField {
  readonly path: ReadonlyArray<string>;
  readonly label: string;
  readonly kind: "string" | "number" | "enum";
  readonly values?: ReadonlyArray<string>;
}

interface TelemetryRow {
  readonly id: string;
  readonly kind: "log" | "span" | "spanEvent";
  readonly timestamp: string;
  readonly sourceName: string | null;
  readonly level: string | null;
  readonly message: string | null;
  readonly severityNumber: number | null;
  readonly severityText: string | null;
  readonly serviceName: string | null;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly parentSpanId: string | null;
  readonly name: string | null;
  readonly status: string | null;
  readonly statusMessage: string | null;
  readonly durationUs: number | null;
  readonly attributesJson: string | null;
}

interface SpanEventRow {
  readonly id: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly timestamp: string;
  readonly name: string;
  readonly attributesJson: string | null;
}

const duckDbTimestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

const telemetryUnionSql = `
  SELECT
    project_id,
    dataset_id,
    id,
    'log' AS kind,
    COALESCE(timestamp, ingested_at) AS sort_timestamp,
    COALESCE(service_name, dataset_slug, provider_kind) AS source_name,
    CASE
      WHEN lower(severity_text) = 'fatal' THEN 'fatal'
      WHEN lower(severity_text) = 'error' THEN 'error'
      WHEN lower(severity_text) IN ('warn', 'warning') THEN 'warn'
      WHEN lower(severity_text) = 'info' THEN 'info'
      WHEN lower(severity_text) = 'debug' THEN 'debug'
      WHEN lower(severity_text) = 'trace' THEN 'trace'
      WHEN severity_number >= 21 THEN 'fatal'
      WHEN severity_number >= 17 THEN 'error'
      WHEN severity_number >= 13 THEN 'warn'
      WHEN severity_number >= 9 THEN 'info'
      WHEN severity_number >= 5 THEN 'debug'
      ELSE 'trace'
    END AS level,
    COALESCE(
      NULLIF(body_text, ''),
      CAST(body_json AS VARCHAR),
      CAST(raw_record_json AS VARCHAR)
    ) AS message,
    severity_number,
    severity_text,
    service_name,
    trace_id,
    span_id,
    NULL AS parent_span_id,
    NULL AS name,
    NULL AS status,
    NULL AS status_message,
    NULL AS duration_us,
    attributes_json
  FROM log_records
  WHERE project_id = $project_id
    AND dataset_id = $dataset_id
  UNION ALL
  SELECT
    project_id,
    dataset_id,
    id,
    'span' AS kind,
    start_time AS sort_timestamp,
    COALESCE(service_name, dataset_slug, provider_kind) AS source_name,
    NULL AS level,
    name AS message,
    NULL AS severity_number,
    NULL AS severity_text,
    service_name,
    trace_id,
    span_id,
    parent_span_id,
    name,
    CASE
      WHEN status_code = 2 THEN 'error'
      WHEN status_code = 1 THEN 'ok'
      ELSE 'unset'
    END AS status,
    status_message,
    duration_us,
    attributes_json
  FROM span_records
  WHERE project_id = $project_id
    AND dataset_id = $dataset_id
  UNION ALL
  SELECT
    project_id,
    dataset_id,
    id,
    'spanEvent' AS kind,
    timestamp AS sort_timestamp,
    COALESCE(service_name, dataset_slug, provider_kind) AS source_name,
    NULL AS level,
    name AS message,
    NULL AS severity_number,
    NULL AS severity_text,
    service_name,
    trace_id,
    span_id,
    NULL AS parent_span_id,
    name,
    NULL AS status,
    NULL AS status_message,
    NULL AS duration_us,
    attributes_json
  FROM span_event_records
  WHERE project_id = $project_id
    AND dataset_id = $dataset_id
`;

const STATIC_FIELDS: ReadonlyArray<TelemetryField> = [
  { path: ["kind"], label: "kind", kind: "enum", values: ["log", "span", "spanEvent"] },
  { path: ["level"], label: "level", kind: "enum", values: ["trace", "debug", "info", "warn", "error", "fatal"] },
  { path: ["status"], label: "status", kind: "enum", values: ["ok", "error", "unset"] },
  { path: ["message"], label: "message", kind: "string" },
  { path: ["name"], label: "name", kind: "string" },
  { path: ["sourceName"], label: "sourceName", kind: "string" },
  { path: ["serviceName"], label: "serviceName", kind: "string" },
  { path: ["durationUs"], label: "durationUs", kind: "number" },
  { path: ["traceId"], label: "traceId", kind: "string" },
  { path: ["spanId"], label: "spanId", kind: "string" },
  { path: ["parentSpanId"], label: "parentSpanId", kind: "string" },
  { path: ["severityText"], label: "severityText", kind: "string" },
  { path: ["severityNumber"], label: "severityNumber", kind: "number" },
  { path: ["relatedEvents", "name"], label: "relatedEvents.name", kind: "string" },
];

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

function parseAttributes(raw: string | null): Readonly<Record<string, unknown>> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function decodeTelemetryRow(row: Record<string, unknown>): TelemetryRow {
  const rawKind = String(row.kind ?? "log");
  const kind = rawKind === "span" || rawKind === "spanEvent" ? rawKind : "log";
  return {
    id: String(row.id ?? ""),
    kind,
    timestamp: String(row.timestamp ?? ""),
    sourceName: toNullableString(row.source_name),
    level: toNullableString(row.level),
    message: toNullableString(row.message),
    severityNumber: toNullableNumber(row.severity_number),
    severityText: toNullableString(row.severity_text),
    serviceName: toNullableString(row.service_name),
    traceId: toNullableString(row.trace_id),
    spanId: toNullableString(row.span_id),
    parentSpanId: toNullableString(row.parent_span_id),
    name: toNullableString(row.name),
    status: toNullableString(row.status),
    statusMessage: toNullableString(row.status_message),
    durationUs: toNullableNumber(row.duration_us),
    attributesJson: toNullableString(row.attributes_json),
  };
}

function decodeSpanEventRow(row: Record<string, unknown>): SpanEventRow {
  return {
    id: String(row.id ?? ""),
    traceId: String(row.trace_id ?? ""),
    spanId: String(row.span_id ?? ""),
    timestamp: String(row.timestamp ?? ""),
    name: String(row.name ?? ""),
    attributesJson: toNullableString(row.attributes_json),
  };
}

function toLogLevel(value: string | null): TelemetryLogLevel {
  switch (value) {
    case "fatal":
    case "error":
    case "warn":
    case "info":
    case "debug":
    case "trace":
      return value;
    default:
      return "trace";
  }
}

function toSpanStatus(value: string | null): TelemetryTraceSpanStatus {
  switch (value) {
    case "ok":
    case "error":
    case "unset":
      return value;
    default:
      return "unset";
  }
}

function spanKey(traceId: string, spanId: string): string {
  return `${traceId}:${spanId}`;
}

function mapRows(
  rows: ReadonlyArray<TelemetryRow>,
  eventsBySpan: ReadonlyMap<string, ReadonlyArray<TelemetrySpanEvent>>,
): ReadonlyArray<TelemetryRecord> {
  return rows.map((row) => {
    const timestamp = toTimestamp(row.timestamp);
    if (row.kind === "log") {
      return {
        id: row.id,
        kind: "log",
        timestamp,
        sourceName: row.sourceName ?? "unknown",
        level: toLogLevel(row.level),
        message: row.message ?? "",
        severityNumber: row.severityNumber,
        severityText: row.severityText,
        serviceName: row.serviceName,
        traceId: row.traceId,
        spanId: row.spanId,
        attributes: parseAttributes(row.attributesJson),
      };
    }

    if (row.kind === "spanEvent") {
      return {
        id: row.id,
        kind: "spanEvent",
        timestamp,
        sourceName: row.sourceName ?? "unknown",
        traceId: row.traceId ?? "",
        spanId: row.spanId ?? "",
        name: row.name ?? "event",
        serviceName: row.serviceName,
        attributes: parseAttributes(row.attributesJson),
      };
    }

    const traceId = row.traceId ?? "";
    const spanId = row.spanId ?? "";
    return {
      id: row.id,
      kind: "span",
      timestamp,
      sourceName: row.sourceName ?? "unknown",
      traceId,
      spanId,
      parentSpanId: row.parentSpanId,
      name: row.name ?? "unnamed span",
      serviceName: row.serviceName,
      status: toSpanStatus(row.status),
      statusMessage: row.statusMessage,
      durationUs: row.durationUs ?? 0,
      attributes: parseAttributes(row.attributesJson),
      events: eventsBySpan.get(spanKey(traceId, spanId)) ?? [],
    };
  });
}

function encodeTelemetryCursor(row: TelemetryRow): string {
  return Buffer.from(JSON.stringify({ timestamp: toTimestamp(row.timestamp), id: row.id })).toString(
    "base64url",
  );
}

export function decodeTelemetryCursor(input: string): TelemetryCursor | null {
  try {
    const value = JSON.parse(Buffer.from(input, "base64url").toString("utf8")) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { timestamp?: unknown }).timestamp === "string" &&
      typeof (value as { id?: unknown }).id === "string"
    ) {
      const timestamp = (value as { timestamp: string }).timestamp;
      const id = (value as { id: string }).id;
      if (!Number.isNaN(new Date(timestamp).getTime()) && id.length > 0) {
        return { timestamp, id };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function toRecordPage(
  rows: ReadonlyArray<TelemetryRow>,
  eventsBySpan: ReadonlyMap<string, ReadonlyArray<TelemetrySpanEvent>>,
  args: {
    readonly direction: TelemetryPageDirection;
    readonly limit: number;
  },
): TelemetryRecordPage {
  const hasMore = rows.length > args.limit;
  const pageRows = rows.slice(0, args.limit);
  const orderedRows = args.direction === "older" ? [...pageRows].reverse() : pageRows;
  const first = orderedRows[0];
  const last = orderedRows.at(-1);

  return {
    entries: mapRows(orderedRows, eventsBySpan),
    pageInfo: {
      hasPreviousPage: args.direction === "older" ? hasMore : Boolean(first),
      hasNextPage: args.direction === "newer" ? hasMore : false,
      startCursor: first ? encodeTelemetryCursor(first) : null,
      endCursor: last ? encodeTelemetryCursor(last) : null,
    },
  };
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
  if (head === "attributes" || (head === "relatedEvents" && rest[0] === "attributes")) {
    const segments = head === "attributes" ? rest : rest.slice(1);
    if (segments.length === 0) {
      throw new InvalidFilterError({ reason: "attribute path requires at least one segment" });
    }
    for (const segment of segments) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(segment)) {
        throw new InvalidFilterError({ reason: `unsafe attribute segment: '${segment}'` });
      }
    }
    const column = head === "attributes" ? "telemetry.attributes_json" : "attributes_json";
    return `json_extract_string(${column}, '${jsonPathForSegments(segments)}')`;
  }

  if (rest.length > 0) {
    throw new InvalidFilterError({ reason: `unknown filter field: '${path.join(".")}'` });
  }

  switch (head) {
    case "kind":
    case "level":
    case "status":
    case "message":
    case "name":
    case "sourceName":
    case "serviceName":
    case "traceId":
    case "spanId":
    case "parentSpanId":
    case "severityText":
      return `telemetry.${head === "sourceName" ? "source_name" : camelToSnake(head)}`;
    case "durationUs":
      return "CAST(telemetry.duration_us AS VARCHAR)";
    case "severityNumber":
      return "CAST(telemetry.severity_number AS VARCHAR)";
    default:
      throw new InvalidFilterError({ reason: `unknown filter field: '${head}'` });
  }
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function jsonPathForSegments(segments: ReadonlyArray<string>): string {
  return `$${segments.map((segment) => (segment.includes(".") ? `."${segment}"` : `.${segment}`)).join("")}`;
}

function buildEventsBySpan(
  rows: ReadonlyArray<SpanEventRow>,
): ReadonlyMap<string, ReadonlyArray<TelemetrySpanEvent>> {
  const out = new Map<string, Array<TelemetrySpanEvent>>();
  for (const row of rows) {
    const key = spanKey(row.traceId, row.spanId);
    const events = out.get(key) ?? [];
    events.push({
      id: row.id,
      timestamp: toTimestamp(row.timestamp),
      name: row.name,
      attributes: parseAttributes(row.attributesJson),
    });
    out.set(key, events);
  }
  return out;
}

export class TelemetryQueryService extends Context.Service<
  TelemetryQueryService,
  {
    readonly listDatasetTelemetry: (
      projectId: string,
      datasetId: string,
      options?: ListDatasetTelemetryOptions,
    ) => Effect.Effect<
      TelemetryRecordPage,
      DatasetNotFound | DuckDbError | InvalidFilterError | SqlError.SqlError
    >;
    readonly listFields: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<ReadonlyArray<TelemetryField>, DatasetNotFound | DuckDbError | SqlError.SqlError>;
    readonly listFieldValues: (
      projectId: string,
      datasetId: string,
      path: ReadonlyArray<string>,
      options?: { readonly limit?: number | undefined },
    ) => Effect.Effect<
      ReadonlyArray<string>,
      DatasetNotFound | DuckDbError | InvalidFilterError | SqlError.SqlError
    >;
  }
>()("@lensflare/local-server/TelemetryQueryService") {
  static readonly layer = Layer.effect(
    TelemetryQueryService,
    Effect.gen(function* () {
      const datasets = yield* DatasetsRepository;
      const telemetry = yield* TelemetryStore;

      const listDatasetTelemetry = Effect.fn("TelemetryQueryService.listDatasetTelemetry")(function* (
        projectId: string,
        datasetId: string,
        options?: ListDatasetTelemetryOptions,
      ) {
        const dataset = yield* datasets.findById(projectId, datasetId);
        if (dataset === undefined) {
          return yield* new DatasetNotFound({ datasetId, projectId });
        }

        const direction = options?.cursor ? (options.direction ?? "older") : "older";
        const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
        const effectiveFilter = combineFilter(options?.filter, options?.search);
        const fragment = effectiveFilter
          ? yield* Effect.try({
              try: () => compileTelemetryFilterToSql(effectiveFilter),
              catch: (error) =>
                error instanceof InvalidFilterError
                  ? error
                  : new InvalidFilterError({
                      reason: error instanceof Error ? error.message : "filter compile failed",
                    }),
            })
          : null;

        const sql = `
          WITH telemetry AS (${telemetryUnionSql})
          SELECT
            id,
            kind,
            CAST(sort_timestamp AS VARCHAR) AS timestamp,
            source_name,
            level,
            message,
            severity_number,
            severity_text,
            service_name,
            trace_id,
            span_id,
            parent_span_id,
            name,
            status,
            status_message,
            duration_us,
            CAST(attributes_json AS VARCHAR) AS attributes_json
          FROM telemetry
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
          ${fragment ? `AND ${fragment.whereClause}` : ""}
          ORDER BY
            CASE WHEN $direction = 'newer' THEN sort_timestamp END ASC,
            CASE WHEN $direction = 'newer' THEN id END ASC,
            CASE WHEN $direction = 'older' THEN sort_timestamp END DESC,
            CASE WHEN $direction = 'older' THEN id END DESC
          LIMIT $limit
        `;

        const params: Record<string, DuckDBValue> = {
          project_id: projectId,
          dataset_id: datasetId,
          cursor_timestamp: options?.cursor?.timestamp ?? null,
          cursor_id: options?.cursor?.id ?? null,
          direction,
          limit: limit + 1,
          ...(fragment?.params ?? {}),
        };

        const rawRows = yield* telemetry.queryRows<Record<string, unknown>>(datasetId, sql, params);
        const rows = rawRows.map((row) => decodeTelemetryRow(row));
        const spanRows = rows.filter((row) => row.kind === "span" && row.traceId && row.spanId);
        const eventRows =
          spanRows.length === 0
            ? []
            : yield* telemetry.queryRows<Record<string, unknown>>(
                datasetId,
                `
                SELECT
                  id,
                  trace_id,
                  span_id,
                  CAST(timestamp AS VARCHAR) AS timestamp,
                  name,
                  CAST(attributes_json AS VARCHAR) AS attributes_json
                FROM span_event_records
                WHERE project_id = $project_id
                  AND dataset_id = $dataset_id
                  AND trace_id IN (${spanRows.map((_, index) => `$trace_${index}`).join(", ")})
                  AND span_id IN (${spanRows.map((_, index) => `$span_${index}`).join(", ")})
                ORDER BY timestamp ASC, id ASC
              `,
                {
                  project_id: projectId,
                  dataset_id: datasetId,
                  ...Object.fromEntries(spanRows.map((row, index) => [`trace_${index}`, row.traceId ?? ""])),
                  ...Object.fromEntries(spanRows.map((row, index) => [`span_${index}`, row.spanId ?? ""])),
                },
              );

        return toRecordPage(rows, buildEventsBySpan(eventRows.map(decodeSpanEventRow)), {
          direction,
          limit,
        });
      });

      const listFields = Effect.fn("TelemetryQueryService.listFields")(function* (
        projectId: string,
        datasetId: string,
      ) {
        const dataset = yield* datasets.findById(projectId, datasetId);
        if (dataset === undefined) {
          return yield* new DatasetNotFound({ datasetId, projectId });
        }

        const rows = yield* telemetry.queryRows<Record<string, unknown>>(
          datasetId,
          `
          SELECT DISTINCT unnest(json_keys(attributes_json)) AS key, 'attributes' AS prefix
          FROM log_records
          WHERE project_id = $project_id AND dataset_id = $dataset_id AND attributes_json IS NOT NULL
          UNION
          SELECT DISTINCT unnest(json_keys(attributes_json)) AS key, 'attributes' AS prefix
          FROM span_records
          WHERE project_id = $project_id AND dataset_id = $dataset_id AND attributes_json IS NOT NULL
          UNION
          SELECT DISTINCT unnest(json_keys(attributes_json)) AS key, 'attributes' AS prefix
          FROM span_event_records
          WHERE project_id = $project_id AND dataset_id = $dataset_id AND attributes_json IS NOT NULL
          UNION
          SELECT DISTINCT unnest(json_keys(attributes_json)) AS key, 'relatedEvents.attributes' AS prefix
          FROM span_event_records
          WHERE project_id = $project_id AND dataset_id = $dataset_id AND attributes_json IS NOT NULL
          LIMIT 10000
        `,
          { project_id: projectId, dataset_id: datasetId },
        );

        const attributeFields = rows
          .map((row) => ({
            key: String(row.key ?? ""),
            prefix: String(row.prefix ?? ""),
          }))
          .filter((row) => row.key.length > 0 && row.prefix.length > 0)
          .sort((left, right) => `${left.prefix}.${left.key}`.localeCompare(`${right.prefix}.${right.key}`))
          .map((row) => ({
            path: [...row.prefix.split("."), row.key],
            label: `${row.prefix}.${row.key}`,
            kind: "string" as const,
          }));

        return [...STATIC_FIELDS, ...attributeFields];
      });

      const listFieldValues = Effect.fn("TelemetryQueryService.listFieldValues")(function* (
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
        if (path[0] === "kind") return ["log", "span", "spanEvent"];
        if (path[0] === "status") return ["ok", "error", "unset"];
        if (path[0] === "level") return ["trace", "debug", "info", "warn", "error", "fatal"];

        const relatedAttributes = path[0] === "relatedEvents" && path[1] === "attributes";
        const expr = yield* Effect.try({
          try: () => stringExprForPath(path),
          catch: (error) =>
            error instanceof InvalidFilterError
              ? error
              : new InvalidFilterError({
                  reason: error instanceof Error ? error.message : "invalid field path",
                }),
        });

        const rows = relatedAttributes
          ? yield* telemetry.queryRows<Record<string, unknown>>(
              datasetId,
              `
              SELECT DISTINCT ${expr} AS value
              FROM span_event_records
              WHERE project_id = $project_id
                AND dataset_id = $dataset_id
                AND ${expr} IS NOT NULL
              ORDER BY value
              LIMIT $limit
            `,
              { project_id: projectId, dataset_id: datasetId, limit },
            )
          : yield* telemetry.queryRows<Record<string, unknown>>(
              datasetId,
              `
              WITH telemetry AS (${telemetryUnionSql})
              SELECT DISTINCT ${expr} AS value
              FROM telemetry
              WHERE ${expr} IS NOT NULL
              ORDER BY value
              LIMIT $limit
            `,
              { project_id: projectId, dataset_id: datasetId, limit },
            );

        return rows
          .map((row) => row.value)
          .filter((value): value is string | number | boolean => value !== null && value !== undefined)
          .map((value) => String(value));
      });

      return TelemetryQueryService.of({ listDatasetTelemetry, listFields, listFieldValues });
    }),
  );
}
