import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "@legendapp/list/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ColumnsIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import { getLogLevelLabel, getLogLevelText, LogLevelBadge } from "./LogLevelBadge";
import { SourceBadge } from "./SourceBadge";
import type { LogEntry } from "./types";
import { Button } from "../ui/button";

interface LogTableProps {
  logs: ReadonlyArray<LogEntry>;
  /** Shows the "Waiting for logs…" footer. When false the table renders
   *  without a pending indicator (useful for the static empty state). */
  waiting?: boolean;
  className?: string;
}

export interface LogTableHandle {
  isNearBottom: () => boolean;
  scrollToBottom: () => void;
  scrollToTop: () => void;
}

/**
 * Shared grid template for the column header and every row so that labels
 * and cells align precisely. Centralising it here keeps the two DOM nodes
 * in lockstep when columns are added or resized.
 */
const ROW_GRID_CLASS =
  "grid grid-cols-[14rem_14rem_7rem_minmax(0,1fr)_auto] items-start gap-4 px-4";

const ROW_ESTIMATED_SIZE = 44;

/**
 * Virtualised log-stream table powered by `@legendapp/list`. The column
 * header lives outside the virtualised region so it stays visually pinned
 * without having to participate in recycling; LegendList owns the scroll
 * container and renders only the visible window of log rows.
 */
export const LogTable = forwardRef<LogTableHandle, LogTableProps>(function LogTable(
  { logs, waiting = true, className },
  ref,
) {
  const listRef = useRef<LegendListRef | null>(null);
  const [showJumpToEnd, setShowJumpToEnd] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      isNearBottom: () => isNearBottom(listRef.current),
      scrollToBottom: () => {
        void listRef.current?.scrollToEnd({ animated: true });
      },
      scrollToTop: () => {
        void listRef.current?.scrollToOffset({ offset: 0, animated: true });
      },
    }),
    [],
  );

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setShowJumpToEnd(!isNearBottom(listRef.current));
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [logs, waiting]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setShowJumpToEnd(!isNearBottomEvent(event));
  };

  const handleJumpToEnd = () => {
    setShowJumpToEnd(false);
    void listRef.current?.scrollToEnd({ animated: true });
  };

  return (
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
      <Header />
      <LegendList
        className="min-h-0 min-w-0 flex-1"
        data={logs as Array<LogEntry>}
        estimatedItemSize={ROW_ESTIMATED_SIZE}
        keyExtractor={extractLogKey}
        alignItemsAtEnd={true}
        maintainScrollAtEnd={true}
        ListFooterComponent={waiting ? <WaitingFooter /> : null}
        onScroll={handleScroll}
        recycleItems
        ref={listRef}
        renderItem={renderLogRow}
        style={{ minHeight: 0, width: "100%" }}
      />
      {showJumpToEnd ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
          <Button
            className="pointer-events-auto shadow-lg"
            onClick={handleJumpToEnd}
            size="sm"
            variant="secondary"
          >
            Jump to end
          </Button>
        </div>
      ) : null}
    </div>
  );
});

function extractLogKey(item: LogEntry): string {
  return item.id;
}
function renderLogRow({ item }: LegendListRenderItemProps<LogEntry>) {
  return <LogRow log={item} />;
}

function Header() {
  return (
    <div
      className={cn(
        "shrink-0 border-b border-border/60 bg-background/90 py-2 font-medium text-[11px] text-muted-foreground/70 uppercase tracking-wide backdrop-blur",
        ROW_GRID_CLASS,
      )}
    >
      <div>Time</div>
      <div>Source</div>
      <div>Level</div>
      <div>Message</div>
      <button
        aria-label="Configure columns"
        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground"
        type="button"
      >
        <ColumnsIcon className="size-3.5" />
      </button>
    </div>
  );
}

function LogRow({ log }: { log: LogEntry }) {
  return (
    <div
      className={cn(
        "border-border/40 border-b py-2.5 font-mono text-xs text-foreground/90 hover:bg-accent/30",
        ROW_GRID_CLASS,
      )}
    >
      <time
        className="pt-0.5 text-[11px] text-muted-foreground tabular-nums"
        dateTime={log.timestamp.toISOString()}
      >
        {formatTimestamp(log.timestamp)}
      </time>
      <div className="min-w-0 pt-0.5">
        <SourceBadge icon={log.sourceIcon} name={log.sourceName} />
      </div>
      <div className="pt-0.5">
        <LogLevelBadge level={log.level} />
      </div>
      <div className="min-w-0 break-all leading-5">
        <span
          className={cn(
            "mr-1 inline-flex items-center gap-1.5 font-semibold",
            getLogLevelText(log.level),
          )}
        >
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", levelDotClass(log.level))}
          />
          {getLogLevelLabel(log.level)}
        </span>
        <span className="text-foreground/80">{log.message}</span>
      </div>
      <div className="w-4" />
    </div>
  );
}

function WaitingFooter() {
  return (
    <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground/60 text-xs">
      <span className="inline-flex size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
      Waiting for logs…
    </div>
  );
}

function isNearBottom(list: LegendListRef | null): boolean {
  const element = list?.getScrollableNode() as HTMLElement | null | undefined;
  if (!element) {
    return false;
  }
  return isNearBottomMetrics({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  });
}

function isNearBottomEvent(event: NativeSyntheticEvent<NativeScrollEvent>): boolean {
  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
  return isNearBottomMetrics({
    clientHeight: layoutMeasurement.height,
    scrollHeight: contentSize.height,
    scrollTop: contentOffset.y,
  });
}

function isNearBottomMetrics(metrics: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop < 32;
}

/** Reuses the level palette for the inline dot in the message cell. */
function levelDotClass(level: LogEntry["level"]): string {
  switch (level) {
    case "trace":
      return "bg-zinc-400";
    case "debug":
      return "bg-sky-400";
    case "info":
      return "bg-emerald-400";
    case "warn":
      return "bg-amber-400";
    case "error":
      return "bg-rose-500";
    case "fatal":
      return "bg-fuchsia-500";
  }
}

/**
 * Formats a timestamp like `2026-04-22 21:23:06.360 CEST`, matching the
 * reference screenshot. Uses the local timezone abbreviation from
 * `Intl.DateTimeFormat` so the label stays accurate across environments.
 */
function formatTimestamp(date: Date): string {
  const pad = (value: number, digits = 2) => value.toString().padStart(digits, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  const tz = extractTimezone(date);
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms} ${tz}`;
}

function extractTimezone(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(date);
    const name = parts.find((part) => part.type === "timeZoneName")?.value;
    return name ?? "";
  } catch {
    return "";
  }
}
