import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import {
  type IngestErrorMapping,
  resolveIngestErrorStatus,
} from "../../../http/ingestErrorMapping.ts";
import { logIngestFailure } from "../../../http/ingestLogging.ts";
import {
  getProjectSlugFromAuthorization,
  getRemoteAddress,
  normalizeContentType,
} from "../../../http/ingestRouteHelpers.ts";
import { UnsupportedContentType } from "../../errors.ts";
import { LogIngestService } from "../../logIngestService.ts";
import { AxiomNativeDecoder } from "./decoder.ts";
import { axiomErrorResponse, axiomSuccessResponse } from "./responses.ts";

/**
 * Axiom-native ingest route. Follows the provider plug-in template
 * documented in `otlp/route.ts`. Bearer-token-flavored: the project slug
 * arrives in the `Authorization: Bearer <slug>` header rather than the
 * URL, so missing-slug short-circuits to a 401 before the shared error
 * mapping runs (the mapping is for ingest-pipeline errors, not auth).
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
        const projectSlug = getProjectSlugFromAuthorization(request.headers["authorization"]);
        const contentType = normalizeContentType(request.headers["content-type"]);
        // Content-Encoding intentionally ignored: Axiom native ingest is plaintext only.
        const body = yield* request.text;
        const requestBytes = Buffer.byteLength(body);

        if (projectSlug === null) {
          const mapping: IngestErrorMapping = {
            tag: "MissingProjectSlug",
            httpStatus: 401,
            grpcCode: 16,
            publicMessage: "Authorization bearer token must contain the local project slug.",
          };
          logIngestFailure({
            provider: "axiom_native",
            route: request.originalUrl,
            contentType: request.headers["content-type"] ?? null,
            contentEncoding: request.headers["content-encoding"] ?? null,
            projectSlug: null,
            datasetSlug,
            requestBytes,
            errorCategory: mapping.tag,
            errorMessage: "Missing bearer token.",
          });
          return axiomErrorResponse(mapping);
        }

        return yield* Effect.gen(function* () {
          if (contentType !== "application/json" && contentType !== "application/x-ndjson") {
            return yield* new UnsupportedContentType({
              provider: "axiom_native",
              contentType,
            });
          }
          const batch = yield* decoder.decode(contentType, body);
          const result = yield* ingest.ingest({
            projectSlug,
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
              projectSlug,
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
