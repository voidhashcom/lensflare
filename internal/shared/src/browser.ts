import { Effect } from "effect";

export const APP_NAME = "Lensflare";
export const APP_VERSION = "0.1.0";
export const APP_IDENTIFIER = "com.thespacecompany.lensflare";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 43110;
export const DEFAULT_WEB_DEV_PORT = 5173;
export const DEFAULT_WINDOW_WIDTH = 1400;
export const DEFAULT_WINDOW_HEIGHT = 920;

export interface RuntimeConfig {
  host: string;
  serverPort: number;
  webDevPort: number;
  lensflareDev: boolean;
  desktopDev: boolean;
  otelEnabled: boolean;
  otelProjectSlug: string;
  otelDatasetSlug: string;
}

function parsePort(rawValue: string | undefined, fallback: number): number {
  return Effect.runSync(
    Effect.sync(() => {
      if (!rawValue) {
        return fallback;
      }

      const value = Number.parseInt(rawValue, 10);
      if (!Number.isInteger(value) || value < 1 || value > 65_535) {
        return fallback;
      }

      return value;
    }),
  );
}

function parseBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (!rawValue) {
    return fallback;
  }

  const value = rawValue.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") {
    return true;
  }
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false;
  }
  return fallback;
}

export function readRuntimeConfigFromEnv(env: Record<string, string | undefined>): RuntimeConfig {
  const host = env.LENSFLARE_HOST?.trim() || DEFAULT_HOST;
  const desktopDev = parseBoolean(env.LENSFLARE_DESKTOP_DEV, false);
  const lensflareDev = parseBoolean(env.LENSFLARE_DEV, false) || desktopDev;

  return {
    host,
    serverPort: parsePort(env.LENSFLARE_SERVER_PORT, DEFAULT_SERVER_PORT),
    webDevPort: parsePort(env.LENSFLARE_WEB_PORT, DEFAULT_WEB_DEV_PORT),
    lensflareDev,
    desktopDev,
    otelEnabled: parseBoolean(env.LENSFLARE_OTEL_ENABLED, lensflareDev),
    otelProjectSlug: env.LENSFLARE_OTEL_PROJECT_SLUG?.trim() || "lensflare",
    otelDatasetSlug: env.LENSFLARE_OTEL_DATASET_SLUG?.trim() || "dev",
  };
}

export function resolveServerOrigin(config: Pick<RuntimeConfig, "host" | "serverPort">): string {
  return `http://${config.host}:${config.serverPort}`;
}

export function resolveWebSocketOrigin(httpOrigin: string): string {
  const url = new URL(httpOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function resolveWebDevUrl(config: Pick<RuntimeConfig, "host" | "webDevPort">): string {
  return `http://${config.host}:${config.webDevPort}`;
}

/**
 * Convert an HTTP(S) base URL into its WebSocket equivalent while
 * preserving host, port, and path. Throws when given a protocol that can't
 * be mapped — callers should have already normalized the input with
 * {@link normalizeBaseUrl} or their own URL parser.
 */
export function httpUrlToWsUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Unsupported base URL protocol: ${url.protocol}`);
  }
  return url.toString();
}

/**
 * Convert a WebSocket base URL into its HTTP(S) equivalent.
 */
export function wsUrlToHttpUrl(wsUrl: string): string {
  const url = new URL(wsUrl);
  if (url.protocol === "wss:") {
    url.protocol = "https:";
  } else if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported base URL protocol: ${url.protocol}`);
  }
  return url.toString();
}

/**
 * Normalize a configured backend URL. Absolute URLs are returned verbatim;
 * relative values are resolved against `base`. Used by backend target
 * resolution to accept env vars like `VITE_LENSFLARE_HTTP_URL` that may be
 * absolute in dev but path-style in packaged builds.
 */
export function normalizeBaseUrl(rawValue: string, base: string): string {
  return new URL(rawValue, base).toString();
}
