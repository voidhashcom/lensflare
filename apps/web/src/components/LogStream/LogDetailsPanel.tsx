import { XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";

import {
  buildLogDetailEntries,
  buildLogRawData,
  isNullLike,
  renderDetailValue,
} from "./logDetailsFormat";
import { buildLogTraceContext } from "./mockTrace";
import { TraceOverview } from "./TraceOverview";
import type { LogEntry } from "./types";

type LogDetailsTab = "properties" | "raw";

interface LogDetailsPanelProps {
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
  log,
  onClose,
  variant = "inline",
  className,
}: LogDetailsPanelProps) {
  const [tab, setTab] = useState<LogDetailsTab>("properties");
  const [showNullValues, setShowNullValues] = useState(false);

  // Trace context for the log, when the log is part of a trace. Rendered
  // above the tab bar so users can see where in the request lifecycle the
  // event fired before drilling into the event's raw fields. Memoised on
  // `log` — the mock generator is pure but non-trivial.
  const traceContext = useMemo(() => buildLogTraceContext(log), [log]);

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col bg-background",
        variant === "inline" && "border-l border-border/70",
        className,
      )}
    >
      {/* Close button is anchored to the panel's top-right regardless of
          whether the trace overview renders, so the dismiss affordance
          doesn't drift down when a trace is present. */}
      <Button
        aria-label="Close log details"
        className="absolute right-2 top-2 z-10"
        onClick={onClose}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon />
      </Button>

      {traceContext !== null ? <TraceOverview trace={traceContext} /> : null}
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

interface TabBarProps {
  activeTab: LogDetailsTab;
  onSelect: (tab: LogDetailsTab) => void;
}

function TabBar({ activeTab, onSelect }: TabBarProps) {
  return (
    // `pr-10` reserves space on the right for the absolutely-positioned
    // close button so the tab labels never collide with it.
    <div className="flex shrink-0 min-w-0 items-center border-b border-border/60 pr-10">
      <TabButton active={activeTab === "properties"} onClick={() => onSelect("properties")}>
        Event Properties
      </TabButton>
      <TabButton active={activeTab === "raw"} onClick={() => onSelect("raw")}>
        Raw Data
      </TabButton>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      className={cn(
        "-mb-px relative cursor-pointer px-4 py-3 text-sm transition-colors",
        active
          ? "border-b-2 border-foreground text-foreground"
          : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
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
