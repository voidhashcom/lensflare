import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  ListTreeIcon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type KeyboardEvent } from "react";

import { TopTabsItem, TopTabsList, TopTabsTrigger } from "~/components/ui/top-tabs";
import { getLogTraceContext } from "~/data/logApi";
import { cn } from "~/lib/utils";

import type { TraceContext, TraceSpan } from "./types";

/**
 * Number of tick labels to render on the top/bottom time ruler. Eight
 * intervals (nine labels) matches the density of the Axiom reference
 * screenshot without crowding narrow viewports.
 */
const RULER_TICK_COUNT = 9;

/**
 * Width of the "name + service" column in the waterfall, in pixels. Fixed so
 * the timeline bars line up across rows regardless of span name length.
 */
const SPAN_NAME_COL_PX = 280;

/** Pixel width of the right-hand span details panel. */
const DETAILS_PANEL_PX = 420;

type DetailsTab = "fields" | "events" | "links";

interface TraceExplorerProps {
  projectId: string;
  datasetId: string;
  traceId: string;
  /** Span highlighted on first mount — usually inherited from the log that
   *  spawned the explorer tab. When absent we fall back to the first error
   *  span, then the root span. */
  initialSpanId?: string;
  className?: string;
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "empty" }
  | { readonly status: "ready"; readonly trace: TraceContext };

/**
 * Full-screen distributed-trace explorer. Rendered when a trace tab is
 * active in the dataset tab strip. Shape mirrors the Axiom reference:
 * filter + counts toolbar on top, a time-rulered waterfall on the left,
 * and a span-details panel on the right.
 *
 * The explorer re-uses the same {@link TraceContext} payload as the inline
 * {@link TraceOverview} (fetched from `/traces/:id`) so callers don't need
 * to wire a separate data source.
 */
export function TraceExplorer({
  projectId,
  datasetId,
  traceId,
  initialSpanId,
  className,
}: TraceExplorerProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(
    initialSpanId ?? null,
  );
  const [filter, setFilter] = useState("");
  const [detailsTab, setDetailsTab] = useState<DetailsTab>("fields");

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });

    getLogTraceContext(projectId, datasetId, traceId, initialSpanId).then(
      (trace) => {
        if (cancelled) return;
        if (trace === null) {
          setLoadState({ status: "empty" });
          return;
        }
        setLoadState({ status: "ready", trace });
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load trace.",
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [projectId, datasetId, traceId, initialSpanId]);

  // Pick a sensible initial selection once the trace loads. Prefer the span
  // the user came from, then the first error (most users open the explorer
  // *because* something failed), falling back to the root span.
  useEffect(() => {
    if (loadState.status !== "ready") return;
    const { trace } = loadState;

    setSelectedSpanId((current) => {
      if (current !== null && trace.spans.some((span) => span.id === current)) {
        return current;
      }
      const errorSpan = trace.spans.find((span) => span.status === "error");
      return errorSpan?.id ?? trace.spans[0]?.id ?? null;
    });
  }, [loadState]);

  const depthByParent = useMemo(() => {
    if (loadState.status !== "ready") return new Map<string, number>();
    return computeDepths(loadState.trace.spans);
  }, [loadState]);

  const normalizedFilter = filter.trim().toLowerCase();
  const filteredSpans = useMemo(() => {
    if (loadState.status !== "ready") return [] as ReadonlyArray<TraceSpan>;
    if (normalizedFilter.length === 0) return loadState.trace.spans;
    return loadState.trace.spans.filter(
      (span) =>
        span.name.toLowerCase().includes(normalizedFilter) ||
        span.serviceName.toLowerCase().includes(normalizedFilter),
    );
  }, [loadState, normalizedFilter]);

  const errorSpans = useMemo(() => {
    if (loadState.status !== "ready") return [] as ReadonlyArray<TraceSpan>;
    return loadState.trace.spans.filter((span) => span.status === "error");
  }, [loadState]);

  const moveSelection = useCallback(
    (direction: "prev" | "next") => {
      if (filteredSpans.length === 0) return;
      const currentIndex = selectedSpanId
        ? filteredSpans.findIndex((span) => span.id === selectedSpanId)
        : -1;
      const nextIndex =
        currentIndex < 0
          ? 0
          : direction === "next"
            ? Math.min(currentIndex + 1, filteredSpans.length - 1)
            : Math.max(currentIndex - 1, 0);
      const nextSpan = filteredSpans[nextIndex];
      if (nextSpan) {
        setSelectedSpanId(nextSpan.id);
      }
    },
    [filteredSpans, selectedSpanId],
  );

  const selectedVisibleIndex = useMemo(
    () => filteredSpans.findIndex((span) => span.id === selectedSpanId),
    [filteredSpans, selectedSpanId],
  );

  return (
    <div
      aria-label="Trace explorer"
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background",
        className,
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ExplorerToolbar
          errorCount={errorSpans.length}
          filter={filter}
          onFilterChange={setFilter}
          onMoveSelection={moveSelection}
          selectedVisibleIndex={selectedVisibleIndex}
          spanCount={
            loadState.status === "ready" ? loadState.trace.spans.length : 0
          }
          visibleSpanCount={filteredSpans.length}
        />
        <TraceBody
          depthByParent={depthByParent}
          loadState={loadState}
          onSelect={setSelectedSpanId}
          selectedSpanId={selectedSpanId}
          visibleSpans={filteredSpans}
        />
      </div>
      <aside
        aria-label="Span details"
        className="flex shrink-0 flex-col border-l border-border/60"
        style={{ width: DETAILS_PANEL_PX }}
      >
        {loadState.status === "ready" ? (
          <SpanDetailsPanel
            activeTab={detailsTab}
            onSelectTab={setDetailsTab}
            selectedSpan={
              selectedSpanId
                ? (loadState.trace.spans.find((span) => span.id === selectedSpanId) ?? null)
                : null
            }
            trace={loadState.trace}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-muted-foreground/70 text-xs">
            {loadState.status === "loading" ? "Loading trace…" : "No span selected."}
          </div>
        )}
      </aside>
    </div>
  );
}

interface ExplorerToolbarProps {
  filter: string;
  onFilterChange: (next: string) => void;
  visibleSpanCount: number;
  selectedVisibleIndex: number;
  spanCount: number;
  errorCount: number;
  onMoveSelection: (direction: "prev" | "next") => void;
}

function ExplorerToolbar({
  filter,
  onFilterChange,
  visibleSpanCount,
  selectedVisibleIndex,
  spanCount,
  errorCount,
  onMoveSelection,
}: ExplorerToolbarProps) {
  const moveUpDisabled = visibleSpanCount === 0 || selectedVisibleIndex === 0;
  const moveDownDisabled =
    visibleSpanCount === 0 ||
    (selectedVisibleIndex >= 0 && selectedVisibleIndex === visibleSpanCount - 1);
  const handleMoveMouseDown =
    (direction: "prev" | "next") => (event: MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      onMoveSelection(direction);
    };
  const handleMoveClick =
    (direction: "prev" | "next") => (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail === 0) {
        onMoveSelection(direction);
      }
    };
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-muted/10 px-3 py-2">
      <div className="relative flex min-w-0 flex-1 items-center">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground/60"
        />
        <input
          aria-label="Filter spans"
          className="h-8 w-full min-w-0 rounded-md border border-input bg-background/60 pl-8 pr-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none"
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Filter spans"
          type="search"
          value={filter}
        />
      </div>
      <button
        aria-label="Toggle span tree"
        className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input bg-background/60 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        type="button"
      >
        <ListTreeIcon className="size-3.5" />
      </button>
      <div className="flex shrink-0 items-center gap-3 font-mono text-xs text-muted-foreground/80">
        <span>
          {spanCount} span{spanCount === 1 ? "" : "s"}
        </span>
        <span
          className={cn(
            errorCount > 0 ? "text-rose-400" : "text-muted-foreground/60",
          )}
        >
          {errorCount} error{errorCount === 1 ? "" : "s"}
        </span>
        <div className="inline-flex items-center gap-0.5">
          <button
            aria-label="Select previous span"
            className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            disabled={moveUpDisabled}
            onClick={handleMoveClick("prev")}
            onMouseDown={handleMoveMouseDown("prev")}
            type="button"
          >
            <ChevronUpIcon className="size-3.5" />
          </button>
          <button
            aria-label="Select next span"
            className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            disabled={moveDownDisabled}
            onClick={handleMoveClick("next")}
            onMouseDown={handleMoveMouseDown("next")}
            type="button"
          >
            <ChevronDownIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface TraceBodyProps {
  loadState: LoadState;
  visibleSpans: ReadonlyArray<TraceSpan>;
  depthByParent: ReadonlyMap<string, number>;
  selectedSpanId: string | null;
  onSelect: (spanId: string) => void;
}

function TraceBody({
  loadState,
  visibleSpans,
  depthByParent,
  selectedSpanId,
  onSelect,
}: TraceBodyProps) {
  if (loadState.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground/70 text-xs">
        Loading trace…
      </div>
    );
  }
  if (loadState.status === "error") {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-rose-400/90 text-xs">
        {loadState.message}
      </div>
    );
  }
  if (loadState.status === "empty") {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground/70 text-xs">
        No trace data available.
      </div>
    );
  }

  const { trace } = loadState;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <TimelineRuler
        edge="start"
        label={`Start ${formatTraceTimestamp(trace.startTime)}`}
        totalDurationUs={trace.totalDurationUs}
      />
      <ol className="flex flex-col py-1">
        {visibleSpans.length === 0 ? (
          <li className="flex h-8 items-center px-4 font-mono text-muted-foreground/60 text-xs">
            No spans match the current filter.
          </li>
        ) : (
          visibleSpans.map((span) => (
            <ExplorerSpanRow
              depth={depthByParent.get(span.id) ?? 0}
              isSelected={span.id === selectedSpanId}
              key={span.id}
              onSelect={onSelect}
              span={span}
              totalDurationUs={trace.totalDurationUs}
            />
          ))
        )}
      </ol>
      <div className="mt-auto">
        <TimelineRuler
          edge="end"
          label={`Ended ${formatTraceTimestamp(
            new Date(trace.startTime.getTime() + trace.totalDurationUs / 1000),
          )}`}
          totalDurationUs={trace.totalDurationUs}
        />
      </div>
    </div>
  );
}

interface TimelineRulerProps {
  label: string;
  totalDurationUs: number;
  /** Border orientation — the top ruler borders below, the bottom above. */
  edge: "start" | "end";
}

function TimelineRuler({ label, totalDurationUs, edge }: TimelineRulerProps) {
  const ticks = useMemo(() => buildRulerTicks(totalDurationUs), [totalDurationUs]);
  return (
    <div
      className={cn(
        "grid shrink-0 items-center gap-3 bg-muted/10 px-4 font-mono text-[10px] text-muted-foreground/60",
        edge === "start" ? "border-b border-border/60" : "border-t border-border/60",
      )}
      style={{
        gridTemplateColumns: `${SPAN_NAME_COL_PX}px 1fr`,
        height: 28,
      }}
    >
      <span className="truncate uppercase tracking-wide" title={label}>
        {label}
      </span>
      <div className="relative h-full">
        {ticks.map((tick) => (
          <span
            className="-translate-x-1/2 absolute top-1/2 -translate-y-1/2 whitespace-nowrap tabular-nums"
            key={tick.offsetUs}
            style={{ left: `${tick.leftPercent}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}

interface ExplorerSpanRowProps {
  span: TraceSpan;
  depth: number;
  isSelected: boolean;
  totalDurationUs: number;
  onSelect: (spanId: string) => void;
}

function ExplorerSpanRow({
  span,
  depth,
  isSelected,
  totalDurationUs,
  onSelect,
}: ExplorerSpanRowProps) {
  const scale = totalDurationUs === 0 ? 0 : 100 / totalDurationUs;
  const startPercent = span.startOffsetUs * scale;
  // Guarantee a visible bar even for spans that finish in microseconds.
  const widthPercent = Math.max(span.durationUs * scale, 0.8);
  const remainingPercent = Math.max(100 - startPercent - widthPercent, 0);

  const isError = span.status === "error";
  const barColour = isError ? "bg-rose-500/80" : "bg-sky-400/80";
  const dotColour = isError ? "bg-rose-400" : "bg-sky-400";
  const selectSpan = () => {
    onSelect(span.id);
  };
  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    selectSpan();
  };
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Keyboard activation still dispatches click, but with `detail === 0`.
    if (event.detail === 0) {
      selectSpan();
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectSpan();
    }
  };

  return (
    <li>
      <button
        aria-label={`Select span ${span.name}`}
        aria-pressed={isSelected}
        className={cn(
          "grid w-full cursor-pointer items-center gap-3 border-l-2 border-transparent px-4 py-2 text-left hover:bg-foreground/[0.03] focus-visible:ring-1 focus-visible:ring-ring",
          isSelected && "border-foreground/60 bg-foreground/[0.05]",
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
        style={{ gridTemplateColumns: `${SPAN_NAME_COL_PX}px 1fr` }}
        type="button"
      >
        <div className="flex min-w-0 items-start gap-2">
          <TreeGuide depth={depth} />
          <span
            aria-hidden
            className={cn("mt-1 inline-block size-1.5 shrink-0 rounded-full", dotColour)}
          />
          <span className="flex min-w-0 flex-col">
            <span
              className={cn(
                "min-w-0 truncate font-mono text-xs",
                isError ? "text-rose-300" : "text-foreground/90",
              )}
              title={span.name}
            >
              {span.name}
            </span>
            <span
              className="min-w-0 truncate font-mono text-[10px] text-muted-foreground/60"
              title={span.serviceName}
            >
              {span.serviceName}
            </span>
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
        <div
          aria-hidden
          className="relative flex h-2 w-full items-stretch overflow-hidden rounded-sm bg-foreground/[0.04]"
        >
          <span className="block" style={{ width: `${startPercent}%` }} />
          <span className={cn("block rounded-sm", barColour)} style={{ width: `${widthPercent}%` }} />
          <span className="block" style={{ width: `${remainingPercent}%` }} />
          {/* Small diamond marker at the end of the bar — echoes the Axiom
              screenshot where each span terminates with a ◆ glyph. */}
          <span
            className={cn(
              "-translate-x-1/2 -translate-y-1/2 absolute top-1/2 size-1.5 rotate-45",
              dotColour,
            )}
            style={{ left: `${Math.min(startPercent + widthPercent, 100)}%` }}
          />
        </div>
        <span
          className="font-mono text-[10px] text-muted-foreground/70 tabular-nums"
          style={{ paddingLeft: `${startPercent}%` }}
        >
          {formatDuration(span.durationUs)}
        </span>
        </div>
      </button>
    </li>
  );
}

function TreeGuide({ depth }: { depth: number }) {
  if (depth === 0) {
    return <span aria-hidden className="w-0 shrink-0" />;
  }
  // Fixed-width monospace guide: one 12px step per depth level keeps indent
  // proportional to the waterfall without wrapping long chains.
  return (
    <span
      aria-hidden
      className="shrink-0 font-mono text-[11px] text-muted-foreground/40 leading-none"
      style={{ width: depth * 12 }}
    >
      {/* Branch glyph — a light connector so the hierarchy reads at a glance
          without overpowering the content. */}
      {"└─ ".padStart(depth * 2 + 1, " ")}
    </span>
  );
}

interface SpanDetailsPanelProps {
  trace: TraceContext;
  selectedSpan: TraceSpan | null;
  activeTab: DetailsTab;
  onSelectTab: (tab: DetailsTab) => void;
}

function SpanDetailsPanel({
  trace,
  selectedSpan,
  activeTab,
  onSelectTab,
}: SpanDetailsPanelProps) {
  if (!selectedSpan) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-muted-foreground/70 text-xs">
        Select a span to inspect its details.
      </div>
    );
  }

  return (
    <>
      <SpanDetailsHeader span={selectedSpan} />
      <SpanIdentityFields span={selectedSpan} />
      <SpanDetailsTabs active={activeTab} onSelect={onSelectTab} span={selectedSpan} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {activeTab === "fields" ? (
          <SpanFieldsTab span={selectedSpan} trace={trace} />
        ) : activeTab === "events" ? (
          <SpanEventsTab span={selectedSpan} trace={trace} />
        ) : (
          <SpanLinksTab />
        )}
      </div>
    </>
  );
}

function SpanDetailsHeader({ span }: { span: TraceSpan }) {
  // Copy the span id on click so users can paste it into external tools
  // (grafana, datadog etc.) without re-typing — matches the copy button
  // shown in the reference screenshot.
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(span.id);
  }, [span.id]);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-3">
      <span className="font-mono text-sm text-muted-foreground/80">Span</span>
      <span className="text-muted-foreground/50">—</span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-foreground text-sm"
        title={span.id}
      >
        {span.id}
      </span>
      <button
        aria-label="Copy span id"
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        onClick={handleCopy}
        type="button"
      >
        <CopyIcon className="size-3.5" />
      </button>
    </div>
  );
}

function SpanIdentityFields({ span }: { span: TraceSpan }) {
  return (
    <dl className="flex shrink-0 flex-col gap-3 border-b border-border/60 px-4 py-4 font-mono text-xs">
      <div>
        <dt className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Name</dt>
        <dd className="mt-1 text-foreground">{span.name}</dd>
      </div>
      <div>
        <dt className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
          Service name
        </dt>
        <dd className="mt-1 text-foreground">{span.serviceName}</dd>
      </div>
    </dl>
  );
}

interface SpanDetailsTabsProps {
  active: DetailsTab;
  onSelect: (tab: DetailsTab) => void;
  span: TraceSpan;
}

function SpanDetailsTabs({ active, onSelect, span }: SpanDetailsTabsProps) {
  return (
    <TopTabsList aria-label="Span detail tabs" className="gap-1 px-2">
      <TabHeader active={active === "fields"} label="Fields" onClick={() => onSelect("fields")} />
      <TabHeader active={active === "events"} badge={span.events.length} label="Events" onClick={() => onSelect("events")} />
      <TabHeader active={active === "links"} badge={0} label="Links" onClick={() => onSelect("links")} />
    </TopTabsList>
  );
}

interface TabHeaderProps {
  active: boolean;
  label: string;
  badge?: number;
  onClick: () => void;
}

function TabHeader({ active, label, badge, onClick }: TabHeaderProps) {
  return (
    <TopTabsItem active={active}>
      <TopTabsTrigger active={active} badge={badge} onClick={onClick} size="compact">
        {label}
      </TopTabsTrigger>
    </TopTabsItem>
  );
}

interface SpanTabContentProps {
  span: TraceSpan;
  trace: TraceContext;
}

function SpanFieldsTab({ span, trace }: SpanTabContentProps) {
  const rows: ReadonlyArray<{ label: string; value: string }> = [
    { label: "span.id", value: span.id },
    { label: "trace.id", value: trace.traceId },
    { label: "parent.span.id", value: span.parentSpanId ?? "—" },
    { label: "status", value: span.status },
    { label: "start.offset", value: formatDuration(span.startOffsetUs) },
    { label: "duration", value: formatDuration(span.durationUs) },
  ];

  return (
    <dl className="flex flex-col font-mono text-xs">
      {rows.map((row) => (
        <div
          className="grid gap-3 border-b border-border/40 px-4 py-2.5 last:border-b-0"
          key={row.label}
          style={{ gridTemplateColumns: "40% 1fr" }}
        >
          <dt className="truncate text-muted-foreground/70" title={row.label}>
            {row.label}
          </dt>
          <dd className="break-all text-foreground/90">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SpanEventsTab({ span }: SpanTabContentProps) {
  if (span.events.length > 0) {
    return (
      <div className="flex min-h-0 flex-col overflow-auto font-mono text-xs">
        {span.events.map((event) => (
          <div className="border-b border-border/40 px-4 py-3 last:border-b-0" key={event.id}>
            <div className="flex items-center gap-2">
              <span className="truncate text-foreground">{event.name}</span>
              <time className="shrink-0 text-[11px] text-muted-foreground/70" dateTime={event.timestamp.toISOString()}>
                {event.timestamp.toISOString()}
              </time>
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-all text-muted-foreground/80">
              {JSON.stringify(event.attributes, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-4 font-mono text-muted-foreground/70 text-xs">
      <p>No events recorded for this span.</p>
      {span.status === "error" ? (
        <p className="text-muted-foreground/50">
          Span finished with an error — once exception events are sent by the
          collector they will appear here.
        </p>
      ) : null}
    </div>
  );
}

function SpanLinksTab() {
  return (
    <div className="flex flex-col gap-2 px-4 py-4 font-mono text-muted-foreground/70 text-xs">
      <p>No links on this span.</p>
    </div>
  );
}

function computeDepths(spans: ReadonlyArray<TraceSpan>): ReadonlyMap<string, number> {
  const spansById = new Map(spans.map((span) => [span.id, span]));
  const depths = new Map<string, number>();
  const resolving = new Set<string>();

  const resolveDepth = (span: TraceSpan): number => {
    const cached = depths.get(span.id);
    if (cached !== undefined) {
      return cached;
    }
    if (span.parentSpanId === null) {
      depths.set(span.id, 0);
      return 0;
    }
    if (resolving.has(span.id)) {
      return 0;
    }

    const parent = spansById.get(span.parentSpanId);
    if (!parent) {
      depths.set(span.id, 1);
      return 1;
    }

    resolving.add(span.id);
    const depth = resolveDepth(parent) + 1;
    resolving.delete(span.id);
    depths.set(span.id, depth);
    return depth;
  };

  for (const span of spans) {
    resolveDepth(span);
  }
  return depths;
}

interface RulerTick {
  readonly offsetUs: number;
  readonly label: string;
  readonly leftPercent: number;
}

function buildRulerTicks(totalDurationUs: number): ReadonlyArray<RulerTick> {
  if (totalDurationUs <= 0 || RULER_TICK_COUNT < 2) {
    return [{ offsetUs: 0, label: formatDuration(0), leftPercent: 0 }];
  }

  const intervals = RULER_TICK_COUNT - 1;
  const step = totalDurationUs / intervals;
  const ticks: Array<RulerTick> = [];
  for (let i = 0; i < RULER_TICK_COUNT; i++) {
    const offsetUs = step * i;
    ticks.push({
      offsetUs,
      label: formatDuration(offsetUs),
      leftPercent: (offsetUs / totalDurationUs) * 100,
    });
  }
  return ticks;
}

function formatTraceTimestamp(date: Date): string {
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${dateFormatter.format(date)} ${timeFormatter.format(date)},${ms}`;
}

/**
 * Format a microsecond duration using the unit that keeps the number
 * readable (≤ 3 significant digits). Matches the density of the reference
 * Axiom screenshot without the trailing-zero noise.
 */
function formatDuration(durationUs: number): string {
  if (durationUs < 1_000) return `${Math.round(durationUs)}µs`;
  if (durationUs < 10_000) return `${(durationUs / 1_000).toFixed(2)}ms`;
  if (durationUs < 1_000_000) return `${(durationUs / 1_000).toFixed(1)}ms`;
  return `${(durationUs / 1_000_000).toFixed(2)}s`;
}
