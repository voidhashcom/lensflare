import { CircleSlashIcon, XIcon } from "lucide-react";
import { Activity, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Skeleton } from "~/components/ui/skeleton";
import { TopTabsItem, TopTabsList, TopTabsTrigger } from "~/components/ui/top-tabs";
import { Toggle } from "~/components/ui/toggle";
import { IconButtonTooltip } from "~/components/ui/tooltip";
import { useHorizontalResizablePanel } from "~/hooks/useHorizontalResizablePanel";
import { cn } from "~/lib/utils";

import { openTraceTab } from "./datasetTabsStore";
import { resolveTelemetryEntry } from "./logStreamStore";
import {
  buildLogDetailEntries,
  buildLogRawData,
  isNullLike,
  renderDetailValue,
} from "./logDetailsFormat";
import { useTraceContextSnapshot } from "./traceContextStore";
import { TraceOverview } from "./TraceOverview";
import type { TelemetryEntry } from "./types";

type LogDetailsTab = "properties" | "raw";

const SHEET_EXIT_ANIMATION_MS = 220;
const LOG_DETAILS_DEFAULT_WIDTH_PX = 520;
const LOG_DETAILS_MAX_WIDTH_PX = 760;
const LOG_DETAILS_MIN_REMAINING_WIDTH_PX = 520;
const LOG_DETAILS_MIN_WIDTH_PX = 360;
const LOG_DETAILS_WIDTH_STORAGE_KEY = "log_details_panel_width";

interface LogDetailsPanelProps {
  projectId: string;
  datasetId: string;
  logId: string;
  onClose: () => void;
  /** `sheet` is used when the panel renders inside a modal sheet — we drop
   *  the left border so it sits flush with the sheet edge. */
  variant?: "inline" | "sheet";
  className?: string;
}

/**
 * Self-contained log-details panel. Shown either as a right-hand split-view
 * column on wide screens or as a sheet on narrower viewports — the layout is
 * identical in either case so the parent just swaps the surrounding
 * container.
 */
export function LogDetailsPanel({
  projectId,
  datasetId,
  logId,
  onClose,
  variant = "inline",
  className,
}: LogDetailsPanelProps) {
  const log = resolveTelemetryEntry(projectId, datasetId, logId);
  const [tab, setTab] = useState<LogDetailsTab>("properties");
  const [showNullValues, setShowNullValues] = useState(false);
  const traceLoadState = useTraceContextSnapshot(projectId, datasetId, log?.traceId, log?.spanId);
  const { panelRef, resizeHandleProps, width } = useHorizontalResizablePanel<HTMLDivElement>({
    defaultWidth: LOG_DETAILS_DEFAULT_WIDTH_PX,
    edge: "left",
    maxWidth: LOG_DETAILS_MAX_WIDTH_PX,
    minRemainingWidth: LOG_DETAILS_MIN_REMAINING_WIDTH_PX,
    minWidth: LOG_DETAILS_MIN_WIDTH_PX,
    storageKey: LOG_DETAILS_WIDTH_STORAGE_KEY,
  });

  if (log === null) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 min-w-0 flex-col bg-background",
          variant === "inline" && "relative shrink-0 border-l border-border/70",
          className,
        )}
        ref={panelRef}
        style={variant === "inline" ? { width } : undefined}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-sm">
            Telemetry event is no longer available.
          </span>
          <IconButtonTooltip label="Close log details">
            <Button
              aria-label="Close log details"
              className="desktop-no-drag shrink-0"
              onClick={onClose}
              size="icon"
              variant="ghost"
            >
              <XIcon className="size-3.5" />
            </Button>
          </IconButtonTooltip>
        </div>
      </div>
    );
  }

  const traceContext =
    traceLoadState.status === "ready" && traceLoadState.trace.traceId === log.traceId
      ? traceLoadState.trace
      : null;
  const shouldShowTraceSlot =
    Boolean(log.traceId) &&
    traceLoadState.status !== "unavailable" &&
    traceLoadState.status !== "error";

  const handleExploreTrace = () => {
    if (!traceContext) return;
    // Title the tab after the root span — it's the most recognisable handle
    // for a trace and matches what users see at the top of the waterfall.
    // Fall back to the shortened trace id if the root span has no name.
    const rootSpan = traceContext.spans.find((span) => span.parentSpanId === null);
    const title =
      rootSpan?.name && rootSpan.name.trim().length > 0
        ? rootSpan.name
        : shortenTraceId(traceContext.traceId);

    const openTrace = () =>
      openTraceTab(datasetId, {
        traceId: traceContext.traceId,
        title,
        ...(log.spanId ? { initialSpanId: log.spanId } : {}),
      });

    if (variant === "sheet") {
      onClose();
      window.setTimeout(openTrace, SHEET_EXIT_ANIMATION_MS);
      return;
    }

    openTrace();
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col bg-background",
        variant === "inline" && "relative shrink-0 border-l border-border/70",
        className,
      )}
      ref={panelRef}
      style={variant === "inline" ? { width } : undefined}
    >
      {variant === "inline" ? (
        <button
          aria-label="Resize log details panel"
          className="-translate-x-1/2 absolute inset-y-0 left-0 z-20 w-3 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px hover:after:bg-border focus-visible:after:bg-ring"
          tabIndex={-1}
          title="Drag to resize log details panel"
          type="button"
          {...resizeHandleProps}
        />
      ) : null}
      <LogDetailsHeader log={log} onClose={onClose} />

      {traceContext !== null ? (
        <TraceOverview onExplore={handleExploreTrace} trace={traceContext} />
      ) : shouldShowTraceSlot && log.traceId ? (
        <PendingTraceOverview traceId={log.traceId} />
      ) : null}
      <TabBar
        activeTab={tab}
        onSelect={setTab}
        showNullValues={showNullValues}
        onToggleShowNullValues={setShowNullValues}
      />

      <Activity mode={tab === "properties" ? "visible" : "hidden"} name="Log properties">
        <EventPropertiesTab log={log} showNullValues={showNullValues} />
      </Activity>
      <Activity mode={tab === "raw" ? "visible" : "hidden"} name="Log raw data">
        <RawDataTab log={log} />
      </Activity>
    </div>
  );
}

/**
 * Placeholder row shapes for the {@link PendingTraceOverview} skeleton.
 * Depths and widths are staggered to evoke the silhouette of a real waterfall
 * without implying any specific data — see {@link TraceOverview} for the
 * component whose layout is being mirrored here.
 */
const TRACE_SKELETON_ROWS = [
  { depth: 0, name: "w-36", service: "w-16", duration: "w-11", barStart: 0, barWidth: 92 },
  { depth: 1, name: "w-32", service: "w-20", duration: "w-9", barStart: 4, barWidth: 54 },
  { depth: 1, name: "w-28", service: "w-14", duration: "w-8", barStart: 10, barWidth: 28 },
  { depth: 2, name: "w-32", service: "w-16", duration: "w-10", barStart: 14, barWidth: 38 },
  { depth: 2, name: "w-24", service: "w-20", duration: "w-9", barStart: 22, barWidth: 18 },
  { depth: 1, name: "w-20", service: "w-14", duration: "w-8", barStart: 58, barWidth: 32 },
] as const;

function PendingTraceOverview({ traceId }: { traceId: string }) {
  return (
    <div
      aria-label="Trace overview"
      aria-busy="true"
      className="h-[216px] shrink-0 overflow-hidden border-b border-border/60 bg-muted/10"
    >
      <div className="flex h-8 items-center justify-between gap-3 px-4 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground/50">Trace</span>
          <span className="min-w-0 truncate text-foreground/70" title={traceId}>
            {shortenTraceId(traceId)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-10" />
        </div>
      </div>
      <ol className="flex flex-col py-1">
        {TRACE_SKELETON_ROWS.map((row, index) => (
          <TraceSkeletonRow key={index} row={row} />
        ))}
      </ol>
    </div>
  );
}

function TraceSkeletonRow({ row }: { row: (typeof TRACE_SKELETON_ROWS)[number] }) {
  return (
    <li className="grid h-6 grid-cols-[minmax(0,1fr)_minmax(120px,1.2fr)_auto] items-center gap-3 px-4">
      <div className="flex min-w-0 items-center">
        {/* Depth indent — mirrors SpanRow so skeleton rows line up with real
            rows once the trace resolves. */}
        <span aria-hidden className="shrink-0" style={{ width: row.depth * 10 }} />
        <Skeleton className="mr-2 size-1.5 shrink-0 rounded-full" />
        <Skeleton className={cn("h-3", row.name)} />
        <Skeleton className={cn("ml-2 h-2.5", row.service)} />
      </div>
      <div
        aria-hidden
        className="flex h-1.5 w-full items-stretch overflow-hidden rounded-sm bg-foreground/[0.04]"
      >
        <span className="block" style={{ width: `${row.barStart}%` }} />
        <Skeleton className="block rounded-sm" style={{ width: `${row.barWidth}%` }} />
        <span className="block" style={{ width: `${100 - row.barStart - row.barWidth}%` }} />
      </div>
      <Skeleton className={cn("h-2.5 shrink-0", row.duration)} />
    </li>
  );
}

function LogDetailsHeader({ log, onClose }: { log: TelemetryEntry; onClose: () => void }) {
  const title = log.kind === "log" ? log.message : log.name;
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
      <span className="font-mono text-muted-foreground/80 text-sm">
        {detailKindLabel(log.kind)}
      </span>
      <span className="text-muted-foreground/50">—</span>
      <span className="min-w-0 flex-1 truncate font-mono text-foreground text-sm" title={title}>
        {title}
      </span>
      <IconButtonTooltip label="Close log details">
        <Button
          aria-label="Close log details"
          className="desktop-no-drag shrink-0"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <XIcon className="size-3.5" />
        </Button>
      </IconButtonTooltip>
    </div>
  );
}

function detailKindLabel(kind: TelemetryEntry["kind"]): string {
  switch (kind) {
    case "log":
      return "Log";
    case "span":
      return "Span";
    case "spanEvent":
      return "Event";
  }
}

interface TabBarProps {
  activeTab: LogDetailsTab;
  onSelect: (tab: LogDetailsTab) => void;
  showNullValues: boolean;
  onToggleShowNullValues: (next: boolean) => void;
}

function TabBar({ activeTab, onSelect, showNullValues, onToggleShowNullValues }: TabBarProps) {
  return (
    <TopTabsList aria-label="Log detail tabs">
      <TopTabsItem active={activeTab === "properties"}>
        <TopTabsTrigger active={activeTab === "properties"} onClick={() => onSelect("properties")}>
          Event Properties
        </TopTabsTrigger>
      </TopTabsItem>
      <TopTabsItem active={activeTab === "raw"}>
        <TopTabsTrigger active={activeTab === "raw"} onClick={() => onSelect("raw")}>
          Raw Data
        </TopTabsTrigger>
      </TopTabsItem>
      <div className="ml-auto flex items-center pr-3">
        <IconButtonTooltip label={showNullValues ? "Hide null values" : "Show null values"}>
          <Toggle
            aria-label={showNullValues ? "Hide null values" : "Show null values"}
            className="size-7 rounded-md"
            onPressedChange={onToggleShowNullValues}
            pressed={showNullValues}
            size="xs"
            variant="default"
          >
            <CircleSlashIcon className="size-4" />
          </Toggle>
        </IconButtonTooltip>
      </div>
    </TopTabsList>
  );
}

interface EventPropertiesTabProps {
  log: TelemetryEntry;
  showNullValues: boolean;
}

function EventPropertiesTab({ log, showNullValues }: EventPropertiesTabProps) {
  const entries = useMemo(() => buildLogDetailEntries(log), [log]);
  const visibleEntries = useMemo(
    () => (showNullValues ? entries : entries.filter((entry) => !isNullLike(entry.value))),
    [entries, showNullValues],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr className="border-border/60 border-y bg-muted/30 text-[11px] text-muted-foreground/70 uppercase tracking-wide">
              <th className="w-[40%] px-4 py-2 text-left font-medium">Field</th>
              <th className="px-4 py-2 text-left font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-muted-foreground/60 text-xs" colSpan={2}>
                  No properties to display.
                </td>
              </tr>
            ) : (
              visibleEntries.map((entry) => (
                <tr
                  className="border-border/40 border-b align-top last:border-b-0"
                  key={entry.field}
                >
                  <td className="w-[40%] break-all px-4 py-2.5 text-foreground/80">
                    {entry.field}
                  </td>
                  <td className="break-all px-4 py-2.5 leading-relaxed">
                    {renderDetailValue(entry.value)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function RawDataTab({ log }: { log: TelemetryEntry }) {
  // `renderDetailValue` already pretty-prints objects with syntax
  // highlighting, so reusing it here keeps the Raw Data tab visually in sync
  // with the coloured JSON blocks on the Event Properties tab.
  const renderedRaw = useMemo(() => renderDetailValue(buildLogRawData(log)), [log]);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="p-4 font-mono text-xs leading-relaxed">{renderedRaw}</div>
    </ScrollArea>
  );
}

/**
 * Produce a human-readable shortened trace id for tab titles when the trace
 * has no root span name to borrow from. Mirrors the approach used by
 * {@link TraceOverview} so both surfaces abbreviate identically.
 */
function shortenTraceId(traceId: string): string {
  if (traceId.length <= 14) return traceId;
  return `${traceId.slice(0, 8)}…${traceId.slice(-4)}`;
}
