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
  desktopDev: boolean;
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

export function readRuntimeConfigFromEnv(
  env: Record<string, string | undefined>,
): RuntimeConfig {
  const host = env.LENSFLARE_HOST?.trim() || DEFAULT_HOST;

  return {
    host,
    serverPort: parsePort(env.LENSFLARE_SERVER_PORT, DEFAULT_SERVER_PORT),
    webDevPort: parsePort(env.LENSFLARE_WEB_PORT, DEFAULT_WEB_DEV_PORT),
    desktopDev: env.LENSFLARE_DESKTOP_DEV === "1",
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
