import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { Sheet, SheetPopup } from "~/components/ui/sheet";
import { readBackendTarget } from "~/data/backendTarget";
import { useMediaQuery } from "~/hooks/useMediaQuery";

import { DatasetTabsTitlebar } from "./DatasetTabsTitlebar";
import { getDatasetTabState, type DatasetTab } from "./datasetTabs";
import { useDatasetTabsSnapshot } from "./datasetTabsStore";
import { EmptyDatasetGuide } from "./EmptyDatasetGuide";
import { LogDetailsPanel } from "./LogDetailsPanel";
import { LogStreamHeader } from "./LogStreamHeader";
import { LogTable, type LogTableHandle } from "./LogTable";
import {
  loadOlderDatasetTelemetry,
  selectDatasetTelemetryEntry,
  useDatasetStreamSnapshot,
} from "./logStreamStore";
import { TraceExplorer } from "./TraceExplorer";
import type { SourceIconKind, TelemetryEntry } from "./types";

/**
 * Below this viewport width we switch the log details panel from an inline
 * split-view column to a modal sheet. The value mirrors the right-panel
 * breakpoint used elsewhere so the UI stays consistent across features.
 */
const LOG_DETAILS_SHEET_MEDIA_QUERY = "(max-width: 1024px)";

const SHEET_EXIT_ANIMATION_MS = 220;

/**
 * Duration of the fade-out applied to the empty-dataset guide once the
 * first telemetry entry lands. Matches the `duration-200` Tailwind class
 * on the overlay wrapper (`transition-opacity`) — keep them in sync so
 * the DOM is removed just after the visual fade completes.
 */
const EMPTY_GUIDE_EXIT_MS = 250;

interface LogStreamViewProps {
  projectId: string;
  datasetId: string;
  datasetName: string;
  datasetIcon?: SourceIconKind;
  /**
   * Project slug used to template ingest URLs in the empty-dataset guide.
   * Optional because the containing route reads it from a live TanStack
   * DB collection that may not have hydrated yet on first paint.
   */
  projectSlug?: string | undefined;
  /**
   * Dataset slug used to template ingest URLs in the empty-dataset guide.
   * Optional for the same reason as `projectSlug`.
   */
  datasetSlug?: string | undefined;
}

/**
 * Full-height live log stream view shown when a dataset is selected.
 * The live data lifecycle is owned by `logStreamStore`, not this route
 * component, so dataset/settings navigation does not tear down loaded rows
 * or websocket subscriptions for recently visited datasets.
 */
export function LogStreamView({
  projectId,
  datasetId,
  datasetName,
  datasetIcon = "js",
  projectSlug,
  datasetSlug,
}: LogStreamViewProps) {
  const tabsByDataset = useDatasetTabsSnapshot();
  const tableRef = useRef<LogTableHandle | null>(null);
  const shouldUseDetailsSheet = useMediaQuery(LOG_DETAILS_SHEET_MEDIA_QUERY);
  const hasDesktopTitleTabs =
    typeof document !== "undefined" &&
    document.documentElement.dataset.runtime === "electron" &&
    document.documentElement.dataset.platform === "macos";

  const tabState = useMemo(
    () => getDatasetTabState(tabsByDataset, datasetId),
    [datasetId, tabsByDataset],
  );
  const streamMetadata = useMemo(
    () => ({
      datasetName,
      datasetSlug,
      datasetIcon,
      projectSlug,
    }),
    [datasetIcon, datasetName, datasetSlug, projectSlug],
  );
  const stream = useDatasetStreamSnapshot(projectId, datasetId, streamMetadata);

  // `serverOrigin` is pinned for the lifetime of the view. Resolving it
  // on every render would read `window.location` on every paint — the
  // backend target is stable for the session so memoising is both cheaper
  // and less surprising if someone ever adds mutation hooks to it.
  const serverOrigin = useMemo(() => {
    const target = readBackendTarget();
    // Trailing slash normalisation mirrors the ingest URLs documented in
    // the integration snippets (they never include a trailing slash).
    return target.httpBaseUrl.replace(/\/$/, "");
  }, []);

  const closeDetails = useCallback(() => {
    selectDatasetTelemetryEntry(projectId, datasetId, null);
  }, [datasetId, projectId]);

  const handleLoadOlder = useCallback(async () => {
    await loadOlderDatasetTelemetry(projectId, datasetId);
  }, [datasetId, projectId]);

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
              handleLoadOlder={handleLoadOlder}
              key={tab.id}
              projectId={projectId}
              serverOrigin={serverOrigin}
              shouldUseDetailsSheet={shouldUseDetailsSheet}
              stream={stream}
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
  handleLoadOlder: () => void;
  projectId: string;
  serverOrigin: string;
  shouldUseDetailsSheet: boolean;
  stream: ReturnType<typeof useDatasetStreamSnapshot>;
  tableRef: RefObject<LogTableHandle | null>;
}

function LiveTabPanel({
  active,
  closeDetails,
  datasetId,
  handleLoadOlder,
  projectId,
  serverOrigin,
  shouldUseDetailsSheet,
  stream,
  tableRef,
}: LiveTabPanelProps) {
  // Keep the live tab mounted so table, details state, and in-flight effects
  // survive tab switches. React Activity preserves state but tears down effects
  // while hidden, which would replay trace-loading skeletons when returning.
  const sheetCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closingSheetLog, setClosingSheetLog] = useState<TelemetryEntry | null>(null);
  const [isSheetClosing, setIsSheetClosing] = useState(false);
  const showInlineDetails = stream.selectedLog !== null && !shouldUseDetailsSheet;
  const showSheetDetails =
    active && stream.selectedLog !== null && shouldUseDetailsSheet && !isSheetClosing;
  const sheetLog = stream.selectedLog ?? closingSheetLog;

  // "First event" latch. Once we've observed a single log we never
  // re-render the overlay for this mount — the user can always get back
  // to the guide via the header icon button. We also drive a short fade
  // exit via `isGuideExiting` before removing the overlay from the DOM
  // so the transition is visible rather than a hard cut.
  const [hasEverReceivedLog, setHasEverReceivedLog] = useState(() => stream.logs.length > 0);
  const [isGuideExiting, setIsGuideExiting] = useState(false);
  const [showGuideOverlay, setShowGuideOverlay] = useState(() => stream.logs.length === 0);
  const guideExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hasEverReceivedLog && stream.logs.length > 0) {
      setHasEverReceivedLog(true);
      setIsGuideExiting(true);
      if (guideExitTimerRef.current !== null) {
        clearTimeout(guideExitTimerRef.current);
      }
      guideExitTimerRef.current = setTimeout(() => {
        setShowGuideOverlay(false);
        setIsGuideExiting(false);
        guideExitTimerRef.current = null;
      }, EMPTY_GUIDE_EXIT_MS);
    }
  }, [hasEverReceivedLog, stream.logs.length]);

  useEffect(() => {
    return () => {
      if (guideExitTimerRef.current !== null) {
        clearTimeout(guideExitTimerRef.current);
      }
    };
  }, []);

  // The guide is only shown for the initial empty state: no logs, no
  // active filter (an active filter that returns zero rows is not the
  // same as "the dataset is empty"), no error, and the initial fetch
  // has completed. Slugs are required — without them the snippets would
  // render with placeholder braces and confuse the user, so we fall back
  // to the plain waiting-for-logs table until the collections hydrate.
  const shouldShowGuide =
    showGuideOverlay &&
    !hasEverReceivedLog &&
    stream.logs.length === 0 &&
    !stream.isInitialLoading &&
    stream.errorMessage === null &&
    stream.filter === null &&
    stream.metadata.projectSlug !== undefined &&
    stream.metadata.datasetSlug !== undefined;

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
    if (stream.selectedLog !== null) {
      setClosingSheetLog(stream.selectedLog);
    }

    setIsSheetClosing(true);
    closeDetails();
    finishSheetClose();
  }, [closeDetails, finishSheetClose, stream.selectedLog]);

  useEffect(() => {
    if (stream.selectedLog === null) {
      return;
    }

    clearSheetCloseTimer();
    setClosingSheetLog(null);
    setIsSheetClosing(false);
  }, [clearSheetCloseTimer, stream.selectedLog]);

  useEffect(() => clearSheetCloseTimer, [clearSheetCloseTimer]);

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-dataset-tab={`${datasetId}:live`}
      hidden={!active}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <LogStreamHeader
              datasetId={datasetId}
              datasetName={stream.metadata.datasetName}
              datasetSlug={stream.metadata.datasetSlug}
              filter={stream.filter}
              filterSource={stream.filterSource}
              projectId={projectId}
              projectSlug={stream.metadata.projectSlug}
              serverOrigin={serverOrigin}
            />
            {stream.errorMessage ? (
              <div className="border-b border-rose-500/20 bg-rose-500/8 px-4 py-2 font-mono text-[11px] text-rose-600 dark:text-rose-200">
                {stream.errorMessage}
              </div>
            ) : null}
            <LogTable
              hasPreviousPage={stream.pageInfo?.hasPreviousPage ?? false}
              isLoadingPrevious={stream.isLoadingOlder}
              logs={stream.logs}
              onLoadPrevious={handleLoadOlder}
              onSelectLog={(logId) => selectDatasetTelemetryEntry(projectId, datasetId, logId)}
              ref={tableRef}
              selectedLogId={stream.selectedLogId}
              waiting={stream.errorMessage === null || stream.isInitialLoading}
            />
            {shouldShowGuide && stream.metadata.projectSlug && stream.metadata.datasetSlug ? (
              <div
                aria-live="polite"
                className="pointer-events-auto absolute inset-0 z-10 flex flex-col overflow-hidden bg-background/95 backdrop-blur-sm transition-opacity duration-200 data-[state=exiting]:opacity-0"
                data-state={isGuideExiting ? "exiting" : "idle"}
              >
                <EmptyDatasetGuide
                  datasetName={stream.metadata.datasetName}
                  datasetSlug={stream.metadata.datasetSlug}
                  projectSlug={stream.metadata.projectSlug}
                  serverOrigin={serverOrigin}
                  variant="overlay"
                />
              </div>
            ) : null}
          </div>
          {showInlineDetails ? (
            <LogDetailsPanel
              datasetId={datasetId}
              log={stream.selectedLog}
              onClose={closeDetails}
              projectId={projectId}
              variant="inline"
            />
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
    </div>
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
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-dataset-tab={`${datasetId}:${tab.id}`}
      hidden={!active}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <TraceExplorer
          className="min-h-0 flex-1"
          datasetId={datasetId}
          projectId={projectId}
          traceId={tab.traceId}
          {...(tab.initialSpanId !== undefined ? { initialSpanId: tab.initialSpanId } : {})}
        />
      </div>
    </div>
  );
}
