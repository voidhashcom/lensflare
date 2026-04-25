import {
  evaluateFilter,
  type FilterNode,
  type TelemetryLogPageInfo,
  type TelemetryRecord,
  type TelemetryRecordPage,
} from "@lensflare/contracts";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { preloadTelemetryFilterCatalog } from "~/collections/telemetryFilterCatalogCollection";
import { listDatasetTelemetry, subscribeDatasetTelemetryEntries } from "~/data/logApi";

import type { DatasetTelemetryTabId } from "./datasetTabs";
import {
  mergeUniqueLogs,
  normalizeTelemetrySortTimestamp,
  toTelemetryEntry,
} from "./telemetryEntry";
import type { SourceIconKind, TelemetryEntry } from "./types";

export type DatasetStreamKey = `${string}:${string}`;

export interface DatasetStreamIdentity {
  readonly projectId: string;
  readonly datasetId: string;
}

export interface DatasetStreamMetadata {
  readonly datasetName: string;
  readonly datasetSlug?: string | undefined;
  readonly projectSlug?: string | undefined;
  readonly datasetIcon?: SourceIconKind | undefined;
}

export interface DatasetStreamSnapshot {
  readonly projectId: string;
  readonly datasetId: string;
  readonly viewId: DatasetTelemetryTabId;
  readonly metadata: DatasetStreamMetadata;
  readonly filterSource: string;
  readonly filter: FilterNode | null;
  readonly logs: ReadonlyArray<TelemetryEntry>;
  readonly pageInfo: TelemetryLogPageInfo | null;
  readonly selectedLogId: string | null;
  readonly selectedLog: TelemetryEntry | null;
  readonly isInitialLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isLoadingOlder: boolean;
  readonly errorMessage: string | null;
  readonly hasLoadedOnce: boolean;
}

interface ActivateDatasetStreamInput {
  readonly projectId: string;
  readonly datasetId: string;
  readonly viewId: DatasetTelemetryTabId;
  readonly metadata: DatasetStreamMetadata;
}

interface SetDatasetStreamFilterInput {
  readonly projectId: string;
  readonly datasetId: string;
  readonly viewId: DatasetTelemetryTabId;
  readonly source: string;
  readonly filter: FilterNode | null;
}

interface DatasetStreamSession {
  readonly key: DatasetStreamKey;
  readonly projectId: string;
  readonly datasetId: string;
  metadata: DatasetStreamMetadata;
  rawRecentRecords: ReadonlyArray<TelemetryRecord>;
  pendingLiveRecords: ReadonlyArray<TelemetryRecord>;
  views: Map<DatasetTelemetryTabId, DatasetStreamView>;
  activeCount: number;
  subscriptionCancel: (() => void) | undefined;
  pendingLiveFlushTimer: ReturnType<typeof setTimeout> | null;
  lastTouchedAt: number;
}

interface DatasetStreamView {
  readonly viewId: DatasetTelemetryTabId;
  filterSource: string;
  filter: FilterNode | null;
  logs: ReadonlyArray<TelemetryEntry>;
  pageInfo: TelemetryLogPageInfo | null;
  selectedLogId: string | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isLoadingOlder: boolean;
  errorMessage: string | null;
  hasLoadedOnce: boolean;
  initialLoadPromise: Promise<void> | null;
  queuedInitialLoad: "initial" | "refresh" | null;
  olderLoadPromise: Promise<void> | null;
  lastLoadedAt: number;
  loadGeneration: number;
  snapshot: DatasetStreamSnapshot;
}

interface LogStreamStoreDependencies {
  readonly listTelemetry: typeof listDatasetTelemetry;
  readonly subscribeTelemetry: typeof subscribeDatasetTelemetryEntries;
  readonly preloadFilterCatalog: typeof preloadTelemetryFilterCatalog;
}

interface LogStreamStoreTestConfiguration extends Partial<LogStreamStoreDependencies> {
  readonly liveFlushDelayMs?: number;
}

const LOG_PAGE_SIZE = 100;
const MAX_INACTIVE_SESSIONS = 4;
const MAX_RECENT_RECORDS_PER_SESSION = 10_000;
const STALE_AFTER_MS = 30_000;
const DEFAULT_LIVE_FLUSH_DELAY_MS = 125;

const listeners = new Set<() => void>();
const sessions = new Map<DatasetStreamKey, DatasetStreamSession>();

let dependencies: LogStreamStoreDependencies = {
  listTelemetry: listDatasetTelemetry,
  subscribeTelemetry: subscribeDatasetTelemetryEntries,
  preloadFilterCatalog: preloadTelemetryFilterCatalog,
};
let liveFlushDelayMs = DEFAULT_LIVE_FLUSH_DELAY_MS;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeDatasetStreamStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDatasetStreamSnapshot(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId,
  metadata: DatasetStreamMetadata,
): DatasetStreamSnapshot {
  const stableMetadata = useMemo(
    () => metadata,
    [metadata.datasetIcon, metadata.datasetName, metadata.datasetSlug, metadata.projectSlug],
  );

  getOrCreateView(getOrCreateSession(projectId, datasetId, stableMetadata), viewId);

  useEffect(() => {
    activateDatasetStream({ projectId, datasetId, viewId, metadata: stableMetadata });
    return () => {
      deactivateDatasetStream(projectId, datasetId, viewId);
    };
  }, [datasetId, projectId, stableMetadata, viewId]);

  return useSyncExternalStore(
    subscribeDatasetStreamStore,
    () => getDatasetStreamSnapshot(projectId, datasetId, viewId, stableMetadata),
    () => getDatasetStreamSnapshot(projectId, datasetId, viewId, stableMetadata),
  );
}

export function activateDatasetStream(input: ActivateDatasetStreamInput): void {
  const session = getOrCreateSession(input.projectId, input.datasetId, input.metadata);
  const view = getOrCreateView(session, input.viewId);
  session.activeCount += 1;
  touchSession(session);
  updateMetadata(session, input.metadata);
  ensureSubscription(session);
  void dependencies.preloadFilterCatalog(input.projectId, input.datasetId).catch(() => {});

  if (!view.hasLoadedOnce) {
    void loadInitialDatasetTelemetry(session, view, "initial");
    return;
  }

  if (Date.now() - view.lastLoadedAt > STALE_AFTER_MS) {
    void loadInitialDatasetTelemetry(session, view, "refresh");
  }

  evictInactiveSessions();
}

export function deactivateDatasetStream(
  projectId: string,
  datasetId: string,
  _viewId: DatasetTelemetryTabId = "telemetry:1",
): void {
  const session = sessions.get(toDatasetStreamKey(projectId, datasetId));
  if (!session) {
    return;
  }
  session.activeCount = Math.max(0, session.activeCount - 1);
  touchSession(session);
  evictInactiveSessions();
}

export function setDatasetStreamFilter(input: SetDatasetStreamFilterInput): void {
  const session = getOrCreateSession(input.projectId, input.datasetId);
  const view = getOrCreateView(session, input.viewId);
  if (view.filterSource === input.source && sameFilter(view.filter, input.filter)) {
    return;
  }

  view.filterSource = input.source;
  view.filter = input.filter;
  view.pageInfo = null;
  view.logs = filterRecordsForView(view, session.rawRecentRecords).map((entry) =>
    toTelemetryEntry(entry, session.metadata.datasetName, session.metadata.datasetIcon ?? "js"),
  );
  view.selectedLogId = selectedLogStillVisible(view) ? view.selectedLogId : null;
  view.errorMessage = null;
  view.loadGeneration += 1;
  commitView(session, view);
  void loadInitialDatasetTelemetry(session, view, view.hasLoadedOnce ? "refresh" : "initial");
}

export async function loadOlderDatasetTelemetry(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId = "telemetry:1",
): Promise<void> {
  const session = sessions.get(toDatasetStreamKey(projectId, datasetId));
  if (!session) {
    return;
  }
  const view = session.views.get(viewId);
  if (!view) {
    return;
  }
  if (view.olderLoadPromise) {
    return view.olderLoadPromise;
  }
  if (!view.pageInfo?.hasPreviousPage || !view.pageInfo.startCursor) {
    return;
  }

  view.isLoadingOlder = true;
  commitView(session, view);

  const generation = view.loadGeneration;
  view.olderLoadPromise = dependencies
    .listTelemetry(projectId, datasetId, {
      cursor: view.pageInfo.startCursor,
      direction: "older",
      limit: LOG_PAGE_SIZE,
      filter: view.filter ?? undefined,
    })
    .then((page) => {
      if (!sessions.has(session.key) || generation !== view.loadGeneration) {
        return;
      }

      const entries = page.entries.map((entry) =>
        toTelemetryEntry(
          entry,
          session.metadata.datasetName,
          session.metadata.datasetIcon ?? "js",
        ),
      );
      const latestPageInfo = view.pageInfo;
      view.logs = mergeUniqueLogs(entries, view.logs);
      view.pageInfo = {
        hasPreviousPage: page.pageInfo.hasPreviousPage,
        hasNextPage: latestPageInfo?.hasNextPage ?? page.pageInfo.hasNextPage,
        startCursor: page.pageInfo.startCursor ?? latestPageInfo?.startCursor ?? null,
        endCursor: latestPageInfo?.endCursor ?? page.pageInfo.endCursor,
      };
      view.errorMessage = null;
    })
    .catch((error: unknown) => {
      view.errorMessage =
        error instanceof Error ? error.message : "Failed to load telemetry.";
    })
    .finally(() => {
      view.isLoadingOlder = false;
      view.olderLoadPromise = null;
      commitView(session, view);
    });

  return view.olderLoadPromise;
}

export function selectDatasetTelemetryEntry(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId,
  logId: string | null,
): void {
  const session = getOrCreateSession(projectId, datasetId);
  const view = getOrCreateView(session, viewId);
  if (view.selectedLogId === logId) {
    return;
  }
  view.selectedLogId = logId;
  commitView(session, view);
}

export async function refreshDatasetTelemetry(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId = "telemetry:1",
): Promise<void> {
  const session = sessions.get(toDatasetStreamKey(projectId, datasetId));
  if (!session) {
    return;
  }
  const view = session.views.get(viewId);
  if (!view) {
    return;
  }
  return loadInitialDatasetTelemetry(session, view, view.hasLoadedOnce ? "refresh" : "initial");
}

export function invalidateDatasetTelemetry(projectId: string, datasetId: string): void {
  const key = toDatasetStreamKey(projectId, datasetId);
  const session = sessions.get(key);
  if (!session) {
    return;
  }
  session.subscriptionCancel?.();
  clearPendingLiveFlush(session);
  sessions.delete(key);
  emit();
}

export function getDatasetStreamSnapshot(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId = "telemetry:1",
  metadata?: DatasetStreamMetadata,
): DatasetStreamSnapshot {
  const session = sessions.get(toDatasetStreamKey(projectId, datasetId));
  if (session) {
    const view = session.views.get(viewId);
    if (view) {
      return view.snapshot;
    }
  }
  return createSnapshot(
    {
      key: toDatasetStreamKey(projectId, datasetId),
      projectId,
      datasetId,
      metadata: metadata ?? { datasetName: "Dataset" },
      rawRecentRecords: [],
      pendingLiveRecords: [],
      views: new Map(),
      activeCount: 0,
      subscriptionCancel: undefined,
      pendingLiveFlushTimer: null,
      lastTouchedAt: 0,
    },
    createInitialViewState(viewId),
  );
}

function createInitialViewState(viewId: DatasetTelemetryTabId): DatasetStreamView {
  return {
    viewId,
    filterSource: "",
    filter: null,
    logs: [],
    pageInfo: null,
    selectedLogId: null,
    isInitialLoading: true,
    isRefreshing: false,
    isLoadingOlder: false,
    errorMessage: null,
    hasLoadedOnce: false,
    initialLoadPromise: null,
    queuedInitialLoad: null,
    olderLoadPromise: null,
    lastLoadedAt: 0,
    loadGeneration: 0,
    snapshot: undefined as unknown as DatasetStreamSnapshot,
  };
}

export function resetLogStreamStoreForTests(): void {
  for (const session of sessions.values()) {
    session.subscriptionCancel?.();
    clearPendingLiveFlush(session);
  }
  sessions.clear();
  listeners.clear();
  dependencies = {
    listTelemetry: listDatasetTelemetry,
    subscribeTelemetry: subscribeDatasetTelemetryEntries,
    preloadFilterCatalog: preloadTelemetryFilterCatalog,
  };
  liveFlushDelayMs = DEFAULT_LIVE_FLUSH_DELAY_MS;
}

export function configureLogStreamStoreForTests(
  nextConfiguration: LogStreamStoreTestConfiguration,
): void {
  const { liveFlushDelayMs: nextLiveFlushDelayMs, ...nextDependencies } = nextConfiguration;
  dependencies = {
    ...dependencies,
    ...nextDependencies,
  };
  if (nextLiveFlushDelayMs !== undefined) {
    liveFlushDelayMs = nextLiveFlushDelayMs;
  }
}

export function getLogStreamStoreSessionCountForTests(): number {
  return sessions.size;
}

function loadInitialDatasetTelemetry(
  session: DatasetStreamSession,
  view: DatasetStreamView,
  mode: "initial" | "refresh",
): Promise<void> {
  if (view.initialLoadPromise) {
    view.queuedInitialLoad = mode;
    return view.initialLoadPromise;
  }

  const generation = view.loadGeneration;
  if (mode === "initial" && !view.hasLoadedOnce) {
    view.isInitialLoading = true;
  } else {
    view.isRefreshing = true;
  }
  view.errorMessage = null;
  commitView(session, view);

  view.initialLoadPromise = dependencies
    .listTelemetry(session.projectId, session.datasetId, {
      limit: LOG_PAGE_SIZE,
      filter: view.filter ?? undefined,
    })
    .then((page) => {
      if (!sessions.has(session.key) || generation !== view.loadGeneration) {
        return;
      }
      applyTelemetryPage(session, view, page);
      view.hasLoadedOnce = true;
      view.lastLoadedAt = Date.now();
      view.errorMessage = null;
    })
    .catch((error: unknown) => {
      view.errorMessage =
        error instanceof Error ? error.message : "Failed to load telemetry.";
    })
    .finally(() => {
      const queuedInitialLoad = view.queuedInitialLoad;
      view.queuedInitialLoad = null;
      view.isInitialLoading = false;
      view.isRefreshing = false;
      view.initialLoadPromise = null;
      commitView(session, view);
      if (queuedInitialLoad !== null && sessions.has(session.key)) {
        void loadInitialDatasetTelemetry(session, view, queuedInitialLoad);
      }
    });

  return view.initialLoadPromise;
}

function applyTelemetryPage(
  session: DatasetStreamSession,
  view: DatasetStreamView,
  page: TelemetryRecordPage,
): void {
  const pageEntries = page.entries.map((entry) =>
    toTelemetryEntry(entry, session.metadata.datasetName, session.metadata.datasetIcon ?? "js"),
  );
  const matchingLiveRecords = filterRecordsForView(view, session.rawRecentRecords).map((entry) =>
    toTelemetryEntry(entry, session.metadata.datasetName, session.metadata.datasetIcon ?? "js"),
  );

  view.logs = mergeUniqueLogs(view.logs, mergeUniqueLogs(pageEntries, matchingLiveRecords));
  const previousPageInfo = view.pageInfo;
  view.pageInfo =
    view.hasLoadedOnce && previousPageInfo !== null
      ? {
          hasPreviousPage: previousPageInfo.hasPreviousPage,
          hasNextPage: page.pageInfo.hasNextPage,
          startCursor: previousPageInfo.startCursor ?? page.pageInfo.startCursor,
          endCursor: page.pageInfo.endCursor ?? previousPageInfo.endCursor,
        }
      : page.pageInfo;
  view.selectedLogId = selectedLogStillVisible(view) ? view.selectedLogId : null;
}

function ensureSubscription(session: DatasetStreamSession): void {
  if (session.subscriptionCancel !== undefined) {
    return;
  }

  session.subscriptionCancel = dependencies.subscribeTelemetry(
    session.projectId,
    session.datasetId,
    (entry) => {
      if (!sessions.has(session.key)) {
        return;
      }
      queueLiveTelemetryRecord(session, entry);
    },
    (error) => {
      for (const view of session.views.values()) {
        view.errorMessage = error.message;
      }
      commitSessionViews(session);
    },
  );
}

function queueLiveTelemetryRecord(
  session: DatasetStreamSession,
  entry: TelemetryRecord,
): void {
  session.pendingLiveRecords = mergeUniqueRecords(session.pendingLiveRecords, [entry]);
  for (const view of session.views.values()) {
    view.errorMessage = null;
  }

  if (liveFlushDelayMs <= 0) {
    flushPendingLiveRecords(session);
    return;
  }

  if (session.pendingLiveFlushTimer !== null) {
    return;
  }

  session.pendingLiveFlushTimer = setTimeout(() => {
    session.pendingLiveFlushTimer = null;
    flushPendingLiveRecords(session);
  }, liveFlushDelayMs);
}

function flushPendingLiveRecords(session: DatasetStreamSession): void {
  if (!sessions.has(session.key) || session.pendingLiveRecords.length === 0) {
    return;
  }

  const pendingRecords = session.pendingLiveRecords;
  session.pendingLiveRecords = [];
  session.rawRecentRecords = trimNewestRecords(
    mergeUniqueRecords(session.rawRecentRecords, pendingRecords),
    MAX_RECENT_RECORDS_PER_SESSION,
  );

  for (const view of session.views.values()) {
    const matchingEntries = filterRecordsForView(view, pendingRecords).map((entry) =>
      toTelemetryEntry(entry, session.metadata.datasetName, session.metadata.datasetIcon ?? "js"),
    );
    if (matchingEntries.length > 0) {
      view.logs = mergeUniqueLogs(view.logs, matchingEntries);
    }
    view.errorMessage = null;
  }

  commitSessionViews(session);
}

function clearPendingLiveFlush(session: DatasetStreamSession): void {
  if (session.pendingLiveFlushTimer === null) {
    return;
  }
  clearTimeout(session.pendingLiveFlushTimer);
  session.pendingLiveFlushTimer = null;
}

function getOrCreateSession(
  projectId: string,
  datasetId: string,
  metadata: DatasetStreamMetadata = { datasetName: "Dataset" },
): DatasetStreamSession {
  const key = toDatasetStreamKey(projectId, datasetId);
  const existing = sessions.get(key);
  if (existing) {
    return existing;
  }

  const session: DatasetStreamSession = {
    key,
    projectId,
    datasetId,
    metadata,
    rawRecentRecords: [],
    pendingLiveRecords: [],
    views: new Map(),
    activeCount: 0,
    subscriptionCancel: undefined,
    pendingLiveFlushTimer: null,
    lastTouchedAt: Date.now(),
  };
  sessions.set(key, session);
  return session;
}

function getOrCreateView(
  session: DatasetStreamSession,
  viewId: DatasetTelemetryTabId,
): DatasetStreamView {
  const existing = session.views.get(viewId);
  if (existing) {
    return existing;
  }

  const view = createInitialViewState(viewId);
  view.snapshot = createSnapshot(session, view);
  session.views.set(viewId, view);
  return view;
}

function commitView(session: DatasetStreamSession, view: DatasetStreamView): void {
  view.snapshot = createSnapshot(session, view);
  emit();
}

function commitSessionViews(session: DatasetStreamSession): void {
  for (const view of session.views.values()) {
    view.snapshot = createSnapshot(session, view);
  }
  emit();
}

function createSnapshot(
  session: DatasetStreamSession,
  view: DatasetStreamView,
): DatasetStreamSnapshot {
  const selectedLog =
    view.selectedLogId === null
      ? null
      : view.logs.find((log) => log.id === view.selectedLogId) ?? null;
  return {
    projectId: session.projectId,
    datasetId: session.datasetId,
    viewId: view.viewId,
    metadata: session.metadata,
    filterSource: view.filterSource,
    filter: view.filter,
    logs: view.logs,
    pageInfo: view.pageInfo,
    selectedLogId: view.selectedLogId,
    selectedLog,
    isInitialLoading: view.isInitialLoading,
    isRefreshing: view.isRefreshing,
    isLoadingOlder: view.isLoadingOlder,
    errorMessage: view.errorMessage,
    hasLoadedOnce: view.hasLoadedOnce,
  };
}

function updateMetadata(session: DatasetStreamSession, metadata: DatasetStreamMetadata): void {
  if (
    session.metadata.datasetName === metadata.datasetName &&
    session.metadata.datasetSlug === metadata.datasetSlug &&
    session.metadata.projectSlug === metadata.projectSlug &&
    session.metadata.datasetIcon === metadata.datasetIcon
  ) {
    return;
  }
  session.metadata = metadata;
  commitSessionViews(session);
}

function touchSession(session: DatasetStreamSession): void {
  session.lastTouchedAt = Date.now();
}

function evictInactiveSessions(): void {
  const inactive = [...sessions.values()]
    .filter((session) => session.activeCount === 0)
    .sort((left, right) => left.lastTouchedAt - right.lastTouchedAt);

  while (inactive.length > MAX_INACTIVE_SESSIONS) {
    const session = inactive.shift();
    if (!session) {
      return;
    }
    session.subscriptionCancel?.();
    clearPendingLiveFlush(session);
    sessions.delete(session.key);
  }
}

function selectedLogStillVisible(view: DatasetStreamView): boolean {
  return view.selectedLogId === null || view.logs.some((log) => log.id === view.selectedLogId);
}

function filterRecordsForView(
  view: DatasetStreamView,
  records: ReadonlyArray<TelemetryRecord>,
): ReadonlyArray<TelemetryRecord> {
  return view.filter === null
    ? records
    : records.filter((entry) => evaluateFilter(view.filter!, entry));
}

function mergeUniqueRecords(
  first: ReadonlyArray<TelemetryRecord>,
  second: ReadonlyArray<TelemetryRecord>,
): ReadonlyArray<TelemetryRecord> {
  const byId = new Map<string, TelemetryRecord>();
  for (const record of first) {
    byId.set(record.id, record);
  }
  for (const record of second) {
    byId.set(record.id, record);
  }
  return [...byId.values()].sort(compareRecords);
}

function trimNewestRecords(
  records: ReadonlyArray<TelemetryRecord>,
  limit: number,
): ReadonlyArray<TelemetryRecord> {
  if (records.length <= limit) {
    return records;
  }
  return records.slice(records.length - limit);
}

function compareRecords(left: TelemetryRecord, right: TelemetryRecord): number {
  const timestampComparison = normalizeTelemetrySortTimestamp(left.timestamp).localeCompare(
    normalizeTelemetrySortTimestamp(right.timestamp),
  );
  if (timestampComparison !== 0) {
    return timestampComparison;
  }
  return left.id.localeCompare(right.id);
}

function toDatasetStreamKey(projectId: string, datasetId: string): DatasetStreamKey {
  return `${projectId}:${datasetId}`;
}

function sameFilter(left: FilterNode | null, right: FilterNode | null): boolean {
  if (left === right) {
    return true;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}
