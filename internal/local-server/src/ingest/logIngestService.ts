import { Context, Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql";
import { UnknownDatasetSlug } from "./errors.ts";
import { IngestTargetResolver } from "./targetResolver.ts";
import { TelemetryFilterCatalogService } from "./telemetryFilterCatalogService.ts";
import { TelemetryLogEventService } from "./telemetryLogEventService.ts";
import { TelemetryLogsRepository } from "./telemetryLogsRepository.ts";
import { TelemetrySpansRepository } from "./telemetrySpansRepository.ts";
import type { DuckDbError } from "./telemetryStore.ts";
import type { NormalizedIngestBatch } from "./types.ts";

/**
 * Provider-agnostic input to {@link LogIngestService.ingest}.
 *
 * Each provider's route handler is responsible for parsing the wire payload
 * (validating content type / encoding, decoding the body) into a
 * {@link NormalizedIngestBatch} before calling here. Once we're inside
 * `ingest()` the only remaining concerns are catalog resolution and
 * persistence — neither of which is provider-specific.
 */
export interface IngestInput {
  readonly datasetSlug: string;
  readonly batch: NormalizedIngestBatch;
  readonly requestContentType: string;
  readonly requestContentEncoding: string | null;
  readonly requestBytes: number;
  readonly clientAddr: string | null;
}

export interface IngestResult {
  readonly batchId: string;
  readonly acceptedRecords: number;
  readonly rejectedRecords: number;
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Persist a normalized log batch.
 *
 * The service is intentionally provider-agnostic: every supported provider
 * (OTLP, Axiom, future Better Stack/Datadog/etc.) decodes its wire payload
 * at the route edge, then funnels through this single `ingest()` method.
 * Adding a provider means adding a route layer + decoder service — never
 * touching this file.
 */
export class LogIngestService extends Context.Service<
  LogIngestService,
  {
    readonly ingest: (
      input: IngestInput,
    ) => Effect.Effect<
      IngestResult,
      UnknownDatasetSlug | SqlError.SqlError | DuckDbError
    >;
  }
>()("@lensflare/local-server/LogIngestService") {
  static readonly layer = Layer.effect(
    LogIngestService,
    Effect.gen(function* () {
      const resolver = yield* IngestTargetResolver;
      const logs = yield* TelemetryLogsRepository;
      const spans = yield* TelemetrySpansRepository;
      const events = yield* TelemetryLogEventService;
      const filterCatalog = yield* TelemetryFilterCatalogService;

      const ingest = Effect.fn("LogIngestService.ingest")(function* (input: IngestInput) {
        const target = yield* resolver.resolve(input.datasetSlug);
        const baseRequest = {
          providerKind: input.batch.providerKind,
          signal: input.batch.signal,
          projectId: target.projectId,
          projectSlug: target.projectSlug,
          datasetId: target.datasetId,
          datasetSlug: target.datasetSlug,
          requestContentType: input.requestContentType,
          requestContentEncoding: input.requestContentEncoding,
          requestBytes: input.requestBytes,
          clientAddr: input.clientAddr,
          receivedAt: new Date().toISOString(),
        } as const;

        if (input.batch.signal === "traces") {
          const request = {
            ...baseRequest,
            signal: "traces",
            spans: input.batch.spans,
          } as const;
          const { batchId, records } = yield* spans.writeBatch(request);
          yield* filterCatalog.applySpanBatch(request);
          yield* events.publishSpanBatch(request, records);

          return {
            batchId,
            acceptedRecords: input.batch.spans.length,
            rejectedRecords: input.batch.droppedRecords,
            warnings: input.batch.warnings,
          } satisfies IngestResult;
        }

        const request = {
          ...baseRequest,
          signal: "logs",
          records: input.batch.records,
        } as const;
        const { batchId, records } = yield* logs.writeBatch(request);
        yield* filterCatalog.applyLogBatch(request);
        yield* events.publishBatch(request, records);

        return {
          batchId,
          acceptedRecords: input.batch.records.length,
          rejectedRecords: input.batch.droppedRecords,
          warnings: input.batch.warnings,
        } satisfies IngestResult;
      });

      return LogIngestService.of({ ingest });
    }),
  );
}
