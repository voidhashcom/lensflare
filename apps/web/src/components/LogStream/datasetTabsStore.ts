import { useSyncExternalStore } from "react";

import {
  closeDatasetTab as closeDatasetTabReducer,
  openTelemetryTab as openTelemetryTabReducer,
  openTraceTab as openTraceTabReducer,
  setActiveDatasetTab as setActiveDatasetTabReducer,
  type DatasetTabId,
  type DatasetTabsByDataset,
  type OpenTraceTabInput,
} from "./datasetTabs";

/**
 * Global external store for the per-dataset tab strip. Tabs are mutated from
 * two unrelated places — the titlebar (user clicks/closes) and the log
 * details panel ("Explore trace") — so we expose the state as an external
 * store (via `useSyncExternalStore`) rather than plumbing it through React
 * context. The pattern mirrors `desktopUpdateStore.ts` for consistency.
 */

let snapshot: DatasetTabsByDataset = {};
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function commit(next: DatasetTabsByDataset): void {
  if (next === snapshot) {
    return;
  }
  snapshot = next;
  emit();
}

export function getDatasetTabsSnapshot(): DatasetTabsByDataset {
  return snapshot;
}

export function subscribeDatasetTabsStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe the calling component to tab-state changes. Returns the whole
 * snapshot — derive per-dataset state with `getDatasetTabState` in a
 * `useMemo` on the caller so you don't re-render when an unrelated dataset
 * mutates.
 */
export function useDatasetTabsSnapshot(): DatasetTabsByDataset {
  return useSyncExternalStore(
    subscribeDatasetTabsStore,
    getDatasetTabsSnapshot,
    getDatasetTabsSnapshot,
  );
}

export function setActiveDatasetTab(datasetId: string, tabId: DatasetTabId): void {
  commit(setActiveDatasetTabReducer(snapshot, datasetId, tabId));
}

export function openTelemetryTab(datasetId: string): void {
  commit(openTelemetryTabReducer(snapshot, datasetId));
}

export function closeDatasetTab(datasetId: string, tabId: DatasetTabId): { closedLast: boolean } {
  const result = closeDatasetTabReducer(snapshot, datasetId, tabId);
  commit(result.tabsByDataset);
  return { closedLast: result.closedLast };
}

export function openTraceTab(datasetId: string, input: OpenTraceTabInput): void {
  commit(openTraceTabReducer(snapshot, datasetId, input));
}

/**
 * Test-only helper. Resets the module-level state so each test starts with
 * a clean slate; without this tests would leak tabs across cases.
 */
export function resetDatasetTabsStoreForTests(): void {
  snapshot = {};
  listeners.clear();
}
