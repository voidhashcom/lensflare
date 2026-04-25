import { Context, Effect, Layer } from "effect";
import { DuckDbError, TelemetryStore } from "./telemetryStore.ts";
import { mapLiteral, mergeFragments } from "./telemetrySql.ts";
import type { IngestWriteRequest, NormalizedLogRecord, WrittenLogRecord } from "./types.ts";

function effectiveTimestamp(record: NormalizedLogRecord, receivedAt: string): string {
  return record.timestamp ?? record.observedTimestamp ?? receivedAt;
}

function insertLogRecordSql(recordId: string, record: NormalizedLogRecord, receivedAt: string) {
  const resourceAttributes = mapLiteral("resource_attributes", record.resourceAttributes);
  const scopeAttributes = mapLiteral("scope_attributes", record.scopeAttributes);
  const logAttributes = mapLiteral("log_attributes", record.logAttributes);

  return {
    sql: `
      INSERT INTO otel_logs (
        LensflareRecordId,
        BatchId,
        Timestamp,
        TraceId,
        SpanId,
        TraceFlags,
        SeverityText,
        SeverityNumber,
        ServiceName,
        Body,
        ResourceSchemaUrl,
        ResourceAttributes,
        ScopeSchemaUrl,
        ScopeName,
        ScopeVersion,
        ScopeAttributes,
        LogAttributes
      ) VALUES (
        $id,
        $batch_id,
        CAST($timestamp AS TIMESTAMP_NS),
        $trace_id,
        $span_id,
        $trace_flags,
        $severity_text,
        $severity_number,
        $service_name,
        $body,
        $resource_schema_url,
        ${resourceAttributes.sql},
        $scope_schema_url,
        $scope_name,
        $scope_version,
        ${scopeAttributes.sql},
        ${logAttributes.sql}
      )
    `,
    params: {
      id: recordId,
      timestamp: effectiveTimestamp(record, receivedAt),
      trace_id: record.traceId,
      span_id: record.spanId,
      trace_flags: record.traceFlags,
      severity_text: record.severityText,
      severity_number: record.severityNumber,
      service_name: record.serviceName,
      body: record.body,
      resource_schema_url: record.resourceSchemaUrl,
      scope_schema_url: record.scopeSchemaUrl,
      scope_name: record.scopeName,
      scope_version: record.scopeVersion,
      ...mergeFragments(resourceAttributes, scopeAttributes, logAttributes),
    },
  };
}

export class TelemetryLogsRepository extends Context.Service<
  TelemetryLogsRepository,
  {
    readonly writeBatch: (request: IngestWriteRequest) => Effect.Effect<
      {
        readonly batchId: string;
        readonly records: ReadonlyArray<WrittenLogRecord>;
      },
      DuckDbError
    >;
  }
>()("@lensflare/local-server/TelemetryLogsRepository") {
  static readonly layer = Layer.effect(
    TelemetryLogsRepository,
    Effect.gen(function* () {
      const store = yield* TelemetryStore;

      const writeBatch = (request: IngestWriteRequest) =>
        store.withTransaction(request.datasetId, (connection) =>
          Effect.tryPromise({
            try: async () => {
              const batchId = crypto.randomUUID();
              const records = request.records.map((record) => ({
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
                    CAST($received_at AS TIMESTAMP_NS),
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

              for (const { id, record } of records) {
                const insert = insertLogRecordSql(id, record, request.receivedAt);
                await connection.run(insert.sql, {
                  batch_id: batchId,
                  ...insert.params,
                });
              }

              return { batchId, records };
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
