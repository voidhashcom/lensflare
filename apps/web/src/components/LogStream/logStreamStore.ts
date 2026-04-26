import {
  evaluateFilter,
  type FilterNode,
  type TelemetryLogPageInfo,
  type TelemetryRecord,
  type TelemetryRecordPage,
} from "@lensflare/contracts";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { bucketCount } from "@lensflare/analytics";
import { captureWebEvent, recordTelemetryFirstDataSeen } from "~/analytics";
import { preloadTelemetryFilterCatalog } from "~/collections/telemetryFilterCatalogCollection";
import { listDatasetTelemetry, subscribeDatasetTelemetryEntries } from "~/data/logApi";

import type { DatasetTelemetryTabId } from "./datasetTabs";
import {
  clearTelemetryDatasetCache,
  clearTelemetryHistoryRetention,
  getTelemetryRecord,
  pinTelemetryRecord,
  resetTelemetryEntityCacheForTests,
  retainTelemetryHistoryIds,
  retainTelemetryLiveIds,
  storeTelemetryRecords,
  unpinTelemetryRecord,
} from "./telemetryEntityCache";
import { normalizeTelemetrySortTimestamp, toTelemetryEntry } from "./telemetryEntry";
import { resetTraceContextStoreForTests } from "./traceContextStore";
import type { SourceIconKind, TelemetryEntry } from "./types";

export type DatasetStreamKey = `${string}:${string}`;
export type TelemetryTabMode = "live" | "history";

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
  readonly mode: TelemetryTabMode;
  readonly metadata: DatasetStreamMetadata;
  readonly filterSource: string;
  readonly filter: FilterNode | null;
  readonly rowIds: ReadonlyArray<string>;
  readonly pageInfo: TelemetryLogPageInfo | null;
  readonly selectedEntryId: string | null;
  readonly isInitialLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isLoadingOlder: boolean;
  readonly errorMessage: string | null;
  readonly hasLoadedOnce: boolean;
  readonly rowsRevision: number;
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
  liveIds: ReadonlyArray<string>;
  pendingLiveRecords: ReadonlyArray<TelemetryRecord>;
  views: Map<DatasetTelemetryTabId, DatasetStreamView>;
  activeCount: number;
  subscriptionCancel: (() => void) | undefined;
  pendingLiveFlushTimer: ReturnType<typeof setTimeout> | null;
  lastTouchedAt: number;
  liveRevision: number;
  errorMessage: string | null;
}

interface DatasetStreamView {
  readonly viewId: DatasetTelemetryTabId;
  mode: TelemetryTabMode;
  filterSource: string;
  filter: FilterNode | null;
  rowIds: ReadonlyArray<string>;
  liveBackfillIds: ReadonlyArray<string>;
  pageInfo: TelemetryLogPageInfo | null;
  selectedEntryId: string | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isLoadingOlder: boolean;
  errorMessage: string | null;
  hasLoadedOnce: boolean;
  latestLoadPromise: Promise<void> | null;
  queuedLatestLoad: "initial" | "refresh" | null;
  olderLoadPromise: Promise<void> | null;
  lastLoadedAt: number;
  loadGeneration: number;
  rowsRevision: number;
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
const LIVE_VISIBLE_ROW_LIMIT = 100;
const LIVE_RING_RECORD_LIMIT = 500;
const MAX_INACTIVE_SESSIONS = 4;
const STALE_AFTER_MS = 30_000;
const DEFAULT_LIVE_FLUSH_DELAY_MS = 100;
const SELECTED_RECORD_PIN = "selected-detail";

const listeners = new Set<() => void>();
const sessions = new Map<DatasetStreamKey, DatasetStreamSession>();
const fallbackSnapshots = new Map<string, DatasetStreamSnapshot>();

let dependencies: LogStreamStoreDependencies = {
  listTelemetry: listDatasetTelemetry,
  subscribeTelemetry: subscribeDatasetTelemetryEntries,
  preloadFilterCatalog: preloadTelemetryFilterCatalog,
};
let liveFlushDelayMs = DEFAULT_LIVE_FLUSH_DELAY_MS;

export function subscribeDatasetStreamStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeDatasetStreamView(
  input: ActivateDatasetStreamInput,
  listener: () => void,
): () => void {
  listeners.add(listener);
  activateDatasetStream(input);
  return () => {
    listeners.delete(listener);
    deactivateDatasetStream(input.projectId, input.datasetId, input.viewId);
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

  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeDatasetStreamView(
        { projectId, datasetId, viewId, metadata: stableMetadata },
        listener,
      ),
    [datasetId, projectId, stableMetadata, viewId],
  );

  const getSnapshot = useCallback(
    () => getDatasetStreamSnapshot(projectId, datasetId, viewId, stableMetadata),
    [datasetId, projectId, stableMetadata, viewId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
    void loadLatestDatasetTelemetry(session, view, "initial");
    return;
  }

  if (view.mode === "live" && Date.now() - view.lastLoadedAt > STALE_AFTER_MS) {
    void loadLatestDatasetTelemetry(session, view, "refresh");
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
  if (input.filter !== null) {
    captureWebEvent("filter_applied", {
      filterKind: classifyFilterKind(input.source),
    });
  }

  unpinSelectedRecord(session, view);
  clearTelemetryHistoryRetention(session.projectId, session.datasetId, view.viewId);
  view.mode = "live";
  view.filterSource = input.source;
  view.filter = input.filter;
  view.rowIds = [];
  view.liveBackfillIds = [];
  view.pageInfo = null;
  view.selectedEntryId = null;
  view.errorMessage = null;
  view.loadGeneration += 1;
  markRowsChanged(view);
  commitView(session, view);
  void loadLatestDatasetTelemetry(session, view, view.hasLoadedOnce ? "refresh" : "initial");
}

export function enterTelemetryHistoryMode(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId = "telemetry:1",
): void {
  const session = sessions.get(toDatasetStreamKey(projectId, datasetId));
  const view = session?.views.get(viewId);
  if (!session || !view || view.mode === "history") {
    return;
  }
  view.mode = "history";
  view.rowIds = deriveLiveRowIds(session, view);
  retainTelemetryHistoryIds(projectId, datasetId, viewId, view.rowIds);
  markRowsChanged(view);
  commitView(session, view);
}

export function returnTelemetryViewToLive(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId = "telemetry:1",
): void {
  const session = sessions.get(toDatasetStreamKey(projectId, datasetId));
  const view = session?.views.get(viewId);
  if (!session || !view) {
    return;
  }
  unpinSelectedRecord(session, view);
  clearTelemetryHistoryRetention(projectId, datasetId, viewId);
  view.mode = "live";
  view.rowIds = [];
  view.liveBackfillIds = [];
  view.pageInfo = null;
  view.selectedEntryId = null;
  view.errorMessage = null;
  view.loadGeneration += 1;
  markRowsChanged(view);
  commitView(session, view);
  void loadLatestDatasetTelemetry(session, view, view.hasLoadedOnce ? "refresh" : "initial");
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
  if (view.mode === "live") {
    enterTelemetryHistoryMode(projectId, datasetId, viewId);
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

      storeTelemetryRecords(projectId, datasetId, page.entries);
      captureWebEvent("telemetry_history_loaded", {
        hadCursor: true,
        pageSizeBucket: bucketCount(page.entries.length),
      });
      const pageIds = page.entries.map((entry) => entry.id);
      const latestPageInfo = view.pageInfo;
      view.rowIds = mergeUniqueRecordIds(projectId, datasetId, pageIds, view.rowIds);
      view.pageInfo = {
        hasPreviousPage: page.pageInfo.hasPreviousPage,
        hasNextPage: latestPageInfo?.hasNextPage ?? page.pageInfo.hasNextPage,
        startCursor: page.pageInfo.startCursor ?? latestPageInfo?.startCursor ?? null,
        endCursor: latestPageInfo?.endCursor ?? page.pageInfo.endCursor,
      };
      retainTelemetryHistoryIds(projectId, datasetId, viewId, view.rowIds);
      view.errorMessage = null;
      markRowsChanged(view);
    })
    .catch((error: unknown) => {
      view.errorMessage = error instanceof Error ? error.message : "Failed to load telemetry.";
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
  if (view.selectedEntryId === logId) {
    return;
  }
  unpinSelectedRecord(session, view);
  if (logId !== null && view.mode === "live") {
    view.mode = "history";
    view.rowIds = deriveLiveRowIds(session, view);
    retainTelemetryHistoryIds(projectId, datasetId, viewId, view.rowIds);
    markRowsChanged(view);
  }
  view.selectedEntryId = logId;
  if (logId !== null) {
    const selected = getTelemetryRecord(projectId, datasetId, logId);
    if (selected) {
      captureWebEvent("telemetry_entry_selected", {
        recordKind: selected.kind,
      });
    }
    pinTelemetryRecord(projectId, datasetId, logId, SELECTED_RECORD_PIN);
  }
  commitView(session, view);
}

export function clearTelemetrySelection(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId = "telemetry:1",
): void {
  selectDatasetTelemetryEntry(projectId, datasetId, viewId, null);
}

export async function refreshDatasetTelemetry(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId = "telemetry:1",
): Promise<void> {
  const session = sessions.get(toDatasetStreamKey(projectId, datasetId));
  const view = session?.views.get(viewId);
  if (!session || !view) {
    return;
  }
  if (view.mode === "history") {
    return;
  }
  return loadLatestDatasetTelemetry(session, view, view.hasLoadedOnce ? "refresh" : "initial");
}

export function invalidateDatasetTelemetry(projectId: string, datasetId: string): void {
  const key = toDatasetStreamKey(projectId, datasetId);
  const session = sessions.get(key);
  if (!session) {
    return;
  }
  session.subscriptionCancel?.();
  clearPendingLiveFlush(session);
  clearTelemetryDatasetCache(projectId, datasetId);
  sessions.delete(key);
  deleteFallbackSnapshots(projectId, datasetId);
  emit();
}

export function resolveTelemetryEntry(
  projectId: string,
  datasetId: string,
  entryId: string,
): TelemetryEntry | null {
  const session = sessions.get(toDatasetStreamKey(projectId, datasetId));
  const record = getTelemetryRecord(projectId, datasetId, entryId);
  if (!record) {
    return null;
  }
  return toTelemetryEntry(
    record,
    session?.metadata.datasetName ?? "Dataset",
    session?.metadata.datasetIcon ?? "js",
  );
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
  return getFallbackDatasetStreamSnapshot(projectId, datasetId, viewId, metadata);
}

export function resetLogStreamStoreForTests(): void {
  for (const session of sessions.values()) {
    session.subscriptionCancel?.();
    clearPendingLiveFlush(session);
  }
  sessions.clear();
  listeners.clear();
  fallbackSnapshots.clear();
  resetTelemetryEntityCacheForTests();
  resetTraceContextStoreForTests();
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

function loadLatestDatasetTelemetry(
  session: DatasetStreamSession,
  view: DatasetStreamView,
  mode: "initial" | "refresh",
): Promise<void> {
  if (view.latestLoadPromise) {
    view.queuedLatestLoad = mode;
    return view.latestLoadPromise;
  }

  const generation = view.loadGeneration;
  if (mode === "initial" && !view.hasLoadedOnce) {
    view.isInitialLoading = true;
  } else {
    view.isRefreshing = true;
  }
  view.errorMessage = null;
  commitView(session, view);

  view.latestLoadPromise = dependencies
    .listTelemetry(session.projectId, session.datasetId, {
      limit: LOG_PAGE_SIZE,
      filter: view.filter ?? undefined,
    })
    .then((page) => {
      if (!sessions.has(session.key) || generation !== view.loadGeneration) {
        return;
      }
      applyLatestTelemetryPage(session, view, page);
      view.hasLoadedOnce = true;
      view.lastLoadedAt = Date.now();
      view.errorMessage = null;
    })
    .catch((error: unknown) => {
      view.errorMessage = error instanceof Error ? error.message : "Failed to load telemetry.";
    })
    .finally(() => {
      const queuedLatestLoad = view.queuedLatestLoad;
      view.queuedLatestLoad = null;
      view.isInitialLoading = false;
      view.isRefreshing = false;
      view.latestLoadPromise = null;
      commitView(session, view);
      if (queuedLatestLoad !== null && sessions.has(session.key)) {
        void loadLatestDatasetTelemetry(session, view, queuedLatestLoad);
      }
    });

  return view.latestLoadPromise;
}

function applyLatestTelemetryPage(
  session: DatasetStreamSession,
  view: DatasetStreamView,
  page: TelemetryRecordPage,
): void {
  storeTelemetryRecords(session.projectId, session.datasetId, page.entries);
  if (page.entries.length > 0) {
    recordTelemetryFirstDataSeen(page.entries);
  }
  const pageIds = page.entries.map((entry) => entry.id);
  view.liveBackfillIds = pageIds;
  view.pageInfo = page.pageInfo;
  if (view.mode === "history") {
    view.rowIds = mergeUniqueRecordIds(session.projectId, session.datasetId, view.rowIds, pageIds);
    retainTelemetryHistoryIds(session.projectId, session.datasetId, view.viewId, view.rowIds);
  }
  markRowsChanged(view);
}

function classifyFilterKind(source: string): string {
  const normalized = source.trim().toLowerCase();
  if (normalized.length === 0) {
    return "text";
  }
  if (normalized.includes(" and ") || normalized.includes(" or ")) {
    return "compound";
  }
  if (normalized.includes("level")) {
    return "level";
  }
  if (normalized.includes("kind")) {
    return "kind";
  }
  if (normalized.includes("time") || normalized.includes("timestamp")) {
    return "time";
  }
  if (normalized.includes(".")) {
    return "field";
  }
  return "text";
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
      session.errorMessage = error.message;
      commitSessionViews(session);
    },
  );
}

function queueLiveTelemetryRecord(session: DatasetStreamSession, entry: TelemetryRecord): void {
  session.pendingLiveRecords = mergeUniqueRecords(session.pendingLiveRecords, [entry]);
  session.errorMessage = null;
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
  storeTelemetryRecords(session.projectId, session.datasetId, pendingRecords);
  session.liveIds = trimNewestRecordIds(
    session.projectId,
    session.datasetId,
    mergeUniqueRecordIds(
      session.projectId,
      session.datasetId,
      session.liveIds,
      pendingRecords.map((record) => record.id),
    ),
    LIVE_RING_RECORD_LIMIT,
  );
  session.liveRevision += 1;
  retainTelemetryLiveIds(session.projectId, session.datasetId, session.liveIds);

  for (const view of session.views.values()) {
    if (view.mode === "live") {
      markRowsChanged(view);
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
    liveIds: [],
    pendingLiveRecords: [],
    views: new Map(),
    activeCount: 0,
    subscriptionCancel: undefined,
    pendingLiveFlushTimer: null,
    lastTouchedAt: Date.now(),
    liveRevision: 0,
    errorMessage: null,
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

function createInitialViewState(viewId: DatasetTelemetryTabId): DatasetStreamView {
  return {
    viewId,
    mode: "live",
    filterSource: "",
    filter: null,
    rowIds: [],
    liveBackfillIds: [],
    pageInfo: null,
    selectedEntryId: null,
    isInitialLoading: true,
    isRefreshing: false,
    isLoadingOlder: false,
    errorMessage: null,
    hasLoadedOnce: false,
    latestLoadPromise: null,
    queuedLatestLoad: null,
    olderLoadPromise: null,
    lastLoadedAt: 0,
    loadGeneration: 0,
    rowsRevision: 0,
    snapshot: undefined as unknown as DatasetStreamSnapshot,
  };
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
  const rowIds = view.mode === "live" ? deriveLiveRowIds(session, view) : view.rowIds;
  return {
    projectId: session.projectId,
    datasetId: session.datasetId,
    viewId: view.viewId,
    mode: view.mode,
    metadata: session.metadata,
    filterSource: view.filterSource,
    filter: view.filter,
    rowIds,
    pageInfo: view.pageInfo,
    selectedEntryId: view.selectedEntryId,
    isInitialLoading: view.isInitialLoading,
    isRefreshing: view.isRefreshing,
    isLoadingOlder: view.isLoadingOlder,
    errorMessage: view.errorMessage ?? session.errorMessage,
    hasLoadedOnce: view.hasLoadedOnce,
    rowsRevision: view.rowsRevision + (view.mode === "live" ? session.liveRevision : 0),
  };
}

function getFallbackDatasetStreamSnapshot(
  projectId: string,
  datasetId: string,
  viewId: DatasetTelemetryTabId,
  metadata: DatasetStreamMetadata | undefined,
): DatasetStreamSnapshot {
  const key = `${projectId}:${datasetId}:${viewId}`;
  const nextMetadata = metadata ?? { datasetName: "Dataset" };
  const existing = fallbackSnapshots.get(key);
  if (existing && sameMetadata(existing.metadata, nextMetadata)) {
    return existing;
  }

  const snapshot: DatasetStreamSnapshot = {
    projectId,
    datasetId,
    viewId,
    mode: "live",
    metadata: nextMetadata,
    filterSource: "",
    filter: null,
    rowIds: [],
    pageInfo: null,
    selectedEntryId: null,
    isInitialLoading: true,
    isRefreshing: false,
    isLoadingOlder: false,
    errorMessage: null,
    hasLoadedOnce: false,
    rowsRevision: 0,
  };
  fallbackSnapshots.set(key, snapshot);
  return snapshot;
}

function deriveLiveRowIds(
  session: DatasetStreamSession,
  view: DatasetStreamView,
): ReadonlyArray<string> {
  const matchingLiveIds =
    view.filter === null
      ? session.liveIds
      : session.liveIds.filter((id) => {
          const record = getTelemetryRecord(session.projectId, session.datasetId, id);
          return record !== null && evaluateFilter(view.filter!, record);
        });
  return trimNewestRecordIds(
    session.projectId,
    session.datasetId,
    mergeUniqueRecordIds(
      session.projectId,
      session.datasetId,
      view.liveBackfillIds,
      matchingLiveIds,
    ),
    LIVE_VISIBLE_ROW_LIMIT,
  );
}

function updateMetadata(session: DatasetStreamSession, metadata: DatasetStreamMetadata): void {
  if (sameMetadata(session.metadata, metadata)) {
    return;
  }
  session.metadata = metadata;
  commitSessionViews(session);
}

function sameMetadata(left: DatasetStreamMetadata, right: DatasetStreamMetadata): boolean {
  return (
    left.datasetName === right.datasetName &&
    left.datasetSlug === right.datasetSlug &&
    left.projectSlug === right.projectSlug &&
    left.datasetIcon === right.datasetIcon
  );
}

function deleteFallbackSnapshots(projectId: string, datasetId: string): void {
  const prefix = `${projectId}:${datasetId}:`;
  for (const key of fallbackSnapshots.keys()) {
    if (key.startsWith(prefix)) {
      fallbackSnapshots.delete(key);
    }
  }
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
    clearTelemetryDatasetCache(session.projectId, session.datasetId);
    sessions.delete(session.key);
    deleteFallbackSnapshots(session.projectId, session.datasetId);
  }
}

function unpinSelectedRecord(session: DatasetStreamSession, view: DatasetStreamView): void {
  if (view.selectedEntryId === null) {
    return;
  }
  unpinTelemetryRecord(
    session.projectId,
    session.datasetId,
    view.selectedEntryId,
    SELECTED_RECORD_PIN,
  );
}

function markRowsChanged(view: DatasetStreamView): void {
  view.rowsRevision += 1;
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

function mergeUniqueRecordIds(
  projectId: string,
  datasetId: string,
  first: ReadonlyArray<string>,
  second: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const ids = new Set<string>();
  for (const id of first) {
    if (getTelemetryRecord(projectId, datasetId, id) !== null) {
      ids.add(id);
    }
  }
  for (const id of second) {
    if (getTelemetryRecord(projectId, datasetId, id) !== null) {
      ids.add(id);
    }
  }
  return [...ids].sort((left, right) => compareRecordIds(projectId, datasetId, left, right));
}

function trimNewestRecordIds(
  projectId: string,
  datasetId: string,
  ids: ReadonlyArray<string>,
  limit: number,
): ReadonlyArray<string> {
  if (ids.length <= limit) {
    return ids;
  }
  return ids.slice(ids.length - limit);
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

function compareRecordIds(
  projectId: string,
  datasetId: string,
  leftId: string,
  rightId: string,
): number {
  const left = getTelemetryRecord(projectId, datasetId, leftId);
  const right = getTelemetryRecord(projectId, datasetId, rightId);
  if (left === null || right === null) {
    return leftId.localeCompare(rightId);
  }
  return compareRecords(left, right);
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
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
