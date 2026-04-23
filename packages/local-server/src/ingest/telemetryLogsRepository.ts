import { Context, Effect, Layer } from "effect";
import { DuckDbError, TelemetryStore } from "./telemetryStore.ts";
import type { IngestWriteRequest, NormalizedLogRecord } from "./types.ts";

function recordValues(
  batchId: string,
  request: IngestWriteRequest,
  record: NormalizedLogRecord,
): Record<string, string | number | null> {
  return {
    id: crypto.randomUUID(),
    batch_id: batchId,
    project_id: request.projectId,
    project_slug: request.projectSlug,
    dataset_id: request.datasetId,
    dataset_slug: request.datasetSlug,
    provider_kind: request.providerKind,
    ingested_at: request.receivedAt,
    timestamp: record.timestamp,
    observed_timestamp: record.observedTimestamp,
    trace_id: record.traceId,
    span_id: record.spanId,
    trace_flags: record.traceFlags,
    severity_number: record.severityNumber,
    severity_text: record.severityText,
    service_name: record.serviceName,
    resource_schema_url: record.resourceSchemaUrl,
    scope_name: record.scopeName,
    scope_version: record.scopeVersion,
    scope_schema_url: record.scopeSchemaUrl,
    body_text: record.bodyText,
    body_json: record.bodyJson,
    resource_json: record.resourceJson,
    scope_json: record.scopeJson,
    attributes_json: record.attributesJson,
    dropped_attributes_count: record.droppedAttributesCount,
    raw_record_json: record.rawRecordJson,
  };
}

const insertLogRecordSql = `
  INSERT INTO log_records (
    id,
    batch_id,
    project_id,
    project_slug,
    dataset_id,
    dataset_slug,
    provider_kind,
    ingested_at,
    timestamp,
    observed_timestamp,
    trace_id,
    span_id,
    trace_flags,
    severity_number,
    severity_text,
    service_name,
    resource_schema_url,
    scope_name,
    scope_version,
    scope_schema_url,
    body_text,
    body_json,
    resource_json,
    scope_json,
    attributes_json,
    dropped_attributes_count,
    raw_record_json
  ) VALUES (
    $id,
    $batch_id,
    $project_id,
    $project_slug,
    $dataset_id,
    $dataset_slug,
    $provider_kind,
    CAST($ingested_at AS TIMESTAMP),
    CASE WHEN $timestamp IS NULL THEN NULL ELSE CAST($timestamp AS TIMESTAMP) END,
    CASE WHEN $observed_timestamp IS NULL THEN NULL ELSE CAST($observed_timestamp AS TIMESTAMP) END,
    $trace_id,
    $span_id,
    $trace_flags,
    $severity_number,
    $severity_text,
    $service_name,
    $resource_schema_url,
    $scope_name,
    $scope_version,
    $scope_schema_url,
    $body_text,
    CASE WHEN $body_json IS NULL THEN NULL ELSE CAST($body_json AS JSON) END,
    CASE WHEN $resource_json IS NULL THEN NULL ELSE CAST($resource_json AS JSON) END,
    CASE WHEN $scope_json IS NULL THEN NULL ELSE CAST($scope_json AS JSON) END,
    CASE WHEN $attributes_json IS NULL THEN NULL ELSE CAST($attributes_json AS JSON) END,
    $dropped_attributes_count,
    CAST($raw_record_json AS JSON)
  )
`;

export class TelemetryLogsRepository extends Context.Service<
  TelemetryLogsRepository,
  {
    readonly writeBatch: (
      request: IngestWriteRequest,
    ) => Effect.Effect<{ readonly batchId: string }, DuckDbError>;
  }
>()("@lensflare/local-server/TelemetryLogsRepository") {
  static readonly layer = Layer.effect(
    TelemetryLogsRepository,
    Effect.gen(function* () {
      const store = yield* TelemetryStore;

      const writeBatch = (request: IngestWriteRequest) =>
        store.withTransaction((connection) =>
          Effect.tryPromise({
            try: async () => {
              const batchId = crypto.randomUUID();
              await connection.run(
                `
                  INSERT INTO ingest_batches (
                    id,
                    provider_kind,
                    signal,
                    project_id,
                    project_slug,
                    dataset_id,
                    dataset_slug,
                    request_content_type,
                    request_content_encoding,
                    request_bytes,
                    accepted_records,
                    received_at,
                    client_addr
                  ) VALUES (
                    $id,
                    $provider_kind,
                    $signal,
                    $project_id,
                    $project_slug,
                    $dataset_id,
                    $dataset_slug,
                    $request_content_type,
                    $request_content_encoding,
                    $request_bytes,
                    $accepted_records,
                    CAST($received_at AS TIMESTAMP),
                    $client_addr
                  )
                `,
                {
                  id: batchId,
                  provider_kind: request.providerKind,
                  signal: request.signal,
                  project_id: request.projectId,
                  project_slug: request.projectSlug,
                  dataset_id: request.datasetId,
                  dataset_slug: request.datasetSlug,
                  request_content_type: request.requestContentType,
                  request_content_encoding: request.requestContentEncoding,
                  request_bytes: request.requestBytes,
                  accepted_records: request.records.length,
                  received_at: request.receivedAt,
                  client_addr: request.clientAddr,
                },
              );

              for (const record of request.records) {
                await connection.run(insertLogRecordSql, recordValues(batchId, request, record));
              }

              return { batchId };
            },
            catch: (error) =>
              new DuckDbError({
                message: error instanceof Error ? error.message : String(error),
              }),
          }),
        );

      return TelemetryLogsRepository.of({ writeBatch });
    }),
  );
}
