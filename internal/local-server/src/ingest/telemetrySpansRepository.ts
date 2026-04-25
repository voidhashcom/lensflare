import { Context, Effect, Layer } from "effect";
import { DuckDbError, TelemetryStore } from "./telemetryStore.ts";
import {
  mapArrayLiteral,
  mapLiteral,
  mergeFragments,
  stringArrayLiteral,
  timestampArrayLiteral,
} from "./telemetrySql.ts";
import type {
  NormalizedSpanRecord,
  SpanIngestWriteRequest,
  WrittenSpanRecord,
} from "./types.ts";

function insertSpanRecordSql(recordId: string, record: NormalizedSpanRecord) {
  const resourceAttributes = mapLiteral("resource_attributes", record.resourceAttributes);
  const spanAttributes = mapLiteral("span_attributes", record.spanAttributes);
  const eventTimestamps = timestampArrayLiteral(
    "event_timestamp",
    record.events.map((event) => event.timestamp),
  );
  const eventNames = stringArrayLiteral(
    "event_name",
    record.events.map((event) => event.name),
  );
  const eventAttributes = mapArrayLiteral(
    "event_attributes",
    record.events.map((event) => event.attributes),
  );
  const linkTraceIds = stringArrayLiteral(
    "link_trace_id",
    record.links.map((link) => link.traceId),
  );
  const linkSpanIds = stringArrayLiteral(
    "link_span_id",
    record.links.map((link) => link.spanId),
  );
  const linkTraceStates = stringArrayLiteral(
    "link_trace_state",
    record.links.map((link) => link.traceState),
  );
  const linkAttributes = mapArrayLiteral(
    "link_attributes",
    record.links.map((link) => link.attributes),
  );

  return {
    sql: `
      INSERT INTO otel_traces (
        LensflareRecordId,
        BatchId,
        Timestamp,
        TraceId,
        SpanId,
        ParentSpanId,
        TraceState,
        SpanName,
        SpanKind,
        ServiceName,
        ResourceAttributes,
        ScopeName,
        ScopeVersion,
        SpanAttributes,
        Duration,
        StatusCode,
        StatusMessage,
        "Events.Timestamp",
        "Events.Name",
        "Events.Attributes",
        "Links.TraceId",
        "Links.SpanId",
        "Links.TraceState",
        "Links.Attributes"
      ) VALUES (
        $id,
        $batch_id,
        CAST($timestamp AS TIMESTAMP_NS),
        $trace_id,
        $span_id,
        $parent_span_id,
        $trace_state,
        $span_name,
        $span_kind,
        $service_name,
        ${resourceAttributes.sql},
        $scope_name,
        $scope_version,
        ${spanAttributes.sql},
        $duration,
        $status_code,
        $status_message,
        ${eventTimestamps.sql},
        ${eventNames.sql},
        ${eventAttributes.sql},
        ${linkTraceIds.sql},
        ${linkSpanIds.sql},
        ${linkTraceStates.sql},
        ${linkAttributes.sql}
      )
    `,
    params: {
      id: recordId,
      timestamp: record.timestamp,
      trace_id: record.traceId,
      span_id: record.spanId,
      parent_span_id: record.parentSpanId,
      trace_state: record.traceState,
      span_name: record.spanName,
      span_kind: record.spanKind,
      service_name: record.serviceName,
      scope_name: record.scopeName,
      scope_version: record.scopeVersion,
      duration: record.durationNs,
      status_code: record.statusCode,
      status_message: record.statusMessage,
      ...mergeFragments(
        resourceAttributes,
        spanAttributes,
        eventTimestamps,
        eventNames,
        eventAttributes,
        linkTraceIds,
        linkSpanIds,
        linkTraceStates,
        linkAttributes,
      ),
    },
  };
}

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
        store.withTransaction(request.datasetId, (connection) =>
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
                  accepted_records: request.spans.length,
                  received_at: request.receivedAt,
                  client_addr: request.clientAddr,
                },
              );

              for (const { id, record } of records) {
                const insert = insertSpanRecordSql(id, record);
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

      return TelemetrySpansRepository.of({ writeBatch });
    }),
  );
}
