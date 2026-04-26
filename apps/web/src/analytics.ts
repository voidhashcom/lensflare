import {
  bucketCount,
  telemetryRecordKindSeen,
  type AnalyticsBootstrap,
  type AnalyticsEventName,
  type AnalyticsRecorder,
} from "@lensflare/analytics";
import { createBrowserAnalyticsRecorder } from "@lensflare/analytics/browser";
import type { TelemetryRecord } from "@lensflare/contracts";

import { getAppMeta } from "~/data/appSettingsApi";
import { readBackendTarget } from "~/data/backendTarget";

const FIRST_DATA_SEEN_STORAGE_KEY = "lensflare:analytics:first-data-seen";

let recorder: AnalyticsRecorder = {
  enabled: false,
  capture: () => {},
  shutdown: async () => {},
};
let initPromise: Promise<void> | null = null;
let currentSignature: string | null = null;

function shellKind(): "desktop" | "browser" {
  if (typeof document === "undefined") {
    return "browser";
  }
  return document.documentElement.dataset.runtime === "electron" ? "desktop" : "browser";
}

async function loadRecorder(): Promise<void> {
  const meta = await getAppMeta();
  const signature = JSON.stringify(meta.analytics);
  if (currentSignature === signature) {
    return;
  }

  await Promise.resolve(recorder.shutdown());
  currentSignature = signature;
  const bootstrap: AnalyticsBootstrap = {
    enabled: meta.analytics.enabled,
    distinctId: meta.analytics.distinctId,
    host: meta.analytics.host,
    debug: meta.analytics.debug,
    ...(meta.analytics.apiKey ? { apiKey: meta.analytics.apiKey } : {}),
  };
  recorder = createBrowserAnalyticsRecorder(bootstrap, {
    surface: "web",
    mode: meta.mode,
    platform: navigator.platform || navigator.userAgent,
    devMode: import.meta.env.DEV,
    staticAssetMode: meta.staticAssetMode,
  });
}

export async function ensureWebAnalyticsInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = loadRecorder()
      .then(() => {
        captureWebEvent("app_opened", { shell: shellKind() });
        captureWebEvent("backend_connected", {
          connectionSource: readBackendTarget().source,
        });
      })
      .catch(() => {
        // Keep the app usable if analytics bootstrap fails.
      });
  }
  return initPromise;
}

export async function refreshWebAnalytics(): Promise<void> {
  await loadRecorder().catch(() => {
    // Ignore analytics refresh failures.
  });
}

export function captureWebEvent(
  event: AnalyticsEventName,
  properties?: Readonly<Record<string, unknown>>,
): void {
  void Promise.resolve(recorder.capture(event, properties));
}

export function recordCollectionOpened(collectionKind: string, openSource: string): void {
  captureWebEvent("collection_opened", { collectionKind, openSource });
}

export function recordTelemetryFirstDataSeen(records: ReadonlyArray<TelemetryRecord>): void {
  if (typeof window === "undefined" || window.localStorage.getItem(FIRST_DATA_SEEN_STORAGE_KEY)) {
    return;
  }

  const kinds = new Set<"log" | "span" | "spanEvent">();
  for (const record of records) {
    kinds.add(record.kind);
  }
  captureWebEvent("telemetry_first_data_seen", {
    recordKindSeen: telemetryRecordKindSeen(kinds),
  });
  window.localStorage.setItem(FIRST_DATA_SEEN_STORAGE_KEY, "1");
}

export function recordProjectCreated(projectCountAfter: number, source: string = "sidebar"): void {
  captureWebEvent("project_created", {
    source,
    projectCountBucketAfter: bucketCount(projectCountAfter),
  });
}

export function recordProjectDeleted(remainingProjects: number): void {
  captureWebEvent("project_deleted", {
    remainingProjectCountBucket: bucketCount(remainingProjects),
  });
}
