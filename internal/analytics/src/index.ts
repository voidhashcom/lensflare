import { APP_VERSION } from "@lensflare/shared/browser";

export type AnalyticsSurface = "web" | "desktop" | "server";
export type AnalyticsMode = "desktop" | "server";

export interface AnalyticsBootstrap {
  readonly enabled: boolean;
  readonly apiKey?: string;
  readonly host: string;
  readonly debug: boolean;
  readonly distinctId: string;
}

export interface AnalyticsContext {
  readonly surface: AnalyticsSurface;
  readonly mode: AnalyticsMode;
  readonly platform: string;
  readonly devMode: boolean;
  readonly staticAssetMode?: "embedded" | "filesystem" | "proxy" | "none";
}

export interface AnalyticsRecorder {
  readonly enabled: boolean;
  readonly capture: (
    event: AnalyticsEventName,
    properties?: Readonly<Record<string, unknown>>,
  ) => void | Promise<void>;
  readonly shutdown: () => void | Promise<void>;
}

export const ANALYTICS_EVENTS = [
  "analytics_preference_changed",
  "app_closed",
  "app_opened",
  "backend_connected",
  "collection_opened",
  "dataset_storage_cleared",
  "desktop_update_available",
  "desktop_update_check_requested",
  "desktop_update_download_completed",
  "desktop_update_download_started",
  "desktop_update_error",
  "desktop_update_install_requested",
  "filter_applied",
  "project_created",
  "project_deleted",
  "server_bootstrap_catalog_created",
  "server_ingest_first_event",
  "server_started",
  "server_stopped",
  "telemetry_entry_selected",
  "telemetry_first_data_seen",
  "telemetry_history_loaded",
  "telemetry_tab_opened",
  "theme_changed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export function withAnalyticsMetadata(
  context: AnalyticsContext,
  properties: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    ...properties,
    surface: context.surface,
    appVersion: APP_VERSION,
    platform: context.platform,
    mode: context.mode,
    analyticsEnabledSource: "server-settings",
    devMode: context.devMode,
    ...(context.staticAssetMode ? { staticAssetMode: context.staticAssetMode } : {}),
  };
}

export function classifyError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown";
  const normalized = message.toLowerCase();

  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "timeout";
  }
  if (normalized.includes("permission") || normalized.includes("unauthor")) {
    return "permission";
  }
  if (normalized.includes("validation") || normalized.includes("invalid")) {
    return "validation";
  }
  if (normalized.includes("not found")) {
    return "not-found";
  }
  if (
    normalized.includes("network") ||
    normalized.includes("socket") ||
    normalized.includes("fetch")
  ) {
    return "network";
  }
  return "unknown";
}

export function bucketCount(value: number): string {
  if (value <= 0) return "0";
  if (value === 1) return "1";
  if (value <= 3) return "2-3";
  if (value <= 5) return "4-5";
  if (value <= 10) return "6-10";
  return "10+";
}

export function bucketDurationMs(value: number): string {
  if (value < 5_000) return "<5s";
  if (value < 30_000) return "5s-30s";
  if (value < 5 * 60_000) return "30s-5m";
  if (value < 60 * 60_000) return "5m-1h";
  return "1h+";
}

export function telemetryRecordKindSeen(
  kinds: ReadonlySet<"log" | "span" | "spanEvent">,
): "log" | "span" | "mixed" {
  const normalized = new Set(kinds);
  normalized.delete("spanEvent");
  if (normalized.size <= 1) {
    return normalized.has("span") ? "span" : "log";
  }
  return "mixed";
}
