import { Effect } from "effect";
import { MalformedPayload, NormalizationFailure } from "../errors.ts";
import type { IngestProviderKind, NormalizedIngestBatch } from "../types.ts";

/**
 * Shared try → empty-check pipeline for every provider's `decode(...)`.
 *
 * Provider decoders only differ in:
 *   • how they parse and normalize their wire format (`decode`),
 *   • the `IngestProviderKind` tag carried on errors,
 *   • the user-facing `emptyMessage` for the empty-batch case.
 *
 * Wrapping that in this helper means each provider's `decoder.ts` is just
 * the format-specific work — the synchronous `try` boundary plus the
 * `flatMap` that converts an empty batch into a `NormalizationFailure`
 * are written exactly once here.
 *
 * Both error variants are tagged with the supplied `provider`, so the
 * route layer's failure logging and HTTP status mapping can stay
 * provider-agnostic.
 */
export function decodeBatch(args: {
  readonly provider: IngestProviderKind;
  readonly emptyMessage: string;
  readonly decode: () => NormalizedIngestBatch;
}): Effect.Effect<NormalizedIngestBatch, MalformedPayload | NormalizationFailure> {
  return Effect.try({
    try: args.decode,
    catch: (error) =>
      new MalformedPayload({
        provider: args.provider,
        message: error instanceof Error ? error.message : String(error),
      }),
  }).pipe(
    Effect.flatMap((batch) =>
      batch.records.length === 0
        ? Effect.fail(
            new NormalizationFailure({
              provider: args.provider,
              message: args.emptyMessage,
            }),
          )
        : Effect.succeed(batch),
    ),
  );
}
