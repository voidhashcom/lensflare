/**
 * Provider-agnostic mapping from an ingest pipeline error to the wire-level
 * outcome a route handler should surface.
 *
 * Every provider's HTTP route catches the same union of error tags coming
 * out of `LogIngestService.ingest(...)` plus the per-provider decoder. By
 * funneling all of them through this single switch, the routes only have
 * to worry about how to *encode* the result for their wire format
 * (OTLP/Axiom/Datadog/etc.) — not what the result *is*.
 *
 * `httpStatus` covers the HTTP layer; `grpcCode` carries the equivalent
 * `google.rpc.Code` so OTLP-style providers don't need their own switch
 * on top. `publicMessage` is the human-readable string we're willing to
 * surface to the client (sometimes lifted from `error.message`, sometimes
 * a fixed string when leaking the internal message would be confusing or
 * unsafe).
 */
export interface IngestErrorMapping {
  readonly tag: string;
  readonly httpStatus: number;
  readonly grpcCode: number;
  readonly publicMessage: string;
}

function tagOf(error: unknown): string {
  return error !== null && typeof error === "object" && "_tag" in error
    ? String((error as { readonly _tag: string })._tag)
    : "UnknownError";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve an unknown error from the ingest pipeline to the public-facing
 * mapping every provider's route handler should reach for.
 *
 * Adding a new error tag means extending the switch here exactly once —
 * not in every provider's route layer.
 */
export function resolveIngestErrorStatus(error: unknown): IngestErrorMapping {
  const tag = tagOf(error);
  switch (tag) {
    case "UnknownProjectSlug":
    case "UnknownDatasetSlug":
    case "ProjectDatasetMismatch":
      return {
        tag,
        httpStatus: 404,
        grpcCode: 5,
        publicMessage: "Dataset not found.",
      };
    case "UnsupportedContentType":
    case "UnsupportedContentEncoding":
      return {
        tag,
        httpStatus: 415,
        grpcCode: 3,
        publicMessage: messageOf(error),
      };
    case "MalformedPayload":
    case "NormalizationFailure":
      return {
        tag,
        httpStatus: 400,
        grpcCode: 3,
        publicMessage: messageOf(error),
      };
    default:
      return {
        tag,
        httpStatus: 500,
        grpcCode: 13,
        publicMessage: "Lensflare failed to ingest the request.",
      };
  }
}
