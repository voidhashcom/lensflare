import type { DesktopEnvironmentBootstrap } from "@lensflare/contracts";
import { httpUrlToWsUrl, normalizeBaseUrl, wsUrlToHttpUrl } from "@lensflare/shared/browser";

/**
 * The explicit HTTP + WebSocket base URLs for whatever backend this web
 * renderer should talk to. Every network call in the web app must go
 * through {@link resolveBackendHttpUrl} / {@link resolveBackendWsUrl} so we
 * never silently fall back to `window.location` — that assumption breaks
 * as soon as the web bundle is served from an origin that is not the
 * backend (dev Vite on 5173, a remote static host, a reverse proxy, etc.).
 *
 * Resolution order (highest priority first):
 *   1. Desktop bridge bootstrap — the desktop main process knows where it
 *      just started the local server and hands that target to the renderer
 *      via `window.lensflareDesktop`.
 *   2. `VITE_LENSFLARE_HTTP_URL` / `VITE_LENSFLARE_WS_URL` — the build-time
 *      configured target; useful for browser-only development, remote
 *      environments, and tests.
 *   3. `window.location.origin` — fallback for when the web app is served
 *      directly by the local server (packaged desktop, standalone server
 *      mode).
 */
export interface BackendTarget {
  readonly source: "desktop-managed" | "configured" | "window-origin";
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  /**
   * Canonical MCP HTTP endpoint exposed by this backend. Derived from
   * `httpBaseUrl` so it always matches the path the local server mounts
   * (`McpServer.layerHttp({ path: "/mcp" })`); the same URL appears in
   * `LensflareEnvironmentDescriptor.mcpUrl` for external consumers.
   */
  readonly mcpUrl: string;
  readonly serverInstanceId?: string;
}

/**
 * Pure inputs for {@link resolveBackendTarget}. Real callers build this
 * from `window` + `import.meta.env`; tests build it from fixtures.
 */
export interface BackendTargetInputs {
  readonly desktopBootstrap: DesktopEnvironmentBootstrap | null;
  readonly configuredHttpUrl: string | undefined;
  readonly configuredWsUrl: string | undefined;
  readonly windowOrigin: string;
}

interface LensflareDesktopBootstrapReader {
  readonly getLocalServerBootstrap?: () => DesktopEnvironmentBootstrap | null;
}

function readDesktopBootstrap(): DesktopEnvironmentBootstrap | null {
  if (typeof window === "undefined") {
    return null;
  }

  const bridge = (
    window as typeof window & {
      lensflareDesktop?: LensflareDesktopBootstrapReader;
    }
  ).lensflareDesktop;
  if (!bridge?.getLocalServerBootstrap) {
    return null;
  }

  try {
    return bridge.getLocalServerBootstrap() ?? null;
  } catch {
    // The preload bridge owns this call — if it throws, we fall back to the
    // non-desktop resolution path rather than crash the renderer before it
    // renders the connection UI.
    return null;
  }
}

function trimToUndefined(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Build the canonical `/mcp` URL for this backend. `httpBaseUrl` is always
 * normalised to a trailing slash by `normalizeBaseUrl`, so we can append
 * `mcp` directly without worrying about double slashes.
 */
function deriveMcpUrl(httpBaseUrl: string): string {
  return new URL("mcp", httpBaseUrl).toString();
}

/**
 * Pure resolution — no `window` access, no env access. Exposed primarily
 * so the resolution rules can be exercised by unit tests without having
 * to stub a JSDOM environment.
 */
export function resolveBackendTarget(inputs: BackendTargetInputs): BackendTarget {
  const base = inputs.windowOrigin;

  if (inputs.desktopBootstrap) {
    const { httpBaseUrl, wsBaseUrl, serverInstanceId } = inputs.desktopBootstrap;
    if (!httpBaseUrl || !wsBaseUrl) {
      throw new Error(
        "Desktop bootstrap must provide both httpBaseUrl and wsBaseUrl for the local backend.",
      );
    }

    const normalizedHttpBaseUrl = normalizeBaseUrl(httpBaseUrl, base);
    return {
      source: "desktop-managed",
      httpBaseUrl: normalizedHttpBaseUrl,
      wsBaseUrl: normalizeBaseUrl(wsBaseUrl, base),
      mcpUrl: deriveMcpUrl(normalizedHttpBaseUrl),
      serverInstanceId,
    };
  }

  const configuredHttp = trimToUndefined(inputs.configuredHttpUrl);
  const configuredWs = trimToUndefined(inputs.configuredWsUrl);

  if (configuredHttp || configuredWs) {
    const httpBaseUrl = configuredHttp
      ? normalizeBaseUrl(configuredHttp, base)
      : wsUrlToHttpUrl(normalizeBaseUrl(configuredWs!, base));
    const wsBaseUrl = configuredWs
      ? normalizeBaseUrl(configuredWs, base)
      : httpUrlToWsUrl(httpBaseUrl);

    return {
      source: "configured",
      httpBaseUrl,
      wsBaseUrl,
      mcpUrl: deriveMcpUrl(httpBaseUrl),
    };
  }

  const httpBaseUrl = normalizeBaseUrl(base, base);
  return {
    source: "window-origin",
    httpBaseUrl,
    wsBaseUrl: httpUrlToWsUrl(httpBaseUrl),
    mcpUrl: deriveMcpUrl(httpBaseUrl),
  };
}

/**
 * Resolve the current backend target from live runtime state. This is
 * intentionally a pure function of the desktop bridge + env vars +
 * `window.location`; callers that need to react to target changes (e.g.
 * the RPC connection manager) should call this on each reconnect rather
 * than caching the result.
 */
export function readBackendTarget(): BackendTarget {
  return resolveBackendTarget({
    desktopBootstrap: readDesktopBootstrap(),
    configuredHttpUrl: import.meta.env.VITE_LENSFLARE_HTTP_URL,
    configuredWsUrl: import.meta.env.VITE_LENSFLARE_WS_URL,
    windowOrigin: typeof window !== "undefined" ? window.location.origin : "http://localhost",
  });
}

/**
 * Resolve a fully qualified URL for an HTTP endpoint on the backend.
 * `pathname` must start with `/`. `search` is optional and, when provided,
 * replaces any query string on the base URL.
 */
export function resolveBackendHttpUrl(
  pathname: string,
  search?: Record<string, string> | URLSearchParams,
): string {
  const target = readBackendTarget();
  const url = new URL(pathname, target.httpBaseUrl);
  if (search) {
    url.search =
      search instanceof URLSearchParams
        ? search.toString()
        : new URLSearchParams(search).toString();
  }
  return url.toString();
}

/**
 * Resolve a fully qualified WebSocket URL on the backend. Defaults to
 * `/rpc` which is where the Effect RPC server is mounted.
 */
export function resolveBackendWsUrl(pathname: string = "/rpc"): string {
  const target = readBackendTarget();
  return new URL(pathname, target.wsBaseUrl).toString();
}
