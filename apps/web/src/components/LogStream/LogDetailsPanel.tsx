import { XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { ScrollArea } from "~/components/ui/scroll-area";
import { TopTabsItem, TopTabsList, TopTabsTrigger } from "~/components/ui/top-tabs";
import { getLogTraceContext } from "~/data/logApi";
import { cn } from "~/lib/utils";

import { openTraceTab } from "./datasetTabsStore";
import {
  buildLogDetailEntries,
  buildLogRawData,
  isNullLike,
  renderDetailValue,
} from "./logDetailsFormat";
import { TraceOverview } from "./TraceOverview";
import type { LogEntry, TraceContext } from "./types";

type LogDetailsTab = "properties" | "raw";

const SHEET_EXIT_ANIMATION_MS = 220;

interface LogDetailsPanelProps {
  projectId: string;
  datasetId: string;
  log: LogEntry;
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
  log,
  onClose,
  variant = "inline",
  className,
}: LogDetailsPanelProps) {
  const [tab, setTab] = useState<LogDetailsTab>("properties");
  const [showNullValues, setShowNullValues] = useState(false);
  const [traceContext, setTraceContext] = useState<TraceContext | null>(null);

  useEffect(() => {
    let cancelled = false;

    setTraceContext(null);
    if (!log.traceId) {
      return () => {
        cancelled = true;
      };
    }

    void getLogTraceContext(projectId, datasetId, log.traceId, log.spanId).then(
      (trace) => {
        if (!cancelled) {
          setTraceContext(trace);
        }
      },
      () => {
        if (!cancelled) {
          setTraceContext(null);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [datasetId, log.spanId, log.traceId, projectId]);

  const handleExploreTrace = useCallback(() => {
    if (!traceContext) return;
    // Title the tab after the root span — it's the most recognisable handle
    // for a trace and matches what users see at the top of the waterfall.
    // Fall back to the shortened trace id if the root span has no name.
    const rootSpan = traceContext.spans.find((span) => span.parentSpanId === null);
    const title =
      rootSpan?.name && rootSpan.name.trim().length > 0
        ? rootSpan.name
        : shortenTraceId(traceContext.traceId);

    const openTrace = () => openTraceTab(datasetId, {
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
  }, [datasetId, log.spanId, onClose, traceContext, variant]);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col bg-background",
        variant === "inline" && "border-l border-border/70",
        className,
      )}
    >
      <LogDetailsHeader log={log} onClose={onClose} />

      {traceContext !== null ? (
        <TraceOverview onExplore={handleExploreTrace} trace={traceContext} />
      ) : null}
      <TabBar activeTab={tab} onSelect={setTab} />

      {tab === "properties" ? (
        <EventPropertiesTab
          log={log}
          showNullValues={showNullValues}
          onToggleShowNullValues={setShowNullValues}
        />
      ) : (
        <RawDataTab log={log} />
      )}
    </div>
  );
}

function LogDetailsHeader({
  log,
  onClose,
}: {
  log: LogEntry;
  onClose: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
      <span className="font-mono text-muted-foreground/80 text-sm">Log</span>
      <span className="text-muted-foreground/50">—</span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-foreground text-sm"
        title={log.message}
      >
        {log.message}
      </span>
      <button
        aria-label="Close log details"
        className="desktop-no-drag inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

interface TabBarProps {
  activeTab: LogDetailsTab;
  onSelect: (tab: LogDetailsTab) => void;
}

function TabBar({ activeTab, onSelect }: TabBarProps) {
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
    </TopTabsList>
  );
}

interface EventPropertiesTabProps {
  log: LogEntry;
  showNullValues: boolean;
  onToggleShowNullValues: (next: boolean) => void;
}

function EventPropertiesTab({
  log,
  showNullValues,
  onToggleShowNullValues,
}: EventPropertiesTabProps) {
  const entries = useMemo(() => buildLogDetailEntries(log), [log]);
  const visibleEntries = useMemo(
    () => (showNullValues ? entries : entries.filter((entry) => !isNullLike(entry.value))),
    [entries, showNullValues],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
        <Checkbox
          checked={showNullValues}
          id="show-null-values"
          onCheckedChange={onToggleShowNullValues}
        />
        <label className="cursor-pointer select-none text-sm text-foreground" htmlFor="show-null-values">
          Show null values
        </label>
      </div>

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
                <td
                  className="px-4 py-6 text-center text-muted-foreground/60 text-xs"
                  colSpan={2}
                >
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

function RawDataTab({ log }: { log: LogEntry }) {
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
