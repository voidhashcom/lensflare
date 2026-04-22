import { DatasetNotFound, type TelemetryLogEntry, type TelemetryLogLevel } from "@lensflare/contracts";
import { Context, Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql";
import { DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { DuckDbError, TelemetryStore } from "./telemetryStore.ts";

interface TelemetryLogRow {
  readonly id: string;
  readonly timestamp: string;
  readonly severityNumber: number | null;
  readonly severityText: string | null;
  readonly sourceName: string | null;
  readonly message: string;
}

const selectRecentLogsSql = `
  SELECT id, timestamp, severity_number, severity_text, source_name, message
  FROM (
    SELECT
      id,
      CAST(COALESCE(timestamp, ingested_at) AS VARCHAR) AS timestamp,
      severity_number,
      severity_text,
      COALESCE(service_name, dataset_slug, provider_kind) AS source_name,
      COALESCE(
        NULLIF(body_text, ''),
        CAST(body_json AS VARCHAR),
        CAST(raw_record_json AS VARCHAR)
      ) AS message
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
    ORDER BY COALESCE(timestamp, ingested_at) DESC
    LIMIT $limit
  ) recent
  ORDER BY timestamp ASC, id ASC
`;

function toTimestamp(raw: string): string {
  const parsed = new Date(raw);
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
  };
}

export class TelemetryLogQueryService extends Context.Service<
  TelemetryLogQueryService,
  {
    readonly listDatasetLogs: (
      projectId: string,
      datasetId: string,
      options?: {
        readonly search?: string | undefined;
        readonly limit?: number | undefined;
      },
    ) => Effect.Effect<
      ReadonlyArray<TelemetryLogEntry>,
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
        options?: {
          readonly search?: string | undefined;
          readonly limit?: number | undefined;
        },
      ) {
        const dataset = yield* datasets.findById(projectId, datasetId);
        if (dataset === undefined) {
          return yield* new DatasetNotFound({ datasetId, projectId });
        }

        const trimmedSearch = options?.search?.trim().toLowerCase();
        const rows = yield* telemetry.queryRows<Record<string, unknown>>(selectRecentLogsSql, {
          project_id: projectId,
          dataset_id: datasetId,
          search_pattern: trimmedSearch ? `%${trimmedSearch}%` : null,
          limit: Math.max(1, Math.min(options?.limit ?? 500, 1_000)),
        });

        return rows.map((row) => mapRow(decodeTelemetryLogRow(row)));
      });

      return TelemetryLogQueryService.of({ listDatasetLogs });
    }),
  );
}
