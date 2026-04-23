import { Context, Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql";
import { ProjectDatasetMismatch, UnknownDatasetSlug, UnknownProjectSlug } from "./errors.ts";
import { IngestTargetResolver } from "./targetResolver.ts";
import { TelemetryLogsRepository } from "./telemetryLogsRepository.ts";
import type { DuckDbError } from "./telemetryStore.ts";
import type { NormalizedIngestBatch, NormalizedLogRecord } from "./types.ts";

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
  readonly projectSlug: string;
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

const lensflareDevTarget = {
  projectSlug: "lensflare",
  datasetSlug: "dev",
} as const;

const lensflareSelfServiceNames = new Set(["lensflare-server", "lensflare-desktop"]);

function isLensflareDevSelfRecord(input: IngestInput, record: NormalizedLogRecord): boolean {
  return (
    input.batch.providerKind === "otlp_http_logs" &&
    input.projectSlug === lensflareDevTarget.projectSlug &&
    input.datasetSlug === lensflareDevTarget.datasetSlug &&
    record.serviceName !== null &&
    lensflareSelfServiceNames.has(record.serviceName)
  );
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
      | UnknownProjectSlug
      | UnknownDatasetSlug
      | ProjectDatasetMismatch
      | SqlError.SqlError
      | DuckDbError
    >;
  }
>()("@lensflare/local-server/LogIngestService") {
  static readonly layer = Layer.effect(
    LogIngestService,
    Effect.gen(function* () {
      const resolver = yield* IngestTargetResolver;
      const telemetry = yield* TelemetryLogsRepository;

      const ingest = Effect.fn("LogIngestService.ingest")(function* (input: IngestInput) {
        const records = input.batch.records.filter(
          (record) => !isLensflareDevSelfRecord(input, record),
        );
        const ignoredSelfRecords = input.batch.records.length - records.length;
        const warnings =
          ignoredSelfRecords > 0
            ? [
                ...input.batch.warnings,
                `Ignored ${ignoredSelfRecords} Lensflare self-telemetry record(s) sent to lensflare/dev to prevent an ingest loop.`,
              ]
            : input.batch.warnings;
        const rejectedRecords = input.batch.droppedRecords + ignoredSelfRecords;

        if (records.length === 0) {
          return {
            batchId: crypto.randomUUID(),
            acceptedRecords: 0,
            rejectedRecords,
            warnings,
          } satisfies IngestResult;
        }

        const target = yield* resolver.resolve(input.projectSlug, input.datasetSlug);
        const { batchId } = yield* telemetry.writeBatch({
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
          records,
        });
        return {
          batchId,
          acceptedRecords: records.length,
          rejectedRecords,
          warnings,
        } satisfies IngestResult;
      });

      return LogIngestService.of({ ingest });
    }),
  );
}
