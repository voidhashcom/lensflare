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

import { mergeUniqueLogs, toTelemetryEntry } from "./telemetryEntry";
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
  readonly metadata: DatasetStreamMetadata;
}

interface SetDatasetStreamFilterInput {
  readonly projectId: string;
  readonly datasetId: string;
  readonly source: string;
  readonly filter: FilterNode | null;
}

interface DatasetStreamSession {
  readonly key: DatasetStreamKey;
  readonly projectId: string;
  readonly datasetId: string;
  metadata: DatasetStreamMetadata;
  filterSource: string;
  filter: FilterNode | null;
  rawRecentRecords: ReadonlyArray<TelemetryRecord>;
  logs: ReadonlyArray<TelemetryEntry>;
  pageInfo: TelemetryLogPageInfo | null;
  selectedLogId: string | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isLoadingOlder: boolean;
  errorMessage: string | null;
  hasLoadedOnce: boolean;
  activeCount: number;
  subscriptionCancel: (() => void) | undefined;
  initialLoadPromise: Promise<void> | null;
  queuedInitialLoad: "initial" | "refresh" | null;
  olderLoadPromise: Promise<void> | null;
  lastTouchedAt: number;
  lastLoadedAt: number;
  loadGeneration: number;
  snapshot: DatasetStreamSnapshot;
}

interface LogStreamStoreDependencies {
  readonly listTelemetry: typeof listDatasetTelemetry;
  readonly subscribeTelemetry: typeof subscribeDatasetTelemetryEntries;
  readonly preloadFilterCatalog: typeof preloadTelemetryFilterCatalog;
}

const LOG_PAGE_SIZE = 100;
const MAX_INACTIVE_SESSIONS = 4;
const MAX_RECENT_RECORDS_PER_SESSION = 10_000;
const STALE_AFTER_MS = 30_000;

const listeners = new Set<() => void>();
const sessions = new Map<DatasetStreamKey, DatasetStreamSession>();

let dependencies: LogStreamStoreDependencies = {
  listTelemetry: listDatasetTelemetry,
  subscribeTelemetry: subscribeDatasetTelemetryEntries,
  preloadFilterCatalog: preloadTelemetryFilterCatalog,
};

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
  metadata: DatasetStreamMetadata,
): DatasetStreamSnapshot {
  const stableMetadata = useMemo(
    () => metadata,
    [metadata.datasetIcon, metadata.datasetName, metadata.datasetSlug, metadata.projectSlug],
  );

  getOrCreateSession(projectId, datasetId, stableMetadata);

  useEffect(() => {
    activateDatasetStream({ projectId, datasetId, metadata: stableMetadata });
    return () => {
      deactivateDatasetStream(projectId, datasetId);
    };
  }, [datasetId, projectId, stableMetadata]);

  return useSyncExternalStore(
    subscribeDatasetStreamStore,
    () => getDatasetStreamSnapshot(projectId, datasetId, stableMetadata),
    () => getDatasetStreamSnapshot(projectId, datasetId, stableMetadata),
  );
}

export function activateDatasetStream(input: ActivateDatasetStreamInput): void {
  const session = getOrCreateSession(input.projectId, input.datasetId, input.metadata);
  session.activeCount += 1;
  touchSession(session);
  updateMetadata(session, input.metadata);
  ensureSubscription(session);
  void dependencies.preloadFilterCatalog(input.projectId, input.datasetId).catch(() => {});

  if (!session.hasLoadedOnce) {
    void loadInitialDatasetTelemetry(session, "initial");
    return;
  }

  if (Date.now() - session.lastLoadedAt > STALE_AFTER_MS) {
    void loadInitialDatasetTelemetry(session, "refresh");
  }

  evictInactiveSessions();
}

export function deactivateDatasetStream(projectId: string, datasetId: string): void {
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
  if (session.filterSource === input.source && sameFilter(session.filter, input.filter)) {
    return;
  }

  session.filterSource = input.source;
  session.filter = input.filter;
  session.pageInfo = null;
  session.logs = filterRecordsForSession(session, session.rawRecentRecords).map((entry) =>
    toTelemetryEntry(
      entry,
      session.metadata.datasetName,
      session.metadata.datasetIcon ?? "js",
    ),
  );
  session.selectedLogId = selectedLogStillVisible(session) ? session.selectedLogId : null;
  session.errorMessage = null;
  session.loadGeneration += 1;
  commitSession(session);
  void loadInitialDatasetTelemetry(session, session.hasLoadedOnce ? "refresh" : "initial");
}

export async function loadOlderDatasetTelemetry(
  projectId: string,
  datasetId: string,
): Promise<void> {
  const session = sessions.get(toDatasetStreamKey(projectId, datasetId));
  if (!session) {
    return;
  }
  if (session.olderLoadPromise) {
    return session.olderLoadPromise;
  }
  if (!session.pageInfo?.hasPreviousPage || !session.pageInfo.startCursor) {
    return;
  }

  session.isLoadingOlder = true;
  commitSession(session);

  const generation = session.loadGeneration;
  session.olderLoadPromise = dependencies
    .listTelemetry(projectId, datasetId, {
      cursor: session.pageInfo.startCursor,
      direction: "older",
      limit: LOG_PAGE_SIZE,
      filter: session.filter ?? undefined,
    })
    .then((page) => {
      if (!sessions.has(session.key) || generation !== session.loadGeneration) {
        return;
      }

      const entries = page.entries.map((entry) =>
        toTelemetryEntry(
          entry,
          session.metadata.datasetName,
          session.metadata.datasetIcon ?? "js",
        ),
      );
      const latestPageInfo = session.pageInfo;
      session.logs = mergeUniqueLogs(entries, session.logs);
      session.pageInfo = {
        hasPreviousPage: page.pageInfo.hasPreviousPage,
        hasNextPage: latestPageInfo?.hasNextPage ?? page.pageInfo.hasNextPage,
        startCursor: page.pageInfo.startCursor ?? latestPageInfo?.startCursor ?? null,
        endCursor: latestPageInfo?.endCursor ?? page.pageInfo.endCursor,
      };
      session.errorMessage = null;
    })
    .catch((error: unknown) => {
      session.errorMessage =
        error instanceof Error ? error.message : "Failed to load telemetry.";
    })
    .finally(() => {
      session.isLoadingOlder = false;
      session.olderLoadPromise = null;
      commitSession(session);
    });

  return session.olderLoadPromise;
}

export function selectDatasetTelemetryEntry(
  projectId: string,
  datasetId: string,
  logId: string | null,
): void {
  const session = getOrCreateSession(projectId, datasetId);
  if (session.selectedLogId === logId) {
    return;
  }
  session.selectedLogId = logId;
  commitSession(session);
}

export async function refreshDatasetTelemetry(
  projectId: string,
  datasetId: string,
): Promise<void> {
  const session = sessions.get(toDatasetStreamKey(projectId, datasetId));
  if (!session) {
    return;
  }
  return loadInitialDatasetTelemetry(session, session.hasLoadedOnce ? "refresh" : "initial");
}

export function invalidateDatasetTelemetry(projectId: string, datasetId: string): void {
  const key = toDatasetStreamKey(projectId, datasetId);
  const session = sessions.get(key);
  if (!session) {
    return;
  }
  session.subscriptionCancel?.();
  sessions.delete(key);
  emit();
}

export function getDatasetStreamSnapshot(
  projectId: string,
  datasetId: string,
  metadata?: DatasetStreamMetadata,
): DatasetStreamSnapshot {
  const session = sessions.get(toDatasetStreamKey(projectId, datasetId));
  if (session) {
    return session.snapshot;
  }
  return createSnapshot({
    key: toDatasetStreamKey(projectId, datasetId),
    projectId,
    datasetId,
    metadata: metadata ?? { datasetName: "Dataset" },
    filterSource: "",
    filter: null,
    rawRecentRecords: [],
    logs: [],
    pageInfo: null,
    selectedLogId: null,
    isInitialLoading: true,
    isRefreshing: false,
    isLoadingOlder: false,
    errorMessage: null,
    hasLoadedOnce: false,
    activeCount: 0,
    subscriptionCancel: undefined,
    initialLoadPromise: null,
    queuedInitialLoad: null,
    olderLoadPromise: null,
    lastTouchedAt: 0,
    lastLoadedAt: 0,
    loadGeneration: 0,
    snapshot: undefined as unknown as DatasetStreamSnapshot,
  });
}

export function resetLogStreamStoreForTests(): void {
  for (const session of sessions.values()) {
    session.subscriptionCancel?.();
  }
  sessions.clear();
  listeners.clear();
  dependencies = {
    listTelemetry: listDatasetTelemetry,
    subscribeTelemetry: subscribeDatasetTelemetryEntries,
    preloadFilterCatalog: preloadTelemetryFilterCatalog,
  };
}

export function configureLogStreamStoreForTests(
  nextDependencies: Partial<LogStreamStoreDependencies>,
): void {
  dependencies = {
    ...dependencies,
    ...nextDependencies,
  };
}

export function getLogStreamStoreSessionCountForTests(): number {
  return sessions.size;
}

function loadInitialDatasetTelemetry(
  session: DatasetStreamSession,
  mode: "initial" | "refresh",
): Promise<void> {
  if (session.initialLoadPromise) {
    session.queuedInitialLoad = mode;
    return session.initialLoadPromise;
  }

  const generation = session.loadGeneration;
  if (mode === "initial" && !session.hasLoadedOnce) {
    session.isInitialLoading = true;
  } else {
    session.isRefreshing = true;
  }
  session.errorMessage = null;
  commitSession(session);

  session.initialLoadPromise = dependencies
    .listTelemetry(session.projectId, session.datasetId, {
      limit: LOG_PAGE_SIZE,
      filter: session.filter ?? undefined,
    })
    .then((page) => {
      if (!sessions.has(session.key) || generation !== session.loadGeneration) {
        return;
      }
      applyTelemetryPage(session, page);
      session.hasLoadedOnce = true;
      session.lastLoadedAt = Date.now();
      session.errorMessage = null;
    })
    .catch((error: unknown) => {
      session.errorMessage =
        error instanceof Error ? error.message : "Failed to load telemetry.";
    })
    .finally(() => {
      const queuedInitialLoad = session.queuedInitialLoad;
      session.queuedInitialLoad = null;
      session.isInitialLoading = false;
      session.isRefreshing = false;
      session.initialLoadPromise = null;
      commitSession(session);
      if (queuedInitialLoad !== null && sessions.has(session.key)) {
        void loadInitialDatasetTelemetry(session, queuedInitialLoad);
      }
    });

  return session.initialLoadPromise;
}

function applyTelemetryPage(
  session: DatasetStreamSession,
  page: TelemetryRecordPage,
): void {
  const pageEntries = page.entries.map((entry) =>
    toTelemetryEntry(entry, session.metadata.datasetName, session.metadata.datasetIcon ?? "js"),
  );
  const matchingLiveRecords = filterRecordsForSession(session, session.rawRecentRecords).map((entry) =>
    toTelemetryEntry(entry, session.metadata.datasetName, session.metadata.datasetIcon ?? "js"),
  );

  session.logs = mergeUniqueLogs(session.logs, mergeUniqueLogs(pageEntries, matchingLiveRecords));
  const previousPageInfo = session.pageInfo;
  session.pageInfo =
    session.hasLoadedOnce && previousPageInfo !== null
      ? {
          hasPreviousPage: previousPageInfo.hasPreviousPage,
          hasNextPage: page.pageInfo.hasNextPage,
          startCursor: previousPageInfo.startCursor ?? page.pageInfo.startCursor,
          endCursor: page.pageInfo.endCursor ?? previousPageInfo.endCursor,
        }
      : page.pageInfo;
  session.selectedLogId = selectedLogStillVisible(session) ? session.selectedLogId : null;
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
      const log = toTelemetryEntry(
        entry,
        session.metadata.datasetName,
        session.metadata.datasetIcon ?? "js",
      );
      session.rawRecentRecords = trimNewestRecords(
        mergeUniqueRecords(session.rawRecentRecords, [entry]),
        MAX_RECENT_RECORDS_PER_SESSION,
      );
      if (session.filter === null || evaluateFilter(session.filter, entry)) {
        session.logs = mergeUniqueLogs(session.logs, [log]);
      }
      session.errorMessage = null;
      commitSession(session);
    },
    (error) => {
      session.errorMessage = error.message;
      commitSession(session);
    },
  );
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
    filterSource: "",
    filter: null,
    rawRecentRecords: [],
    logs: [],
    pageInfo: null,
    selectedLogId: null,
    isInitialLoading: false,
    isRefreshing: false,
    isLoadingOlder: false,
    errorMessage: null,
    hasLoadedOnce: false,
    activeCount: 0,
    subscriptionCancel: undefined,
    initialLoadPromise: null,
    queuedInitialLoad: null,
    olderLoadPromise: null,
    lastTouchedAt: Date.now(),
    lastLoadedAt: 0,
    loadGeneration: 0,
    snapshot: undefined as unknown as DatasetStreamSnapshot,
  };
  session.snapshot = createSnapshot(session);
  sessions.set(key, session);
  return session;
}

function commitSession(session: DatasetStreamSession): void {
  session.snapshot = createSnapshot(session);
  emit();
}

function createSnapshot(session: DatasetStreamSession): DatasetStreamSnapshot {
  const selectedLog =
    session.selectedLogId === null
      ? null
      : session.logs.find((log) => log.id === session.selectedLogId) ?? null;
  return {
    projectId: session.projectId,
    datasetId: session.datasetId,
    metadata: session.metadata,
    filterSource: session.filterSource,
    filter: session.filter,
    logs: session.logs,
    pageInfo: session.pageInfo,
    selectedLogId: session.selectedLogId,
    selectedLog,
    isInitialLoading: session.isInitialLoading,
    isRefreshing: session.isRefreshing,
    isLoadingOlder: session.isLoadingOlder,
    errorMessage: session.errorMessage,
    hasLoadedOnce: session.hasLoadedOnce,
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
  commitSession(session);
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
    sessions.delete(session.key);
  }
}

function selectedLogStillVisible(session: DatasetStreamSession): boolean {
  return (
    session.selectedLogId === null ||
    session.logs.some((log) => log.id === session.selectedLogId)
  );
}

function filterRecordsForSession(
  session: DatasetStreamSession,
  records: ReadonlyArray<TelemetryRecord>,
): ReadonlyArray<TelemetryRecord> {
  return session.filter === null
    ? records
    : records.filter((entry) => evaluateFilter(session.filter!, entry));
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
  const timestampDelta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
  if (timestampDelta !== 0 && !Number.isNaN(timestampDelta)) {
    return timestampDelta;
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
