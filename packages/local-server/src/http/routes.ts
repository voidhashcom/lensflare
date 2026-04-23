import {
  FilterNodeSchema,
  InvalidFilterError,
  type FilterNode,
  type LensflareEnvironmentDescriptor,
  type ServerSnapshot,
} from "@lensflare/contracts";
import { APP_NAME, APP_VERSION } from "@lensflare/shared";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import {
  decodeTelemetryLogCursor,
  TelemetryLogQueryService,
  type TelemetryLogPageDirection,
} from "../ingest/telemetryLogQueryService.ts";
import {
  decodeTelemetryCursor,
  TelemetryQueryService,
} from "../ingest/telemetryQueryService.ts";
import { renderFallbackApp, serveStaticFile } from "./static.ts";

export interface HttpRoutesOptions {
  readonly origin: string;
  readonly snapshot: () => ServerSnapshot;
  readonly descriptor: LensflareEnvironmentDescriptor;
  readonly staticDir: string | undefined;
  /**
   * Dev-only client origin (e.g. Vite at `http://127.0.0.1:5173`). When
   * set, non-API/non-RPC static routes are redirected here, preserving the
   * original path + search + hash so deep links in dev still work.
   */
  readonly devClientUrl: string | undefined;
  readonly mode: "desktop" | "server";
  readonly sqliteDatabaseFile: string;
  readonly duckdbDatabaseFile: string;
}

function isBackendRoutedPath(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return true;
  }
  if (pathname === "/rpc" || pathname.startsWith("/rpc/")) {
    return true;
  }
  if (pathname === "/ingest" || pathname.startsWith("/ingest/")) {
    return true;
  }
  if (
    pathname === "/.well-known/lensflare/environment" ||
    pathname.startsWith("/.well-known/lensflare/")
  ) {
    return true;
  }
  return false;
}

function buildDevClientRedirectTarget(devClientUrl: string, requestUrl: URL): string {
  const target = new URL(devClientUrl);
  target.pathname = requestUrl.pathname;
  target.search = requestUrl.search;
  target.hash = requestUrl.hash;
  return target.toString();
}

function parseLogPageDirection(value: string | null): TelemetryLogPageDirection | undefined {
  if (value === "older" || value === "newer") {
    return value;
  }
  return undefined;
}

const decodeFilterSync = Schema.decodeUnknownSync(FilterNodeSchema);

type FilterParseResult =
  | { readonly ok: true; readonly filter: FilterNode | undefined }
  | { readonly ok: false; readonly message: string };

/**
 * Parse a raw filter payload (either a URL-encoded JSON query string or a
 * nested `filter` body field) into a `FilterNode`. An absent payload is fine
 * — it degenerates to an unfiltered query.
 */
function parseFilterPayload(raw: unknown): FilterParseResult {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, filter: undefined };
  }

  let candidate: unknown = raw;
  if (typeof raw === "string") {
    const parsed = safeJsonParse(raw);
    if (!parsed.ok) {
      return {
        ok: false,
        message: parsed.message || "filter is not valid JSON",
      };
    }
    candidate = parsed.value;
  }

  try {
    const filter = decodeFilterSync(candidate);
    return { ok: true, filter };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "invalid filter AST",
    };
  }
}

type SafeJsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

/**
 * Attempt to parse a string as JSON. Separated from the Effect pipeline so
 * the try/catch stays isolated — inside an `Effect.gen`, the codebase
 * convention is to express partiality with `Effect.try` and friends.
 */
function safeJsonParse(text: string): SafeJsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "invalid JSON",
    };
  }
}

function invalidFilterResponse(message: string) {
  return HttpServerResponse.jsonUnsafe(
    {
      error: {
        tag: "InvalidFilter",
        message,
      },
    },
    { status: 400 },
  );
}

function datasetNotFoundResponse() {
  return HttpServerResponse.jsonUnsafe(
    {
      error: {
        tag: "DatasetNotFound",
        message: "Dataset not found.",
      },
    },
    { status: 404 },
  );
}

interface LogQueryRequest {
  readonly search: string | undefined;
  readonly limit: number | undefined;
  readonly cursor: string | undefined;
  readonly direction: TelemetryLogPageDirection | undefined;
  readonly filter: FilterNode | undefined;
}

/**
 * Mount the non-RPC HTTP surface onto the active {@link HttpRouter}.
 *
 * Routes:
 *   - `GET /api/health`  → server snapshot (live state, uptime, etc.)
 *   - `GET /api/meta`    → static metadata about this process
 *   - `GET /api/projects/:p/datasets/:d/logs` → paginated log listing, with
 *     `filter` query param for small filter ASTs.
 *   - `POST /api/projects/:p/datasets/:d/logs/query` → same listing, with a
 *     JSON body — used by the web client when the serialized filter is too
 *     large to fit safely in a URL.
 *   - `GET /api/projects/:p/datasets/:d/logs/fields` → field catalog for
 *     the query builder combobox (static + distinct attribute keys).
 *   - `GET /api/projects/:p/datasets/:d/logs/values?field=<path>` → distinct
 *     values for a single field, for value-autocomplete.
 *   - `GET /*` → serve a built web asset, fall back to the generated
 *     landing page; under `/api/*` we keep the response shape consistent
 *     with RPC errors and return a JSON 404.
 */
export function makeHttpRoutesLayer(options: HttpRoutesOptions) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;

      yield* router.add(
        "GET",
        "/api/health",
        HttpServerResponse.jsonUnsafe({
          ...options.snapshot(),
          serverInstanceId: options.descriptor.serverInstanceId,
        }),
      );

      yield* router.add(
        "GET",
        "/.well-known/lensflare/environment",
        HttpServerResponse.jsonUnsafe(options.descriptor),
      );

      yield* router.add(
        "GET",
        "/api/meta",
        HttpServerResponse.jsonUnsafe({
          appName: APP_NAME,
          appVersion: APP_VERSION,
          serverOrigin: options.origin,
          mode: options.mode,
          sqliteDatabaseFile: options.sqliteDatabaseFile,
          duckdbDatabaseFile: options.duckdbDatabaseFile,
        }),
      );

      const runLogsQuery = (
        projectId: string,
        datasetId: string,
        req: LogQueryRequest,
      ) =>
        Effect.gen(function* () {
          const logs = yield* TelemetryLogQueryService;
          const parsedCursor = req.cursor ? decodeTelemetryLogCursor(req.cursor) : undefined;

          if (req.cursor && parsedCursor === null) {
            return HttpServerResponse.jsonUnsafe(
              {
                error: {
                  tag: "InvalidCursor",
                  message: "Invalid log page cursor.",
                },
              },
              { status: 400 },
            );
          }

          return yield* logs
            .listDatasetLogs(projectId, datasetId, {
              search: req.search,
              limit: req.limit,
              cursor: parsedCursor ?? undefined,
              direction: req.direction ?? "older",
              filter: req.filter,
            })
            .pipe(
              Effect.map((page) => HttpServerResponse.jsonUnsafe(page)),
              Effect.catchTag("DatasetNotFound", () => Effect.succeed(datasetNotFoundResponse())),
              Effect.catchTag("InvalidFilterError", (error) =>
                Effect.succeed(invalidFilterResponse(error.reason)),
              ),
            );
        }).pipe(
          Effect.catchTag("SqlError", Effect.die),
          Effect.catchTag("DuckDbError", Effect.die),
        );

      const runTelemetryQuery = (
        projectId: string,
        datasetId: string,
        req: LogQueryRequest,
      ) =>
        Effect.gen(function* () {
          const telemetry = yield* TelemetryQueryService;
          const parsedCursor = req.cursor ? decodeTelemetryCursor(req.cursor) : undefined;

          if (req.cursor && parsedCursor === null) {
            return HttpServerResponse.jsonUnsafe(
              {
                error: {
                  tag: "InvalidCursor",
                  message: "Invalid telemetry page cursor.",
                },
              },
              { status: 400 },
            );
          }

          return yield* telemetry
            .listDatasetTelemetry(projectId, datasetId, {
              search: req.search,
              limit: req.limit,
              cursor: parsedCursor ?? undefined,
              direction: req.direction ?? "older",
              filter: req.filter,
            })
            .pipe(
              Effect.map((page) => HttpServerResponse.jsonUnsafe(page)),
              Effect.catchTag("DatasetNotFound", () => Effect.succeed(datasetNotFoundResponse())),
              Effect.catchTag("InvalidFilterError", (error) =>
                Effect.succeed(invalidFilterResponse(error.reason)),
              ),
            );
        }).pipe(
          Effect.catchTag("SqlError", Effect.die),
          Effect.catchTag("DuckDbError", Effect.die),
        );

      yield* router.add("GET", "/api/projects/:projectId/datasets/:datasetId/logs", (request) =>
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          const url = new URL(request.url, options.origin);
          const search = url.searchParams.get("search")?.trim() || undefined;
          const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
          const limit = Number.isInteger(rawLimit) ? rawLimit : undefined;
          const rawCursor = url.searchParams.get("cursor")?.trim() || undefined;
          const rawDirection = url.searchParams.get("direction");
          const direction = parseLogPageDirection(rawDirection);

          if (rawDirection !== null && direction === undefined) {
            return HttpServerResponse.jsonUnsafe(
              {
                error: {
                  tag: "InvalidDirection",
                  message: "Log page direction must be either older or newer.",
                },
              },
              { status: 400 },
            );
          }

          const filterParse = parseFilterPayload(url.searchParams.get("filter"));
          if (!filterParse.ok) {
            return invalidFilterResponse(filterParse.message);
          }

          return yield* runLogsQuery(params.projectId ?? "", params.datasetId ?? "", {
            search,
            limit,
            cursor: rawCursor,
            direction,
            filter: filterParse.filter,
          });
        }),
      );

      yield* router.add(
        "POST",
        "/api/projects/:projectId/datasets/:datasetId/logs/query",
        (request) =>
          Effect.gen(function* () {
            const params = yield* HttpRouter.params;

            const buf = yield* request.arrayBuffer;
            const bodyText = new TextDecoder().decode(new Uint8Array(buf));

            let body: unknown = {};
            if (bodyText.trim().length > 0) {
              const parsed = safeJsonParse(bodyText);
              if (!parsed.ok) {
                return invalidFilterResponse(parsed.message || "invalid JSON body");
              }
              body = parsed.value;
            }

            if (body === null || typeof body !== "object") {
              return invalidFilterResponse("request body must be a JSON object");
            }

            const typed = body as {
              readonly search?: unknown;
              readonly limit?: unknown;
              readonly cursor?: unknown;
              readonly direction?: unknown;
              readonly filter?: unknown;
            };

            const search =
              typeof typed.search === "string" && typed.search.trim().length > 0
                ? typed.search.trim()
                : undefined;
            const limit =
              typeof typed.limit === "number" && Number.isInteger(typed.limit)
                ? typed.limit
                : undefined;
            const cursor =
              typeof typed.cursor === "string" && typed.cursor.trim().length > 0
                ? typed.cursor.trim()
                : undefined;
            const direction =
              typed.direction === "older" || typed.direction === "newer" ? typed.direction : undefined;

            const filterParse = parseFilterPayload(typed.filter);
            if (!filterParse.ok) {
              return invalidFilterResponse(filterParse.message);
            }

            return yield* runLogsQuery(params.projectId ?? "", params.datasetId ?? "", {
              search,
              limit,
              cursor,
              direction,
              filter: filterParse.filter,
            });
          }),
      );

      yield* router.add("GET", "/api/projects/:projectId/datasets/:datasetId/telemetry", (request) =>
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          const url = new URL(request.url, options.origin);
          const search = url.searchParams.get("search")?.trim() || undefined;
          const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
          const limit = Number.isInteger(rawLimit) ? rawLimit : undefined;
          const rawCursor = url.searchParams.get("cursor")?.trim() || undefined;
          const rawDirection = url.searchParams.get("direction");
          const direction = parseLogPageDirection(rawDirection);

          if (rawDirection !== null && direction === undefined) {
            return HttpServerResponse.jsonUnsafe(
              {
                error: {
                  tag: "InvalidDirection",
                  message: "Telemetry page direction must be either older or newer.",
                },
              },
              { status: 400 },
            );
          }

          const filterParse = parseFilterPayload(url.searchParams.get("filter"));
          if (!filterParse.ok) {
            return invalidFilterResponse(filterParse.message);
          }

          return yield* runTelemetryQuery(params.projectId ?? "", params.datasetId ?? "", {
            search,
            limit,
            cursor: rawCursor,
            direction,
            filter: filterParse.filter,
          });
        }),
      );

      yield* router.add(
        "POST",
        "/api/projects/:projectId/datasets/:datasetId/telemetry/query",
        (request) =>
          Effect.gen(function* () {
            const params = yield* HttpRouter.params;
            const buf = yield* request.arrayBuffer;
            const bodyText = new TextDecoder().decode(new Uint8Array(buf));

            let body: unknown = {};
            if (bodyText.trim().length > 0) {
              const parsed = safeJsonParse(bodyText);
              if (!parsed.ok) {
                return invalidFilterResponse(parsed.message || "invalid JSON body");
              }
              body = parsed.value;
            }

            if (body === null || typeof body !== "object") {
              return invalidFilterResponse("request body must be a JSON object");
            }

            const typed = body as {
              readonly search?: unknown;
              readonly limit?: unknown;
              readonly cursor?: unknown;
              readonly direction?: unknown;
              readonly filter?: unknown;
            };
            const search =
              typeof typed.search === "string" && typed.search.trim().length > 0
                ? typed.search.trim()
                : undefined;
            const limit =
              typeof typed.limit === "number" && Number.isInteger(typed.limit)
                ? typed.limit
                : undefined;
            const cursor =
              typeof typed.cursor === "string" && typed.cursor.trim().length > 0
                ? typed.cursor.trim()
                : undefined;
            const direction =
              typed.direction === "older" || typed.direction === "newer" ? typed.direction : undefined;

            const filterParse = parseFilterPayload(typed.filter);
            if (!filterParse.ok) {
              return invalidFilterResponse(filterParse.message);
            }

            return yield* runTelemetryQuery(params.projectId ?? "", params.datasetId ?? "", {
              search,
              limit,
              cursor,
              direction,
              filter: filterParse.filter,
            });
          }),
      );

      yield* router.add(
        "GET",
        "/api/projects/:projectId/datasets/:datasetId/telemetry/fields",
        () =>
          Effect.gen(function* () {
            const telemetry = yield* TelemetryQueryService;
            const params = yield* HttpRouter.params;

            return yield* telemetry
              .listFields(params.projectId ?? "", params.datasetId ?? "")
              .pipe(
                Effect.map((fields) => HttpServerResponse.jsonUnsafe({ fields })),
                Effect.catchTag("DatasetNotFound", () => Effect.succeed(datasetNotFoundResponse())),
              );
          }).pipe(
            Effect.catchTag("SqlError", Effect.die),
            Effect.catchTag("DuckDbError", Effect.die),
          ),
      );

      yield* router.add(
        "GET",
        "/api/projects/:projectId/datasets/:datasetId/telemetry/values",
        (request) =>
          Effect.gen(function* () {
            const telemetry = yield* TelemetryQueryService;
            const params = yield* HttpRouter.params;
            const url = new URL(request.url, options.origin);
            const fieldParam = url.searchParams.get("field")?.trim();
            if (!fieldParam) {
              return invalidFilterResponse("missing required 'field' query param");
            }

            return yield* telemetry
              .listFieldValues(params.projectId ?? "", params.datasetId ?? "", fieldParam.split("."))
              .pipe(
                Effect.map((values) => HttpServerResponse.jsonUnsafe({ values })),
                Effect.catchTag("DatasetNotFound", () => Effect.succeed(datasetNotFoundResponse())),
                Effect.catchTag("InvalidFilterError", (error: InvalidFilterError) =>
                  Effect.succeed(invalidFilterResponse(error.reason)),
                ),
              );
          }).pipe(
            Effect.catchTag("SqlError", Effect.die),
            Effect.catchTag("DuckDbError", Effect.die),
          ),
      );

      yield* router.add(
        "GET",
        "/api/projects/:projectId/datasets/:datasetId/logs/fields",
        () =>
          Effect.gen(function* () {
            const logs = yield* TelemetryLogQueryService;
            const params = yield* HttpRouter.params;

            return yield* logs
              .listFields(params.projectId ?? "", params.datasetId ?? "")
              .pipe(
                Effect.map((fields) => HttpServerResponse.jsonUnsafe({ fields })),
                Effect.catchTag("DatasetNotFound", () => Effect.succeed(datasetNotFoundResponse())),
              );
          }).pipe(
            Effect.catchTag("SqlError", Effect.die),
            Effect.catchTag("DuckDbError", Effect.die),
          ),
      );

      yield* router.add(
        "GET",
        "/api/projects/:projectId/datasets/:datasetId/logs/values",
        (request) =>
          Effect.gen(function* () {
            const logs = yield* TelemetryLogQueryService;
            const params = yield* HttpRouter.params;
            const url = new URL(request.url, options.origin);
            const fieldParam = url.searchParams.get("field")?.trim();
            if (!fieldParam) {
              return invalidFilterResponse("missing required 'field' query param");
            }

            const path = fieldParam.split(".");

            return yield* logs
              .listFieldValues(params.projectId ?? "", params.datasetId ?? "", path)
              .pipe(
                Effect.map((values) => HttpServerResponse.jsonUnsafe({ values })),
                Effect.catchTag("DatasetNotFound", () => Effect.succeed(datasetNotFoundResponse())),
                Effect.catchTag("InvalidFilterError", (error: InvalidFilterError) =>
                  Effect.succeed(invalidFilterResponse(error.reason)),
                ),
              );
          }).pipe(
            Effect.catchTag("SqlError", Effect.die),
            Effect.catchTag("DuckDbError", Effect.die),
          ),
      );

      yield* router.add(
        "GET",
        "/api/projects/:projectId/datasets/:datasetId/traces/:traceId",
        (request) =>
          Effect.gen(function* () {
            const logs = yield* TelemetryLogQueryService;
            const params = yield* HttpRouter.params;
            const url = new URL(request.url, options.origin);
            const currentSpanId = url.searchParams.get("spanId")?.trim() || undefined;

            return yield* logs
              .getTraceContext(
                params.projectId ?? "",
                params.datasetId ?? "",
                params.traceId ?? "",
                currentSpanId,
              )
              .pipe(
                Effect.map((trace) => HttpServerResponse.jsonUnsafe(trace)),
                Effect.catchTag("DatasetNotFound", (error) =>
                  Effect.succeed(
                    HttpServerResponse.jsonUnsafe(
                      {
                        error: {
                          tag: error._tag,
                          message: "Dataset not found.",
                        },
                      },
                      { status: 404 },
                    ),
                  ),
                ),
              );
          }).pipe(
            Effect.catchTag("SqlError", Effect.die),
            Effect.catchTag("DuckDbError", Effect.die),
          ),
      );

      const apiNotFound = HttpServerResponse.jsonUnsafe(
        {
          error: {
            tag: "NotFound",
            message: "API route not found.",
          },
        },
        { status: 404 },
      );

      yield* router.add("GET", "/*", (request) =>
        Effect.gen(function* () {
          const requestUrl = new URL(request.url, options.origin);
          const pathname = requestUrl.pathname;

          if (pathname === "/api" || pathname.startsWith("/api/")) {
            return apiNotFound;
          }

          // In dev, redirect static/app routes to the Vite dev client so the
          // backend origin is still the source of truth for HTTP + WS,
          // while the renderer loads the freshly-built assets from Vite.
          // `/api`, `/rpc`, `/ingest`, and `/.well-known/lensflare/*` stay
          // on the backend.
          if (options.devClientUrl && !isBackendRoutedPath(pathname)) {
            return HttpServerResponse.redirect(
              buildDevClientRedirectTarget(options.devClientUrl, requestUrl),
              { status: 307 },
            );
          }

          const staticResponse = yield* Effect.promise(() =>
            serveStaticFile(pathname, options.staticDir),
          );

          if (staticResponse) {
            return HttpServerResponse.uint8Array(staticResponse.body, {
              contentType: staticResponse.contentType,
            });
          }

          return HttpServerResponse.html(renderFallbackApp(options.origin));
        }),
      );
    }),
  );
}
