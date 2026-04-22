import { gunzipSync } from "node:zlib";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import {
  resolveIngestErrorStatus,
} from "../../../http/ingestErrorMapping.ts";
import { logIngestFailure } from "../../../http/ingestLogging.ts";
import {
  getRemoteAddress,
  normalizeContentEncoding,
  normalizeContentType,
} from "../../../http/ingestRouteHelpers.ts";
import {
  MalformedPayload,
  UnsupportedContentEncoding,
  UnsupportedContentType,
} from "../../errors.ts";
import { LogIngestService } from "../../logIngestService.ts";
import { OtlpLogsDecoder } from "./decoder.ts";
import { otlpErrorResponseFromMapping, otlpSuccessResponse } from "./responses.ts";

/**
 * Provider plug-in template (mirrored by `axiom/route.ts`):
 *
 *   1. Extract request data — path params, headers, body bytes/string.
 *   2. Validate provider-specific Content-Type / Content-Encoding,
 *      raising `UnsupportedContentType` / `UnsupportedContentEncoding`
 *      *before* touching the body.
 *   3. Decode the body to a `NormalizedIngestBatch` via the provider's
 *      decoder service.
 *   4. Call the shared `LogIngestService.ingest({...})` to resolve the
 *      catalog target and persist the batch.
 *   5. On success, build the provider's wire response.
 *   6. On failure, run the error through the shared
 *      `resolveIngestErrorStatus` switch and let the provider build its
 *      wire-shape error response from the resulting mapping.
 *
 * Adding a new provider is creating one directory under
 * `ingest/providers/<name>/` (decoder + responses + route) plus a single
 * line in `server.ts` to mount the new `<name>RouteLayer` — no edits to
 * `LogIngestService`, no edits to other providers.
 */
export const otlpRouteLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    const ingest = yield* LogIngestService;
    const decoder = yield* OtlpLogsDecoder;

    yield* router.add("POST", "/ingest/otlp/v1/logs/:projectSlug/:datasetSlug", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params;
        const projectSlug = params.projectSlug ?? "";
        const datasetSlug = params.datasetSlug ?? "";
        const contentType = normalizeContentType(request.headers["content-type"]);
        const contentEncoding = normalizeContentEncoding(request.headers["content-encoding"]);
        const rawBody = new Uint8Array(yield* request.arrayBuffer);
        const format = contentType === "application/x-protobuf" ? "protobuf" : "json";

        return yield* Effect.gen(function* () {
          if (contentType !== "application/x-protobuf" && contentType !== "application/json") {
            return yield* new UnsupportedContentType({
              provider: "otlp_http_logs",
              contentType,
            });
          }
          if (contentEncoding !== null && contentEncoding !== "gzip") {
            return yield* new UnsupportedContentEncoding({
              provider: "otlp_http_logs",
              contentEncoding,
            });
          }
          const body = yield* Effect.try({
            try: () =>
              contentEncoding === "gzip"
                ? new Uint8Array(gunzipSync(Buffer.from(rawBody)))
                : rawBody,
            catch: (error) =>
              new MalformedPayload({
                provider: "otlp_http_logs",
                message: error instanceof Error ? error.message : String(error),
              }),
          });
          const batch = yield* decoder.decode(format, body);
          const result = yield* ingest.ingest({
            projectSlug,
            datasetSlug,
            batch,
            requestContentType: contentType,
            requestContentEncoding: contentEncoding,
            requestBytes: rawBody.byteLength,
            clientAddr: getRemoteAddress(request),
          });
          return otlpSuccessResponse(format, {
            rejectedRecords: result.rejectedRecords,
            warnings: result.warnings,
          });
        }).pipe(
          Effect.catch((error) => {
            const mapping = resolveIngestErrorStatus(error);
            logIngestFailure({
              provider: "otlp_http_logs",
              route: request.originalUrl,
              contentType: request.headers["content-type"] ?? null,
              contentEncoding: request.headers["content-encoding"] ?? null,
              projectSlug,
              datasetSlug,
              requestBytes: rawBody.byteLength,
              errorCategory: mapping.tag,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            return Effect.succeed(otlpErrorResponseFromMapping(format, mapping));
          }),
        );
      }),
    );
  }),
);
