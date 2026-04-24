import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "@legendapp/list/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChevronUpIcon, ColumnsIcon, LoaderCircleIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { IconButtonTooltip } from "~/components/ui/tooltip";

import { getLogLevelLabel, getLogLevelText, LogLevelBadge } from "./LogLevelBadge";
import { SourceBadge } from "./SourceBadge";
import type { TelemetryEntry } from "./types";
import { Button } from "../ui/button";

const END_REACHED_TRESHOLD = 48;

interface LogTableProps {
  logs: ReadonlyArray<TelemetryEntry>;
  hasPreviousPage?: boolean;
  isLoadingPrevious?: boolean;
  onLoadPrevious?: (() => Promise<void> | void) | undefined;
  /** Callback fired when a row is clicked. Enables the caller to open the
   *  log details panel. */
  onSelectLog?: (logId: string | null) => void;
  /** The currently selected log id; highlights the matching row. */
  selectedLogId?: string | null;
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
 *
 * `items-center` + truncating cells keeps every row a single line tall so the
 * list height is stable when the details panel opens and the table
 * container narrows.
 *
 * `min-w-[75rem]` pins the header and every row to the natural sum of their
 * column tracks (6 + 14 + 14 + 8 + 16 + 7 + 1.5 rem columns, 6rem of gaps,
 * 2rem of padding ≈ 74.5rem). When the surrounding container is narrower the
 * enclosing scroll wrapper takes over and pans sideways instead of letting
 * the `Name / Message` column collapse or the header labels wrap.
 */
const ROW_GRID_CLASS =
  "grid min-w-[75rem] grid-cols-[6rem_14rem_14rem_8rem_minmax(0,1fr)_7rem_auto] items-center gap-4 px-4";

const ROW_ESTIMATED_SIZE = 40;

/**
 * Virtualised log-stream table powered by `@legendapp/list`. The column
 * header lives outside the virtualised region so it stays visually pinned
 * without having to participate in recycling; LegendList owns the scroll
 * container and renders only the visible window of log rows.
 */
export const LogTable = forwardRef<LogTableHandle, LogTableProps>(function LogTable(
  {
    logs,
    hasPreviousPage = false,
    isLoadingPrevious = false,
    onLoadPrevious,
    onSelectLog,
    selectedLogId = null,
    waiting = true,
    className,
  },
  ref,
) {
  const listRef = useRef<LegendListRef | null>(null);
  const loadingPreviousRef = useRef(false);
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
    if (!isLoadingPrevious) {
      loadingPreviousRef.current = false;
    }
  }, [isLoadingPrevious]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setShowJumpToEnd(!isNearBottom(listRef.current));
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [logs, waiting]);

  const loadPreviousPage = async () => {
    if (!hasPreviousPage || isLoadingPrevious || loadingPreviousRef.current || !onLoadPrevious) {
      return;
    }

    loadingPreviousRef.current = true;
    const element = listRef.current?.getScrollableNode() as HTMLElement | null | undefined;
    const previousScrollHeight = element?.scrollHeight ?? 0;
    const previousScrollTop = element?.scrollTop ?? 0;

    try {
      await onLoadPrevious();
    } finally {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const nextElement = listRef.current?.getScrollableNode() as
            | HTMLElement
            | null
            | undefined;
          if (nextElement && previousScrollHeight > 0) {
            nextElement.scrollTop =
              nextElement.scrollHeight - previousScrollHeight + previousScrollTop;
          }
        });
      });
    }
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setShowJumpToEnd(!isNearBottomEvent(event));
    if (isNearTopEvent(event)) {
      void loadPreviousPage();
    }
  };

  const handleJumpToEnd = () => {
    setShowJumpToEnd(false);
    onSelectLog?.(null);
    void listRef.current?.scrollToEnd({ animated: false });
  };

  // Closure-style render keeps per-render selection/click wiring co-located
  // with the rest of the table state. `extraData` forces LegendList to rerun
  // the renderer when these inputs change even though the data array itself
  // may be stable.
  const renderRow = ({ item }: LegendListRenderItemProps<TelemetryEntry>) => (
    <LogRow isSelected={item.id === selectedLogId} log={item} onSelect={onSelectLog} />
  );

  return (
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
      {/*
       * Inner wrapper is the horizontal scroll container: the header and the
       * virtualised row list must pan together so columns stay aligned, which
       * means both need to live inside the same `overflow-x-auto` box. We pin
       * `overflow-y: hidden` here because LegendList owns vertical scrolling
       * internally — otherwise this wrapper would fight it for the vertical
       * scrollbar. The outer container keeps `overflow: hidden` so the
       * absolutely-positioned "Jump to end" button stays anchored to the
       * viewport instead of scrolling off sideways with the content.
       */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto overflow-y-hidden">
        <Header />
        <LegendList
          // `min-w-[75rem]` matches the row grid's natural width so the list's
          // internal scroll container is as wide as the rows it renders,
          // avoiding a second (inner) horizontal scrollbar.
          className="min-h-0 min-w-[75rem] flex-1"
          data={logs as Array<TelemetryEntry>}
          estimatedItemSize={ROW_ESTIMATED_SIZE}
          extraData={{ onSelectLog, selectedLogId }}
          keyExtractor={extractLogKey}
          // Keep short log sets anchored to the top of the viewport; live-tail
          // following is handled separately by `maintainScrollAtEnd`.
          maintainScrollAtEnd={selectedLogId === null}
          onEndReachedThreshold={END_REACHED_TRESHOLD / 2}
          ListHeaderComponent={
            hasPreviousPage ? (
              <LoadPreviousHeader loading={isLoadingPrevious} onClick={loadPreviousPage} />
            ) : logs.length > 0 ? (
              <StartOfLogsHeader />
            ) : null
          }
          ListFooterComponent={waiting ? <WaitingFooter /> : null}
          onScroll={handleScroll}
          recycleItems
          maintainVisibleContentPosition={{ data: true }}
          alwaysRender={{ top: 20, bottom: 20 }}
          ref={listRef}
          renderItem={renderRow}
          style={{ minHeight: 0, width: "100%" }}
        />
      </div>
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

function extractLogKey(item: TelemetryEntry): string {
  return item.id;
}

function LoadPreviousHeader({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => Promise<void> | void;
}) {
  return (
    <div className="flex items-center justify-center border-border/40 border-b py-3">
      <Button disabled={loading} onClick={onClick} size="xs" variant="ghost">
        {loading ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : (
          <ChevronUpIcon className="size-3.5" />
        )}
        {loading ? "Loading older telemetry" : "Load older telemetry"}
      </Button>
    </div>
  );
}

function StartOfLogsHeader() {
  return (
    <div className="border-border/40 border-b py-3 text-center text-muted-foreground/50 text-xs">
      Start of telemetry
    </div>
  );
}

function Header() {
  return (
    <div
      className={cn(
        // `whitespace-nowrap` keeps each label on one line so the header's
        // height is stable as the table container narrows — otherwise the
        // `Name / Message` label wraps and the whole list jumps down by a
        // line or two.
        "shrink-0 whitespace-nowrap border-b border-border/60 bg-background/90 py-2 font-medium text-[11px] text-muted-foreground/70 uppercase tracking-wide backdrop-blur",
        ROW_GRID_CLASS,
      )}
    >
      <div>Kind</div>
      <div>Time</div>
      <div>Source</div>
      <div>Status</div>
      <div>Name / Message</div>
      <div>Duration</div>
      <IconButtonTooltip label="Configure columns">
        <button
          aria-label="Configure columns"
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground"
          type="button"
        >
          <ColumnsIcon className="size-3.5" />
        </button>
      </IconButtonTooltip>
    </div>
  );
}

interface LogRowProps {
  log: TelemetryEntry;
  isSelected: boolean;
  onSelect: ((logId: string) => void) | undefined;
}

function LogRow({ log, isSelected, onSelect }: LogRowProps) {
  // Use a `button` element so the row is both keyboard-accessible and gets
  // the expected focus-visible ring for free. `text-left` and `w-full` are
  // needed to undo the browser defaults that would otherwise centre and
  // shrink the content.
  //
  // Every cell is constrained to a single line (truncate / shrink-0) so the
  // row height stays constant as the table container narrows — e.g. when the
  // log details panel opens alongside the list. The full message is always
  // available in the details panel, so truncating the preview is safe.
  return (
    <button
      aria-pressed={isSelected}
      className={cn(
        // Intentionally no `transition-*` — hover/selection should snap in
        // and out. Row changes are frequent enough (scrolling through a live
        // stream) that even a fade-out on exit reads as UI lag.
        //
        // A 2px transparent left border is always present so the layout
        // stays identical when a row flips to the selected state; the border
        // just gains its accent colour instead of appearing out of nowhere.
        "h-10 w-full cursor-pointer border-b border-l-2 border-border/40 border-l-transparent text-left font-mono text-xs text-foreground/90 outline-none hover:bg-accent/25 focus-visible:bg-accent/40",
        isSelected && "border-l-primary bg-accent/70 text-foreground hover:bg-accent/70",
        ROW_GRID_CLASS,
      )}
      // Select on `mousedown` for a more responsive feel — the details panel
      // opens the instant the press lands instead of waiting for the release
      // that `onClick` would require.
      onMouseDown={(event) => {
        // Only left button; middle / right clicks should not select.
        if (event.button === 0) {
          onSelect?.(log.id);
        }
      }}
      // Keep keyboard activation working (Enter / Space on a focused button
      // fire `click` but never `mousedown`). `event.detail === 0` identifies
      // those keyboard-originated clicks so we don't double-fire on real
      // mouse clicks, where `detail` is always ≥ 1.
      onClick={(event) => {
        if (event.detail === 0) {
          onSelect?.(log.id);
        }
      }}
      type="button"
    >
      <span className="truncate text-[11px] text-muted-foreground uppercase">
        {kindLabel(log.kind)}
      </span>
      <time
        className="truncate text-[11px] text-muted-foreground tabular-nums"
        dateTime={log.timestamp.toISOString()}
      >
        {formatTimestamp(log.timestamp)}
      </time>
      <div className="min-w-0">
        <SourceBadge icon={log.sourceIcon} name={log.sourceName} />
      </div>
      <div>
        {log.kind === "log" ? (
          <LogLevelBadge level={log.level} />
        ) : (
          <span className={cn("text-xs", statusClass(log.kind === "span" ? log.status : "unset"))}>
            {log.kind === "span" ? log.status : "event"}
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center">
        {log.kind === "log" ? (
          <span
            className={cn(
              "mr-1 inline-flex shrink-0 items-center gap-1.5 font-semibold",
              getLogLevelText(log.level),
            )}
          >
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rounded-full", levelDotClass(log.level))}
            />
            {getLogLevelLabel(log.level)}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-foreground/80">{telemetryTitle(log)}</span>
      </div>
      <div className="truncate text-[11px] text-muted-foreground tabular-nums">
        {log.kind === "span" ? formatDuration(log.durationUs) : ""}
      </div>
      <div className="w-4" />
    </button>
  );
}

function WaitingFooter() {
  return (
    <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground/60 text-xs">
      <span className="inline-flex size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
      Waiting for telemetry…
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

function isNearTopEvent(event: NativeSyntheticEvent<NativeScrollEvent>): boolean {
  return event.nativeEvent.contentOffset.y < 32;
}

function isNearBottomMetrics(metrics: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop < END_REACHED_TRESHOLD;
}

/** Reuses the level palette for the inline dot in the message cell. */
function levelDotClass(level: Extract<TelemetryEntry, { kind: "log" }>["level"]): string {
  switch (level) {
    case "trace":
      return "bg-zinc-400";
    case "debug":
      return "bg-sky-500 dark:bg-sky-400";
    case "info":
      return "bg-emerald-500 dark:bg-emerald-400";
    case "warn":
      return "bg-amber-400";
    case "error":
      return "bg-rose-500";
    case "fatal":
      return "bg-fuchsia-500";
  }
}

function kindLabel(kind: TelemetryEntry["kind"]): string {
  switch (kind) {
    case "log":
      return "log";
    case "span":
      return "span";
    case "spanEvent":
      return "event";
  }
}

function telemetryTitle(entry: TelemetryEntry): string {
  switch (entry.kind) {
    case "log":
      return entry.message;
    case "span":
    case "spanEvent":
      return entry.name;
  }
}

function statusClass(status: "ok" | "error" | "unset"): string {
  switch (status) {
    case "ok":
      return "text-emerald-600 dark:text-emerald-400";
    case "error":
      return "text-rose-600 dark:text-rose-400";
    case "unset":
      return "text-muted-foreground";
  }
}

function formatDuration(durationUs: number): string {
  if (durationUs >= 1_000_000) {
    return `${(durationUs / 1_000_000).toFixed(2)}s`;
  }
  if (durationUs >= 1_000) {
    return `${(durationUs / 1_000).toFixed(1)}ms`;
  }
  return `${Math.round(durationUs)}us`;
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
