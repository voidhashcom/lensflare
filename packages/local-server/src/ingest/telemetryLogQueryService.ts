import {
  DatasetNotFound,
  InvalidFilterError,
  type FilterNode,
  type TelemetryLogEntry,
  type TelemetryLogLevel,
  type TelemetryLogPage,
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
  readonly severityNumber: number | null;
  readonly severityText: string | null;
  readonly sourceName: string | null;
  readonly message: string;
  readonly serviceName: string | null;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly attributesJson: string | null;
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
      service_name,
      trace_id,
      span_id,
      CAST(attributes_json AS VARCHAR) AS attributes_json
    FROM log_records
    WHERE project_id = $project_id
      AND dataset_id = $dataset_id
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
    attributes_json
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
    serviceName: toNullableString(row.service_name),
    traceId: toNullableString(row.trace_id),
    spanId: toNullableString(row.span_id),
    attributesJson: toNullableString(row.attributes_json),
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

function mapRow(row: TelemetryLogRow): TelemetryLogEntry {
  return {
    id: row.id,
    timestamp: toTimestamp(row.timestamp),
    sourceName: row.sourceName ?? "unknown",
    level: toLevel(row),
    message: row.message,
    severityNumber: row.severityNumber,
    severityText: row.severityText,
    serviceName: row.serviceName,
    traceId: row.traceId,
    spanId: row.spanId,
    attributes: parseAttributes(row.attributesJson),
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

/**
 * Distinct field definition surfaced to the query builder's combobox. Static
 * fields cover the wire format's top-level keys; attribute fields are harvested
 * from the `attributes_json` keyspace at query time.
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
          project_id: projectId,
          dataset_id: datasetId,
          cursor_timestamp: options?.cursor?.timestamp ?? null,
          cursor_id: options?.cursor?.id ?? null,
          direction,
          limit: limit + 1,
          ...(fragment?.params ?? {}),
        };

        const rows = yield* telemetry.queryRows<Record<string, unknown>>(sql, params);
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
          `
          SELECT DISTINCT unnest(json_keys(attributes_json)) AS key
          FROM log_records
          WHERE project_id = $project_id
            AND dataset_id = $dataset_id
            AND attributes_json IS NOT NULL
          LIMIT 10000
        `,
          { project_id: projectId, dataset_id: datasetId },
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
          `
          SELECT DISTINCT ${expr} AS value
          FROM log_records
          WHERE project_id = $project_id
            AND dataset_id = $dataset_id
            AND ${expr} IS NOT NULL
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

      return TelemetryLogQueryService.of({ listDatasetLogs, listFields, listFieldValues });
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
    return `json_extract_string(attributes_json, '$.${rest.join(".")}')`;
  }

  if (rest.length > 0) {
    throw new InvalidFilterError({ reason: `unknown filter field: '${path.join(".")}'` });
  }

  switch (head) {
    case "level":
    case "severityText":
      return "severity_text";
    case "message":
      return "COALESCE(NULLIF(body_text, ''), CAST(body_json AS VARCHAR), CAST(raw_record_json AS VARCHAR))";
    case "sourceName":
      return "COALESCE(service_name, dataset_slug, provider_kind)";
    case "severityNumber":
      return "CAST(severity_number AS VARCHAR)";
    case "serviceName":
      return "service_name";
    case "traceId":
      return "trace_id";
    case "spanId":
      return "span_id";
    default:
      throw new InvalidFilterError({ reason: `unknown filter field: '${head}'` });
  }
}
