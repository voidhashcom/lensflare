import { Activity, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Sheet, SheetPopup } from "~/components/ui/sheet";
import { readBackendTarget } from "~/data/backendTarget";
import { useMediaQuery } from "~/hooks/useMediaQuery";

import { DatasetTabsTitlebar } from "./DatasetTabsTitlebar";
import {
  DEFAULT_TELEMETRY_DATASET_TAB_ID,
  getDatasetTabState,
  type DatasetTab,
} from "./datasetTabs";
import { useDatasetTabsSnapshot } from "./datasetTabsStore";
import { EmptyDatasetGuide } from "./EmptyDatasetGuide";
import { LogDetailsPanel } from "./LogDetailsPanel";
import { LogStreamHeader } from "./LogStreamHeader";
import { LogTable, type LogTableHandle } from "./LogTable";
import {
  enterTelemetryHistoryMode,
  loadOlderDatasetTelemetry,
  resolveTelemetryEntry,
  returnTelemetryViewToLive,
  selectDatasetTelemetryEntry,
  useDatasetStreamSnapshot,
  type DatasetStreamMetadata,
} from "./logStreamStore";
import { TraceExplorer } from "./TraceExplorer";
import type { SourceIconKind } from "./types";

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
 * Full-height view shown when a dataset is selected.
 *
 * Two surfaces share this route:
 *
 *   • **Empty state** — while the dataset has not yet received any
 *     telemetry, render the {@link EmptyDatasetGuide} (Connect + MCP
 *     tabs, no `+` button). The Telemetry tab strip is intentionally
 *     hidden so the user has only one obvious next action.
 *   • **Populated state** — once data is flowing, render the original
 *     `DatasetTabsTitlebar` + telemetry/trace panels. Users can
 *     re-access Connect / MCP via the book icon in
 *     {@link LogStreamHeader}, which opens the same guide as a sheet.
 *
 * The live data lifecycle is owned by `logStreamStore`, not this route,
 * so dataset/settings navigation does not tear down loaded rows or
 * websocket subscriptions for recently visited datasets. The primary
 * telemetry stream is subscribed at this level so we can detect the
 * empty → populated transition and fade the guide out cleanly.
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

  // Subscribe to the *primary* telemetry stream so we can detect when
  // the dataset transitions from empty to populated, even while the user
  // is on the Connect / MCP tabs. The session is reference-counted so
  // this extra subscription is cheap — it shares state with whatever
  // the active TelemetryTabPanel is reading.
  const primaryStream = useDatasetStreamSnapshot(
    projectId,
    datasetId,
    DEFAULT_TELEMETRY_DATASET_TAB_ID,
    streamMetadata,
  );

  const [hasEverReceivedLog, setHasEverReceivedLog] = useState(
    () => primaryStream.rowIds.length > 0,
  );
  const [isGuideExiting, setIsGuideExiting] = useState(false);
  const [showGuide, setShowGuide] = useState(() => primaryStream.rowIds.length === 0);
  const guideExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hasEverReceivedLog && primaryStream.rowIds.length > 0) {
      setHasEverReceivedLog(true);
      setIsGuideExiting(true);
      if (guideExitTimerRef.current !== null) {
        clearTimeout(guideExitTimerRef.current);
      }
      guideExitTimerRef.current = setTimeout(() => {
        setShowGuide(false);
        setIsGuideExiting(false);
        guideExitTimerRef.current = null;
      }, EMPTY_GUIDE_EXIT_MS);
    }
  }, [hasEverReceivedLog, primaryStream.rowIds.length]);

  useEffect(() => {
    return () => {
      if (guideExitTimerRef.current !== null) {
        clearTimeout(guideExitTimerRef.current);
      }
    };
  }, []);

  // The empty-state guide is only meaningful when:
  //   - we have never seen a log on this mount (sticky latch),
  //   - the underlying stream has zero rows AND finished its initial
  //     fetch (so we don't flash the guide while the first page is
  //     still in flight),
  //   - there is no error to surface, and
  //   - both slugs are available — otherwise the snippet templates
  //     render `{{slug}}` placeholders to the user.
  const datasetIsEmpty =
    showGuide &&
    !hasEverReceivedLog &&
    primaryStream.rowIds.length === 0 &&
    !primaryStream.isInitialLoading &&
    primaryStream.errorMessage === null &&
    projectSlug !== undefined &&
    datasetSlug !== undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background/40">
      {datasetIsEmpty ? (
        <div
          aria-live="polite"
          className="flex min-h-0 min-w-0 flex-1 flex-col transition-opacity duration-200 data-[state=exiting]:opacity-0"
          data-state={isGuideExiting ? "exiting" : "idle"}
        >
          <EmptyDatasetGuide
            datasetSlug={datasetSlug}
            projectSlug={projectSlug}
            serverOrigin={serverOrigin}
            variant="overlay"
          />
        </div>
      ) : (
        <>
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
                <TelemetryTabPanel
                  active={tab.id === tabState.activeTabId}
                  datasetId={datasetId}
                  datasetSlug={datasetSlug}
                  key={tab.id}
                  projectId={projectId}
                  projectSlug={projectSlug}
                  serverOrigin={serverOrigin}
                  shouldUseDetailsSheet={shouldUseDetailsSheet}
                  streamMetadata={streamMetadata}
                  tab={tab}
                />
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface TelemetryTabPanelProps {
  active: boolean;
  datasetId: string;
  projectId: string;
  serverOrigin: string;
  shouldUseDetailsSheet: boolean;
  streamMetadata: DatasetStreamMetadata;
  tab: Extract<DatasetTab, { kind: "telemetry" }>;
  projectSlug: string | undefined;
  datasetSlug: string | undefined;
}

function TelemetryTabPanel({
  active,
  datasetId,
  projectId,
  serverOrigin,
  shouldUseDetailsSheet,
  streamMetadata,
  tab,
  projectSlug,
  datasetSlug,
}: TelemetryTabPanelProps) {
  // Activity keeps tab state and DOM around while letting React suspend hidden
  // tab effects, which matches the tab-strip lifecycle without manual hiding.
  const tableRef = useRef<LogTableHandle | null>(null);
  const stream = useDatasetStreamSnapshot(projectId, datasetId, tab.id, streamMetadata);
  const sheetCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closingSheetLogId, setClosingSheetLogId] = useState<string | null>(null);
  const [isSheetClosing, setIsSheetClosing] = useState(false);
  const showInlineDetails = stream.selectedEntryId !== null && !shouldUseDetailsSheet;
  const showSheetDetails =
    active && stream.selectedEntryId !== null && shouldUseDetailsSheet && !isSheetClosing;
  const sheetLogId = stream.selectedEntryId ?? closingSheetLogId;
  const closeDetails = useCallback(() => {
    selectDatasetTelemetryEntry(projectId, datasetId, tab.id, null);
  }, [datasetId, projectId, tab.id]);

  const handleLoadOlder = useCallback(async () => {
    await loadOlderDatasetTelemetry(projectId, datasetId, tab.id);
  }, [datasetId, projectId, tab.id]);

  const handleLeaveLiveMode = useCallback(() => {
    enterTelemetryHistoryMode(projectId, datasetId, tab.id);
  }, [datasetId, projectId, tab.id]);

  const handleJumpToEnd = useCallback(() => {
    returnTelemetryViewToLive(projectId, datasetId, tab.id);
  }, [datasetId, projectId, tab.id]);

  const resolveRow = useCallback(
    (id: string) => resolveTelemetryEntry(projectId, datasetId, id),
    [datasetId, projectId],
  );

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
      setClosingSheetLogId(null);
      setIsSheetClosing(false);
      sheetCloseTimerRef.current = null;
    }, SHEET_EXIT_ANIMATION_MS);
  }, [clearSheetCloseTimer]);

  const closeSheetDetails = useCallback(() => {
    if (stream.selectedEntryId !== null) {
      setClosingSheetLogId(stream.selectedEntryId);
    }

    setIsSheetClosing(true);
    closeDetails();
    finishSheetClose();
  }, [closeDetails, finishSheetClose, stream.selectedEntryId]);

  useEffect(() => {
    if (stream.selectedEntryId === null) {
      return;
    }

    clearSheetCloseTimer();
    setClosingSheetLogId(null);
    setIsSheetClosing(false);
  }, [clearSheetCloseTimer, stream.selectedEntryId]);

  useEffect(() => clearSheetCloseTimer, [clearSheetCloseTimer]);

  return (
    <Activity mode={active ? "visible" : "hidden"} name={`Telemetry ${tab.id}`}>
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        data-dataset-tab={`${datasetId}:${tab.id}`}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <LogStreamHeader
                datasetId={datasetId}
                datasetSlug={datasetSlug}
                filter={stream.filter}
                filterSource={stream.filterSource}
                projectId={projectId}
                projectSlug={projectSlug}
                serverOrigin={serverOrigin}
                viewId={tab.id}
              />
              {stream.errorMessage ? (
                <div className="border-b border-rose-500/20 bg-rose-500/8 px-4 py-2 font-mono text-[11px] text-rose-600 dark:text-rose-200">
                  {stream.errorMessage}
                </div>
              ) : null}
              <LogTable
                hasPreviousPage={stream.pageInfo?.hasPreviousPage ?? false}
                isLoadingPrevious={stream.isLoadingOlder}
                liveTailKey={`${projectId}:${datasetId}:${tab.id}`}
                mode={stream.mode}
                onJumpToEnd={handleJumpToEnd}
                onLeaveLiveMode={handleLeaveLiveMode}
                onLoadPrevious={handleLoadOlder}
                onSelectLog={(logId) =>
                  selectDatasetTelemetryEntry(projectId, datasetId, tab.id, logId)
                }
                ref={tableRef}
                resolveRow={resolveRow}
                rowIds={stream.rowIds}
                selectedLogId={stream.selectedEntryId}
                waiting={stream.mode === "live" && stream.errorMessage === null}
              />
            </div>
            {showInlineDetails ? (
              <LogDetailsPanel
                datasetId={datasetId}
                logId={stream.selectedEntryId}
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
                {sheetLogId !== null ? (
                  <LogDetailsPanel
                    datasetId={datasetId}
                    logId={sheetLogId}
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
    <Activity mode={active ? "visible" : "hidden"} name={`Trace ${tab.traceId}`}>
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        data-dataset-tab={`${datasetId}:${tab.id}`}
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
    </Activity>
  );
}
