import { Context, Effect, Layer } from "effect";
import { DuckDbError, TelemetryStore } from "./telemetryStore.ts";
import type { NormalizedSpanRecord, SpanIngestWriteRequest, WrittenSpanRecord } from "./types.ts";

function recordValues(
  batchId: string,
  id: string,
  request: SpanIngestWriteRequest,
  record: NormalizedSpanRecord,
): Record<string, string | number | null> {
  return {
    id,
    batch_id: batchId,
    project_id: request.projectId,
    project_slug: request.projectSlug,
    dataset_id: request.datasetId,
    dataset_slug: request.datasetSlug,
    provider_kind: request.providerKind,
    ingested_at: request.receivedAt,
    trace_id: record.traceId,
    span_id: record.spanId,
    parent_span_id: record.parentSpanId,
    name: record.name,
    kind: record.kind,
    start_time: record.startTime,
    end_time: record.endTime,
    duration_us: record.durationUs,
    status_code: record.statusCode,
    status_message: record.statusMessage,
    service_name: record.serviceName,
    resource_schema_url: record.resourceSchemaUrl,
    scope_name: record.scopeName,
    scope_version: record.scopeVersion,
    scope_schema_url: record.scopeSchemaUrl,
    resource_json: record.resourceJson,
    scope_json: record.scopeJson,
    attributes_json: record.attributesJson,
    dropped_attributes_count: record.droppedAttributesCount,
    raw_span_json: record.rawSpanJson,
  };
}

const insertSpanRecordSql = `
  INSERT INTO span_records (
    id,
    batch_id,
    project_id,
    project_slug,
    dataset_id,
    dataset_slug,
    provider_kind,
    ingested_at,
    trace_id,
    span_id,
    parent_span_id,
    name,
    kind,
    start_time,
    end_time,
    duration_us,
    status_code,
    status_message,
    service_name,
    resource_schema_url,
    scope_name,
    scope_version,
    scope_schema_url,
    resource_json,
    scope_json,
    attributes_json,
    dropped_attributes_count,
    raw_span_json
  ) VALUES (
    $id,
    $batch_id,
    $project_id,
    $project_slug,
    $dataset_id,
    $dataset_slug,
    $provider_kind,
    CAST($ingested_at AS TIMESTAMP),
    $trace_id,
    $span_id,
    $parent_span_id,
    $name,
    $kind,
    CAST($start_time AS TIMESTAMP),
    CASE WHEN $end_time IS NULL THEN NULL ELSE CAST($end_time AS TIMESTAMP) END,
    $duration_us,
    $status_code,
    $status_message,
    $service_name,
    $resource_schema_url,
    $scope_name,
    $scope_version,
    $scope_schema_url,
    CASE WHEN $resource_json IS NULL THEN NULL ELSE CAST($resource_json AS JSON) END,
    CASE WHEN $scope_json IS NULL THEN NULL ELSE CAST($scope_json AS JSON) END,
    CASE WHEN $attributes_json IS NULL THEN NULL ELSE CAST($attributes_json AS JSON) END,
    $dropped_attributes_count,
    CAST($raw_span_json AS JSON)
  )
`;

export class TelemetrySpansRepository extends Context.Service<
  TelemetrySpansRepository,
  {
    readonly writeBatch: (
      request: SpanIngestWriteRequest,
    ) => Effect.Effect<
      {
        readonly batchId: string;
        readonly records: ReadonlyArray<WrittenSpanRecord>;
      },
      DuckDbError
    >;
  }
>()("@lensflare/local-server/TelemetrySpansRepository") {
  static readonly layer = Layer.effect(
    TelemetrySpansRepository,
    Effect.gen(function* () {
      const store = yield* TelemetryStore;

      const writeBatch = (request: SpanIngestWriteRequest) =>
        store.withTransaction((connection) =>
          Effect.tryPromise({
            try: async () => {
              const batchId = crypto.randomUUID();
              const records = request.spans.map((record) => ({
                id: crypto.randomUUID(),
                record,
              }));

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
                  accepted_records: request.spans.length,
                  received_at: request.receivedAt,
                  client_addr: request.clientAddr,
                },
              );

              for (const { id, record } of records) {
                await connection.run(insertSpanRecordSql, recordValues(batchId, id, request, record));
              }

              return { batchId, records };
            },
            catch: (error) =>
              new DuckDbError({
                message: error instanceof Error ? error.message : String(error),
              }),
          }),
        );

      return TelemetrySpansRepository.of({ writeBatch });
    }),
  );
}
