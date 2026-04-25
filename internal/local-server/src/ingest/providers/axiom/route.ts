import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { resolveIngestErrorStatus } from "../../../http/ingestErrorMapping.ts";
import { logIngestFailure } from "../../../http/ingestLogging.ts";
import {
  getRemoteAddress,
  normalizeContentType,
} from "../../../http/ingestRouteHelpers.ts";
import { UnsupportedContentType } from "../../errors.ts";
import { LogIngestService } from "../../logIngestService.ts";
import { AxiomNativeDecoder } from "./decoder.ts";
import { axiomErrorResponse, axiomSuccessResponse } from "./responses.ts";

/**
 * Axiom-native ingest route. Follows the provider plug-in template
 * documented in `otlp/route.ts`. Dataset lookup is entirely slug-based,
 * so callers only need the dataset slug in the URL.
 */
export const axiomRouteLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    const ingest = yield* LogIngestService;
    const decoder = yield* AxiomNativeDecoder;

    yield* router.add("POST", "/ingest/axiom/v1/ingest/:datasetSlug", (request) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params;
        const datasetSlug = params.datasetSlug ?? "";
        const contentType = normalizeContentType(request.headers["content-type"]);
        // Content-Encoding intentionally ignored: Axiom native ingest is plaintext only.
        const body = yield* request.text;
        const requestBytes = Buffer.byteLength(body);

        return yield* Effect.gen(function* () {
          if (contentType !== "application/json" && contentType !== "application/x-ndjson") {
            return yield* new UnsupportedContentType({
              provider: "axiom_native",
              contentType,
            });
          }
          const batch = yield* decoder.decode(contentType, body);
          const result = yield* ingest.ingest({
            datasetSlug,
            batch,
            requestContentType: contentType,
            requestContentEncoding: null,
            requestBytes,
            clientAddr: getRemoteAddress(request),
          });
          return axiomSuccessResponse({
            acceptedRecords: result.acceptedRecords,
            rejectedRecords: result.rejectedRecords,
            warnings: result.warnings,
            processedBytes: requestBytes,
          });
        }).pipe(
          Effect.catch((error) => {
            const mapping = resolveIngestErrorStatus(error);
            logIngestFailure({
              provider: "axiom_native",
              route: request.originalUrl,
              contentType: request.headers["content-type"] ?? null,
              contentEncoding: request.headers["content-encoding"] ?? null,
              projectSlug: null,
              datasetSlug,
              requestBytes,
              errorCategory: mapping.tag,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            return Effect.succeed(axiomErrorResponse(mapping));
          }),
        );
      }),
    );
  }),
);
