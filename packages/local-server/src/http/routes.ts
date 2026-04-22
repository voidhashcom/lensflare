import type { ServerSnapshot } from "@lensflare/contracts";
import { APP_NAME, APP_VERSION } from "@lensflare/shared";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { renderFallbackApp, serveStaticFile } from "./static.ts";

export interface HttpRoutesOptions {
  readonly origin: string;
  readonly snapshot: () => ServerSnapshot;
  readonly staticDir: string | undefined;
  readonly mode: "desktop" | "server";
  readonly sqliteDatabaseFile: string;
  readonly duckdbDatabaseFile: string;
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
        HttpServerResponse.jsonUnsafe(options.snapshot()),
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
          const pathname = new URL(request.url, options.origin).pathname;

          if (pathname === "/api" || pathname.startsWith("/api/")) {
            return apiNotFound;
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
