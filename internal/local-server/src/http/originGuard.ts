import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

export interface McpOriginGuardOptions {
  /**
   * The server's own HTTP origin (e.g. `http://127.0.0.1:43110`). Always
   * allowed — both the `127.0.0.1` and `localhost` spellings derived from
   * this origin are accepted.
   */
  readonly serverOrigin: string;
  /**
   * Optional dev-time client origin (e.g. the Vite dev server). Allowed
   * when set so the desktop dev mode can hit `/mcp` from the renderer
   * across origins.
   */
  readonly devClientUrl?: string | undefined;
  /**
   * Extra origins (typically read from `LENSFLARE_MCP_ALLOWED_ORIGINS`)
   * that the operator has explicitly opted into. Merged with the built-in
   * loopback allow list.
   */
  readonly extraAllowedOrigins?: ReadonlyArray<string> | undefined;
}

const stripTrailingSlash = (origin: string): string =>
  origin.endsWith("/") ? origin.slice(0, -1) : origin;

/**
 * The same origin can be spelled either `127.0.0.1` or `localhost`
 * depending on the resolver. Accept both spellings so a renderer that
 * dialed in via `localhost` is not rejected.
 */
const localhostOriginsForOrigin = (origin: string): ReadonlyArray<string> => {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return [origin];
  }

  const port = url.port;
  const protocol = url.protocol;
  return [
    stripTrailingSlash(`${protocol}//127.0.0.1${port ? `:${port}` : ""}`),
    stripTrailingSlash(`${protocol}//localhost${port ? `:${port}` : ""}`),
  ];
};

/**
 * Build the set of HTTP origins that are permitted to call `/mcp`.
 *
 * Loopback bind alone is not enough to defeat a DNS-rebinding attack
 * from a malicious page in the user's browser — the page can re-resolve
 * a hostname it controls to `127.0.0.1` and then issue cross-origin
 * POSTs. We mitigate by rejecting any explicit `Origin` header that
 * isn't on the allow list.
 *
 * Real MCP clients (Claude Code, Cursor, Codex, etc.) send no `Origin`
 * header at all because they are not browsers — those requests pass
 * through because there is no cross-origin attack surface to defend
 * against.
 *
 * Exported so the test harness can verify the same allow list the
 * runtime uses.
 */
export function buildAllowedMcpOrigins(options: McpOriginGuardOptions): Set<string> {
  const allowed = new Set<string>();
  for (const origin of localhostOriginsForOrigin(options.serverOrigin)) {
    allowed.add(origin);
  }
  if (options.devClientUrl) {
    allowed.add(stripTrailingSlash(options.devClientUrl));
  }
  for (const origin of options.extraAllowedOrigins ?? []) {
    const trimmed = origin.trim();
    if (trimmed.length > 0) {
      allowed.add(stripTrailingSlash(trimmed));
    }
  }
  return allowed;
}

/**
 * Read `LENSFLARE_MCP_ALLOWED_ORIGINS` (comma-separated) from the
 * environment. Operators can use this to add custom origins (e.g.
 * `https://my-team.lensflare.local`) without rebuilding the binary.
 */
export function readExtraAllowedOriginsFromEnv(
  env: Record<string, string | undefined>,
): ReadonlyArray<string> {
  const raw = env.LENSFLARE_MCP_ALLOWED_ORIGINS?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

const MCP_PATH_PREFIX = "/mcp";

const isMcpPath = (pathname: string): boolean =>
  pathname === MCP_PATH_PREFIX || pathname.startsWith(`${MCP_PATH_PREFIX}/`);

const forbiddenResponse = (origin: string) =>
  HttpServerResponse.jsonUnsafe(
    {
      error: {
        tag: "OriginNotAllowed",
        message: `Origin ${origin} is not permitted to access the Lensflare MCP endpoint.`,
      },
    },
    { status: 403 },
  );

/**
 * Global HTTP middleware that gates `/mcp` by the request's `Origin`
 * header. Non-`/mcp` routes are unaffected, so the existing CORS posture
 * for the renderer / RPC / ingest surfaces stays unchanged.
 *
 * Returns a `Layer` to be merged into the HTTP routes layer (alongside
 * the existing CORS layer in `server.ts`). The shape mirrors
 * `HttpMiddleware.logger` / `HttpMiddleware.tracer` upstream: the inner
 * function preserves whatever error / context the route already
 * declares, so providing this layer never widens the routes' R/E.
 */
export function mcpOriginGuardLayer(options: McpOriginGuardOptions) {
  const allowed = buildAllowedMcpOrigins(options);

  const guard = <E, R>(
    httpApp: Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      E,
      R | HttpServerRequest.HttpServerRequest
    >,
  ): Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E,
    R | HttpServerRequest.HttpServerRequest
  > =>
    Effect.withFiber((fiber) => {
      const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest);
      let pathname: string;
      try {
        pathname = new URL(request.url, options.serverOrigin).pathname;
      } catch {
        return httpApp;
      }

      if (!isMcpPath(pathname)) {
        return httpApp;
      }

      const origin = request.headers.origin;
      // Most native MCP clients (stdio bridges, Codex, Claude Code) do
      // not send an `Origin` header — only browsers do. Pass through.
      if (origin === undefined || origin === "" || origin === "null") {
        return httpApp;
      }

      if (allowed.has(stripTrailingSlash(origin))) {
        return httpApp;
      }

      return Effect.succeed(forbiddenResponse(origin));
    });

  return HttpRouter.middleware(guard, { global: true });
}
