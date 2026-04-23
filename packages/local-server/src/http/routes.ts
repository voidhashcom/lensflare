import type { LensflareEnvironmentDescriptor, ServerSnapshot } from "@lensflare/contracts";
import { APP_NAME, APP_VERSION } from "@lensflare/shared";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import {
  decodeTelemetryLogCursor,
  TelemetryLogQueryService,
  type TelemetryLogPageDirection,
} from "../ingest/telemetryLogQueryService.ts";
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

/**
 * Mount the non-RPC HTTP surface onto the active {@link HttpRouter}.
 *
 * Routes:
 *   - `GET /api/health`  → server snapshot (live state, uptime, etc.)
 *   - `GET /api/meta`    → static metadata about this process
 *   - `GET /*`           → serve a built web asset, fall back to the
 *                          generated landing page; under `/api/*` we keep
 *                          the response shape consistent with RPC errors
 *                          and return a JSON 404.
 *
 * The catch-all is intentionally `Layer.effectDiscard`: it doesn't
 * provide any services, it just registers handlers for their side effect
 * on the router.
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

      yield* router.add("GET", "/api/projects/:projectId/datasets/:datasetId/logs", (request) =>
        Effect.gen(function* () {
          const logs = yield* TelemetryLogQueryService;
          const params = yield* HttpRouter.params;
          const url = new URL(request.url, options.origin);
          const search = url.searchParams.get("search")?.trim() || undefined;
          const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
          const limit = Number.isInteger(rawLimit) ? rawLimit : undefined;
          const rawCursor = url.searchParams.get("cursor")?.trim() || undefined;
          const parsedCursor = rawCursor ? decodeTelemetryLogCursor(rawCursor) : undefined;
          const rawDirection = url.searchParams.get("direction");
          const direction = parseLogPageDirection(rawDirection) ?? "older";

          if (rawCursor && parsedCursor === null) {
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

          if (rawDirection !== null && parseLogPageDirection(rawDirection) === undefined) {
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

          return yield* logs
            .listDatasetLogs(params.projectId ?? "", params.datasetId ?? "", {
              search,
              limit,
              cursor: parsedCursor ?? undefined,
              direction,
            })
            .pipe(
              Effect.map((page) => HttpServerResponse.jsonUnsafe(page)),
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
