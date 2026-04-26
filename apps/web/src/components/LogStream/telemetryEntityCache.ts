import type { TelemetryRecord } from "@lensflare/contracts";

import type { DatasetTelemetryTabId } from "./datasetTabs";

type DatasetKey = `${string}:${string}`;

interface CacheEntry {
  readonly record: TelemetryRecord;
  lastAccessedAt: number;
  readonly pins: Set<string>;
}

interface DatasetCache {
  readonly records: Map<string, CacheEntry>;
  readonly liveIds: Set<string>;
  readonly historyRetainers: Map<DatasetTelemetryTabId, Set<string>>;
}

const RETAINED_RECORD_LIMIT_PER_DATASET = 2_000;
const RETAINED_RECORD_TTL_MS = 15 * 60 * 1_000;

const datasets = new Map<DatasetKey, DatasetCache>();

export function storeTelemetryRecords(
  projectId: string,
  datasetId: string,
  records: ReadonlyArray<TelemetryRecord>,
): void {
  const cache = getOrCreateDatasetCache(projectId, datasetId);
  const now = Date.now();
  for (const record of records) {
    const existing = cache.records.get(record.id);
    cache.records.set(record.id, {
      record,
      lastAccessedAt: now,
      pins: existing?.pins ?? new Set(),
    });
  }
  pruneDatasetCache(cache, now);
}

export function getTelemetryRecord(
  projectId: string,
  datasetId: string,
  recordId: string,
): TelemetryRecord | null {
  const entry = datasets.get(toDatasetKey(projectId, datasetId))?.records.get(recordId);
  if (!entry) {
    return null;
  }
  return entry.record;
}

export function retainTelemetryLiveIds(
  projectId: string,
  datasetId: string,
  ids: ReadonlyArray<string>,
): void {
  const cache = getOrCreateDatasetCache(projectId, datasetId);
  cache.liveIds.clear();
  for (const id of ids) {
    cache.liveIds.add(id);
  }
  pruneDatasetCache(cache, Date.now());
}

export function retainTelemetryHistoryIds(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId,
  ids: ReadonlyArray<string>,
): void {
  const cache = getOrCreateDatasetCache(projectId, datasetId);
  cache.historyRetainers.set(viewId, new Set(ids));
  pruneDatasetCache(cache, Date.now());
}

export function clearTelemetryHistoryRetention(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId,
): void {
  const cache = datasets.get(toDatasetKey(projectId, datasetId));
  if (!cache) {
    return;
  }
  cache.historyRetainers.delete(viewId);
  pruneDatasetCache(cache, Date.now());
}

export function pinTelemetryRecord(
  projectId: string,
  datasetId: string,
  recordId: string,
  reason: string,
): void {
  const entry = datasets.get(toDatasetKey(projectId, datasetId))?.records.get(recordId);
  if (!entry) {
    return;
  }
  entry.pins.add(reason);
  entry.lastAccessedAt = Date.now();
}

export function unpinTelemetryRecord(
  projectId: string,
  datasetId: string,
  recordId: string,
  reason: string,
): void {
  const cache = datasets.get(toDatasetKey(projectId, datasetId));
  const entry = cache?.records.get(recordId);
  if (!cache || !entry) {
    return;
  }
  entry.pins.delete(reason);
  pruneDatasetCache(cache, Date.now());
}

export function clearTelemetryDatasetCache(projectId: string, datasetId: string): void {
  datasets.delete(toDatasetKey(projectId, datasetId));
}

export function resetTelemetryEntityCacheForTests(): void {
  datasets.clear();
}

function getOrCreateDatasetCache(projectId: string, datasetId: string): DatasetCache {
  const key = toDatasetKey(projectId, datasetId);
  const existing = datasets.get(key);
  if (existing) {
    return existing;
  }
  const cache: DatasetCache = {
    records: new Map(),
    liveIds: new Set(),
    historyRetainers: new Map(),
  };
  datasets.set(key, cache);
  return cache;
}

function pruneDatasetCache(cache: DatasetCache, now: number): void {
  const retained = new Set(cache.liveIds);
  for (const ids of cache.historyRetainers.values()) {
    for (const id of ids) {
      retained.add(id);
    }
  }

  const candidates = [...cache.records.entries()]
    .filter(([id, entry]) => {
      if (retained.has(id) || entry.pins.size > 0) {
        return false;
      }
      return now - entry.lastAccessedAt > RETAINED_RECORD_TTL_MS;
    })
    .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt);

  for (const [id] of candidates) {
    cache.records.delete(id);
  }

  const overflowCandidates = [...cache.records.entries()]
    .filter(([id, entry]) => !retained.has(id) && entry.pins.size === 0)
    .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt);

  while (overflowCandidates.length > RETAINED_RECORD_LIMIT_PER_DATASET) {
    const [id] = overflowCandidates.shift() ?? [];
    if (id === undefined) {
      return;
    }
    cache.records.delete(id);
  }
}

function toDatasetKey(projectId: string, datasetId: string): DatasetKey {
  return `${projectId}:${datasetId}`;
}
