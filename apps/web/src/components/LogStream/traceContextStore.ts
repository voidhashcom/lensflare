import { useCallback, useSyncExternalStore } from "react";

import { getLogTraceContext } from "~/data/logApi";

import type { TraceContext } from "./types";

type TraceKey = `${string}:${string}:${string}:${string}`;

export type TraceContextSnapshot =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly trace: TraceContext }
  | { readonly status: "unavailable" }
  | { readonly status: "error"; readonly message: string };

interface TraceCacheEntry {
  snapshot: TraceContextSnapshot;
  lastAccessedAt: number;
  promise: Promise<void> | null;
}

const TRACE_CACHE_LIMIT_PER_DATASET = 128;
const TRACE_CACHE_TTL_MS = 15 * 60 * 1_000;
const FAILED_TRACE_TTL_MS = 30 * 1_000;
const IDLE_TRACE_SNAPSHOT: TraceContextSnapshot = { status: "idle" };

const listeners = new Set<() => void>();
const cache = new Map<TraceKey, TraceCacheEntry>();

export function subscribeTraceContextStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeTraceContext(
  projectId: string,
  datasetId: string,
  traceId: string | null | undefined,
  spanId: string | undefined,
  listener: () => void,
): () => void {
  listeners.add(listener);
  if (traceId) {
    void prefetchTraceContext(projectId, datasetId, traceId, spanId);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useTraceContextSnapshot(
  projectId: string,
  datasetId: string,
  traceId: string | null | undefined,
  spanId?: string,
): TraceContextSnapshot {
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeTraceContext(projectId, datasetId, traceId, spanId, listener),
    [datasetId, projectId, spanId, traceId],
  );
  const getSnapshot = useCallback(
    () => getTraceContextSnapshot(projectId, datasetId, traceId, spanId),
    [datasetId, projectId, spanId, traceId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getTraceContextSnapshot(
  projectId: string,
  datasetId: string,
  traceId: string | null | undefined,
  spanId?: string,
): TraceContextSnapshot {
  if (!traceId) {
    return IDLE_TRACE_SNAPSHOT;
  }
  const entry = cache.get(toTraceKey(projectId, datasetId, traceId, spanId));
  if (!entry) {
    return IDLE_TRACE_SNAPSHOT;
  }
  return entry.snapshot;
}

export function prefetchTraceContext(
  projectId: string,
  datasetId: string,
  traceId: string,
  spanId?: string,
): Promise<void> {
  const key = toTraceKey(projectId, datasetId, traceId, spanId);
  const now = Date.now();
  const existing = cache.get(key);
  if (existing) {
    existing.lastAccessedAt = now;
    if (existing.promise) {
      return existing.promise;
    }
    if (!isExpired(existing, now)) {
      return Promise.resolve();
    }
  }

  const entry: TraceCacheEntry = existing ?? {
    snapshot: { status: "loading" },
    lastAccessedAt: now,
    promise: null,
  };
  entry.snapshot = { status: "loading" };
  entry.lastAccessedAt = now;
  cache.set(key, entry);
  emit();

  entry.promise = getLogTraceContext(projectId, datasetId, traceId, spanId)
    .then((trace) => {
      entry.snapshot = trace === null ? { status: "unavailable" } : { status: "ready", trace };
      entry.lastAccessedAt = Date.now();
    })
    .catch((error: unknown) => {
      entry.snapshot = {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load trace.",
      };
      entry.lastAccessedAt = Date.now();
    })
    .finally(() => {
      entry.promise = null;
      pruneTraceCache(projectId, datasetId);
      emit();
    });

  return entry.promise;
}

export function resetTraceContextStoreForTests(): void {
  cache.clear();
  listeners.clear();
}

function isExpired(entry: TraceCacheEntry, now: number): boolean {
  const ttl =
    entry.snapshot.status === "error" || entry.snapshot.status === "unavailable"
      ? FAILED_TRACE_TTL_MS
      : TRACE_CACHE_TTL_MS;
  return now - entry.lastAccessedAt > ttl;
}

function pruneTraceCache(projectId: string, datasetId: string): void {
  const prefix = `${projectId}:${datasetId}:`;
  const entries = [...cache.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt);
  while (entries.length > TRACE_CACHE_LIMIT_PER_DATASET) {
    const [key] = entries.shift() ?? [];
    if (!key) {
      return;
    }
    cache.delete(key);
  }
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function toTraceKey(
  projectId: string,
  datasetId: string,
  traceId: string,
  spanId?: string,
): TraceKey {
  return `${projectId}:${datasetId}:${traceId}:${spanId ?? ""}`;
}
