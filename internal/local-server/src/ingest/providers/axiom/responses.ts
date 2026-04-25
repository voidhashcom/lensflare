import { HttpServerResponse } from "effect/unstable/http";
import type { IngestErrorMapping } from "../../../http/ingestErrorMapping.ts";

/**
 * Build the Axiom-native success response.
 *
 * Mirrors the Axiom Cloud ingest API verbatim so existing exporters that
 * speak Axiom-native (Vector, the Axiom CLI, custom forwarders) round-trip
 * unchanged. `blocksCreated` and `walLength` are filler — Axiom's
 * implementation surfaces them, ours doesn't have an equivalent concept
 * but the field shape is part of the contract.
 */
export function axiomSuccessResponse(args: {
  readonly acceptedRecords: number;
  readonly rejectedRecords: number;
  readonly warnings: ReadonlyArray<string>;
  readonly processedBytes: number;
}) {
  return HttpServerResponse.jsonUnsafe({
    ingested: args.acceptedRecords,
    failed: args.rejectedRecords,
    failures: args.warnings,
    processedBytes: args.processedBytes,
    blocksCreated: 0,
    walLength: 1,
  });
}

/**
 * Build the Axiom-native error response from the shared error mapping.
 *
 * The mapping carries `tag` / `httpStatus` / `publicMessage`, and this
 * helper projects them onto the bespoke `{ error: { tag, message } }`
 * envelope Axiom clients expect. 5xx-class outcomes intentionally
 * collapse the tag to a stable `"InternalError"` instead of surfacing
 * the underlying tag (`SqlError`, `DuckDbError`, etc.) — preserves the
 * pre-refactor behavior so clients that key off the tag don't break.
 */
export function axiomErrorResponse(mapping: IngestErrorMapping) {
  const tag = mapping.httpStatus >= 500 ? "InternalError" : mapping.tag;
  return HttpServerResponse.jsonUnsafe(
    {
      error: {
        tag,
        message: mapping.publicMessage,
      },
    },
    { status: mapping.httpStatus },
  );
}
