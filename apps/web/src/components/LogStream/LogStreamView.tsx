import {
  evaluateFilter,
  type FilterNode,
  type TelemetryLogPageInfo,
  type TelemetryRecord,
} from "@lensflare/contracts";
import {
  Activity,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { Sheet, SheetPopup } from "~/components/ui/sheet";
import { listDatasetTelemetry, subscribeDatasetTelemetryEntries } from "~/data/logApi";
import { useMediaQuery } from "~/hooks/useMediaQuery";

import { DatasetTabsTitlebar } from "./DatasetTabsTitlebar";
import { getDatasetTabState, type DatasetTab } from "./datasetTabs";
import { useDatasetTabsSnapshot } from "./datasetTabsStore";
import { LogDetailsPanel } from "./LogDetailsPanel";
import { LogStreamHeader } from "./LogStreamHeader";
import { LogTable, type LogTableHandle } from "./LogTable";
import { TraceExplorer } from "./TraceExplorer";
import type { SourceIconKind, TelemetryEntry } from "./types";

/**
 * Below this viewport width we switch the log details panel from an inline
 * split-view column to a modal sheet. The value mirrors the right-panel
 * breakpoint used elsewhere so the UI stays consistent across features.
 */
const LOG_DETAILS_SHEET_MEDIA_QUERY = "(max-width: 1024px)";

const SHEET_EXIT_ANIMATION_MS = 220;

const LOG_PAGE_SIZE = 100;

interface LogStreamViewProps {
  projectId: string;
  datasetId: string;
  datasetName: string;
  datasetIcon?: SourceIconKind;
}

/**
 * Full-height live log stream view shown when a dataset is selected.
 * Fetches the initial dataset log page from the local server, then merges
 * pushed log events from the RPC websocket stream.
 *
 * Owns the active filter AST: the QueryBuilder (rendered inside
 * `LogStreamHeader`) bubbles changes up via `onFilterChange`, the initial
 * page load + cursor pagination ship the filter to the backend, and the
 * WebSocket stream is both pre-filtered server-side (via the RPC payload)
 * and re-evaluated client-side so late subscription races cannot leak
 * non-matching entries.
 */
export function LogStreamView({
  projectId,
  datasetId,
  datasetName,
  datasetIcon = "js",
}: LogStreamViewProps) {
  const tabsByDataset = useDatasetTabsSnapshot();
  const [filter, setFilter] = useState<FilterNode | null>(null);
  const [logs, setLogs] = useState<ReadonlyArray<TelemetryEntry>>([]);
  const [pageInfo, setPageInfoState] = useState<TelemetryLogPageInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const tableRef = useRef<LogTableHandle | null>(null);
  const pageInfoRef = useRef<TelemetryLogPageInfo | null>(null);
  const shouldUseDetailsSheet = useMediaQuery(LOG_DETAILS_SHEET_MEDIA_QUERY);
  const hasDesktopTitleTabs =
    typeof document !== "undefined" &&
    document.documentElement.dataset.runtime === "electron" &&
    document.documentElement.dataset.platform === "macos";

  const tabState = useMemo(
    () => getDatasetTabState(tabsByDataset, datasetId),
    [datasetId, tabsByDataset],
  );

  // Derive the selected log from the current list so it stays in sync as new
  // entries stream in. If the selection disappears (e.g. pagination trims it)
  // the details view closes automatically.
  const selectedLog = useMemo<TelemetryEntry | null>(() => {
    if (selectedLogId === null) return null;
    return logs.find((log) => log.id === selectedLogId) ?? null;
  }, [logs, selectedLogId]);

  const closeDetails = useCallback(() => {
    setSelectedLogId(null);
  }, []);

  const updatePageInfo = useCallback((next: TelemetryLogPageInfo | null) => {
    pageInfoRef.current = next;
    setPageInfoState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadInitial = async () => {
      setIsLoading(true);
      setLogs([]);
      updatePageInfo(null);

      try {
        const page = await listDatasetTelemetry(projectId, datasetId, {
          limit: LOG_PAGE_SIZE,
          filter: filter ?? undefined,
        });
        if (cancelled) {
          return;
        }

        const entries = page.entries.map((entry) => toTelemetryEntry(entry, datasetName, datasetIcon));
        setLogs((currentLogs) => mergeUniqueLogs(entries, currentLogs));
        updatePageInfo(page.pageInfo);
        setErrorMessage(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Failed to load telemetry.");
      } finally {
        if (cancelled) {
          return;
        }

        setIsLoading(false);
      }
    };

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [datasetIcon, datasetId, datasetName, filter, projectId, updatePageInfo]);

  useEffect(() => {
    return subscribeDatasetTelemetryEntries(
      projectId,
      datasetId,
      (entry) => {
        // Double-check the filter in the browser even though the server
        // already pre-filters: the subscription message may have crossed in
        // flight with a filter-change commit, and the evaluator is cheap.
        if (filter !== null && !evaluateFilter(filter, entry)) {
          return;
        }

        setLogs((currentLogs) =>
          mergeUniqueLogs(currentLogs, [toTelemetryEntry(entry, datasetName, datasetIcon)]),
        );
        setErrorMessage(null);
      },
      (error) => {
        setErrorMessage(error.message);
      },
      filter ?? undefined,
    );
  }, [datasetIcon, datasetId, datasetName, filter, projectId]);

  const handleLoadOlder = useCallback(async () => {
    const currentPageInfo = pageInfoRef.current;
    if (!currentPageInfo?.hasPreviousPage || !currentPageInfo.startCursor || isLoadingOlder) {
      return;
    }

    setIsLoadingOlder(true);
    try {
      const page = await listDatasetTelemetry(projectId, datasetId, {
        cursor: currentPageInfo.startCursor,
        direction: "older",
        limit: LOG_PAGE_SIZE,
        filter: filter ?? undefined,
      });
      const entries = page.entries.map((entry) => toTelemetryEntry(entry, datasetName, datasetIcon));
      const latestPageInfo = pageInfoRef.current ?? currentPageInfo;

      setLogs((currentLogs) => mergeUniqueLogs(entries, currentLogs));
      updatePageInfo({
        hasPreviousPage: page.pageInfo.hasPreviousPage,
        hasNextPage: latestPageInfo.hasNextPage,
        startCursor: page.pageInfo.startCursor ?? latestPageInfo.startCursor,
        endCursor: latestPageInfo.endCursor ?? page.pageInfo.endCursor,
      });
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load telemetry.");
    } finally {
      setIsLoadingOlder(false);
    }
  }, [
    datasetIcon,
    datasetId,
    datasetName,
    filter,
    isLoadingOlder,
    projectId,
    updatePageInfo,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background/40">
      {!hasDesktopTitleTabs ? (
        <div className="shrink-0 border-b border-border/70 bg-background">
          <DatasetTabsTitlebar />
        </div>
      ) : null}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {tabState.tabs.map((tab) =>
          tab.kind === "trace" ? (
            <TraceTabPanel
              active={tab.id === tabState.activeTabId}
              datasetId={datasetId}
              key={tab.id}
              projectId={projectId}
              tab={tab}
            />
          ) : (
            <LiveTabPanel
              active={tab.id === tabState.activeTabId}
              closeDetails={closeDetails}
              datasetId={datasetId}
              errorMessage={errorMessage}
              handleLoadOlder={handleLoadOlder}
              isLoading={isLoading}
              isLoadingOlder={isLoadingOlder}
              key={tab.id}
              logs={logs}
              pageInfo={pageInfo}
              projectId={projectId}
              selectedLog={selectedLog}
              selectedLogId={selectedLogId}
              setFilter={setFilter}
              setSelectedLogId={setSelectedLogId}
              shouldUseDetailsSheet={shouldUseDetailsSheet}
              tableRef={tableRef}
            />
          ),
        )}
      </div>
    </div>
  );
}

interface LiveTabPanelProps {
  active: boolean;
  closeDetails: () => void;
  datasetId: string;
  errorMessage: string | null;
  handleLoadOlder: () => void;
  isLoading: boolean;
  isLoadingOlder: boolean;
  logs: ReadonlyArray<TelemetryEntry>;
  pageInfo: TelemetryLogPageInfo | null;
  projectId: string;
  selectedLog: TelemetryEntry | null;
  selectedLogId: string | null;
  setFilter: (filter: FilterNode | null) => void;
  setSelectedLogId: (logId: string | null) => void;
  shouldUseDetailsSheet: boolean;
  tableRef: RefObject<LogTableHandle | null>;
}

function LiveTabPanel({
  active,
  closeDetails,
  datasetId,
  errorMessage,
  handleLoadOlder,
  isLoading,
  isLoadingOlder,
  logs,
  pageInfo,
  projectId,
  selectedLog,
  selectedLogId,
  setFilter,
  setSelectedLogId,
  shouldUseDetailsSheet,
  tableRef,
}: LiveTabPanelProps) {
  // Keep the live tab mounted so table + details state survive tab switches,
  // but only surface the mobile sheet while this panel is active.
  const sheetCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closingSheetLog, setClosingSheetLog] = useState<TelemetryEntry | null>(null);
  const [isSheetClosing, setIsSheetClosing] = useState(false);
  const showInlineDetails = selectedLog !== null && !shouldUseDetailsSheet;
  const showSheetDetails =
    active && selectedLog !== null && shouldUseDetailsSheet && !isSheetClosing;
  const sheetLog = selectedLog ?? closingSheetLog;

  const clearSheetCloseTimer = useCallback(() => {
    if (sheetCloseTimerRef.current === null) {
      return;
    }

    clearTimeout(sheetCloseTimerRef.current);
    sheetCloseTimerRef.current = null;
  }, []);

  const finishSheetClose = useCallback(() => {
    clearSheetCloseTimer();
    sheetCloseTimerRef.current = setTimeout(() => {
      setClosingSheetLog(null);
      setIsSheetClosing(false);
      sheetCloseTimerRef.current = null;
    }, SHEET_EXIT_ANIMATION_MS);
  }, [clearSheetCloseTimer]);

  const closeSheetDetails = useCallback(() => {
    if (selectedLog !== null) {
      setClosingSheetLog(selectedLog);
    }

    setIsSheetClosing(true);
    closeDetails();
    finishSheetClose();
  }, [closeDetails, finishSheetClose, selectedLog]);

  useEffect(() => {
    if (selectedLog === null) {
      return;
    }

    clearSheetCloseTimer();
    setClosingSheetLog(null);
    setIsSheetClosing(false);
  }, [clearSheetCloseTimer, selectedLog]);

  useEffect(() => clearSheetCloseTimer, [clearSheetCloseTimer]);

  return (
    <Activity mode={active ? "visible" : "hidden"} name={`dataset-tab:${datasetId}:live`}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <LogStreamHeader
              datasetId={datasetId}
              onFilterChange={setFilter}
              projectId={projectId}
            />
            {errorMessage ? (
              <div className="border-b border-rose-500/20 bg-rose-500/8 px-4 py-2 font-mono text-[11px] text-rose-200">
                {errorMessage}
              </div>
            ) : null}
            <LogTable
              hasPreviousPage={pageInfo?.hasPreviousPage ?? false}
              isLoadingPrevious={isLoadingOlder}
              logs={logs}
              onLoadPrevious={handleLoadOlder}
              onSelectLog={setSelectedLogId}
              ref={tableRef}
              selectedLogId={selectedLogId}
              waiting={errorMessage === null || isLoading}
            />
          </div>
          {showInlineDetails ? (
            <div className="flex w-[min(42vw,560px)] min-w-[360px] shrink-0 flex-col">
              <LogDetailsPanel
                datasetId={datasetId}
                log={selectedLog}
                onClose={closeDetails}
                projectId={projectId}
                variant="inline"
              />
            </div>
          ) : null}
          <Sheet
            onOpenChange={(open) => {
              if (!open) {
                closeSheetDetails();
              }
            }}
            open={showSheetDetails}
          >
            <SheetPopup
              className="w-[min(88vw,560px)] max-w-[560px] p-0"
              showCloseButton={false}
              side="right"
            >
              {sheetLog !== null ? (
                <LogDetailsPanel
                  datasetId={datasetId}
                  log={sheetLog}
                  onClose={closeSheetDetails}
                  projectId={projectId}
                  variant="sheet"
                />
              ) : null}
            </SheetPopup>
          </Sheet>
        </div>
      </div>
    </Activity>
  );
}

interface TraceTabPanelProps {
  active: boolean;
  datasetId: string;
  projectId: string;
  tab: Extract<DatasetTab, { kind: "trace" }>;
}

function TraceTabPanel({ active, datasetId, projectId, tab }: TraceTabPanelProps) {
  return (
    <Activity mode={active ? "visible" : "hidden"} name={`dataset-tab:${datasetId}:${tab.id}`}>
      <div className="flex min-h-0 flex-1 flex-col">
        <TraceExplorer
          className="min-h-0 flex-1"
          datasetId={datasetId}
          projectId={projectId}
          traceId={tab.traceId}
          {...(tab.initialSpanId !== undefined
            ? { initialSpanId: tab.initialSpanId }
            : {})}
        />
      </div>
    </Activity>
  );
}

function toTelemetryEntry(
  entry: TelemetryRecord,
  datasetName: string,
  datasetIcon: SourceIconKind,
): TelemetryEntry {
  const parsedTimestamp = new Date(entry.timestamp);
  const timestamp = Number.isNaN(parsedTimestamp.getTime()) ? new Date() : parsedTimestamp;

  if (entry.kind === "span") {
    return {
      id: entry.id,
      kind: "span",
      timestamp,
      sourceName: entry.sourceName || datasetName,
      sourceIcon: inferSourceIcon(entry.sourceName, datasetIcon),
      traceId: entry.traceId,
      spanId: entry.spanId,
      parentSpanId: entry.parentSpanId,
      name: entry.name,
      serviceName: entry.serviceName,
      status: entry.status,
      statusMessage: entry.statusMessage,
      durationUs: entry.durationUs,
      attributes: entry.attributes,
      events: entry.events.map((event: Extract<TelemetryRecord, { kind: "span" }>["events"][number]) => {
        const eventTimestamp = new Date(event.timestamp);
        return {
          ...event,
          timestamp: Number.isNaN(eventTimestamp.getTime()) ? timestamp : eventTimestamp,
        };
      }),
    };
  }

  if (entry.kind === "spanEvent") {
    return {
      id: entry.id,
      kind: "spanEvent",
      timestamp,
      sourceName: entry.sourceName || datasetName,
      sourceIcon: inferSourceIcon(entry.sourceName, datasetIcon),
      traceId: entry.traceId,
      spanId: entry.spanId,
      name: entry.name,
      serviceName: entry.serviceName,
      attributes: entry.attributes,
    };
  }

  return {
    id: entry.id,
    kind: "log",
    timestamp,
    sourceName: entry.sourceName || datasetName,
    sourceIcon: inferSourceIcon(entry.sourceName, datasetIcon),
    level: entry.level,
    message: entry.message,
    ...(entry.traceId ? { traceId: entry.traceId } : {}),
    ...(entry.spanId ? { spanId: entry.spanId } : {}),
    attributes: entry.attributes,
  };
}

function inferSourceIcon(sourceName: string, fallback: SourceIconKind): SourceIconKind {
  const normalized = sourceName.trim().toLowerCase();
  if (normalized.includes("typescript") || normalized.includes("lensflare")) {
    return "ts";
  }
  if (normalized.includes("javascript") || normalized.endsWith("-js")) {
    return "js";
  }
  if (normalized.includes("python") || normalized.endsWith("-py")) {
    return "py";
  }
  if (normalized.includes("ruby") || normalized.endsWith("-rb")) {
    return "rb";
  }
  if (normalized.includes("rust") || normalized.endsWith("-rs")) {
    return "rs";
  }
  if (normalized.includes("golang") || normalized === "go" || normalized.endsWith("-go")) {
    return "go";
  }
  if (normalized.includes("java")) {
    return "java";
  }
  return fallback;
}

function mergeUniqueLogs(
  first: ReadonlyArray<TelemetryEntry>,
  second: ReadonlyArray<TelemetryEntry>,
): ReadonlyArray<TelemetryEntry> {
  const byId = new Map<string, TelemetryEntry>();
  for (const log of first) {
    byId.set(log.id, log);
  }
  for (const log of second) {
    byId.set(log.id, log);
  }

  return [...byId.values()].sort(compareLogEntries);
}

function compareLogEntries(left: TelemetryEntry, right: TelemetryEntry): number {
  const timestampDelta = left.timestamp.getTime() - right.timestamp.getTime();
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return left.id.localeCompare(right.id);
}
