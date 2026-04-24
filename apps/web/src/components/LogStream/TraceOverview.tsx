import { useMemo } from "react";

import { cn } from "~/lib/utils";

import type { TraceContext, TraceSpan } from "./types";

/**
 * Number of spans to show above and below the log's own span. The rest are
 * hidden behind "N earlier/later spans" truncation markers — users who need
 * the full waterfall will open the dedicated trace detail page (not yet
 * built at the time of writing).
 *
 * Picking 2 keeps the component compact in the inline details pane while
 * still giving enough breadcrumbs to orient the user within the trace.
 */
const CONTEXT_WINDOW = 2;

interface TraceOverviewProps {
  trace: TraceContext;
  className?: string;
  /**
   * Fired when the user clicks the hover "Explore trace" overlay. Consumers
   * usually open a full-screen trace explorer tab. Omit to leave the button
   * inert — e.g. in Storybook or tests.
   */
  onExplore?: () => void;
}

/**
 * Compact, Axiom-inspired trace-context strip. Shows a windowed slice of the
 * waterfall around the log's own span so the user can see where within the
 * request lifecycle the event fired. Anything outside the window collapses
 * into "N earlier/later spans" markers.
 *
 * Unlike Axiom's full trace viewer this component is designed to fit above
 * the details tabs without dominating the panel — rows reserve a fixed 24px
 * height, the ruler is intentionally unlabelled, and we don't render a tree
 * connector. Clicking the hover overlay escalates the user to the full
 * `TraceExplorer` view via the `onExplore` callback.
 */
export function TraceOverview({ trace, className, onExplore }: TraceOverviewProps) {
  const { visibleSpans, hiddenBefore, hiddenAfter, depthByParent } = useMemo(
    () => buildWindow(trace),
    [trace],
  );

  return (
    <div
      aria-label="Trace overview"
      className={cn(
        "group relative h-[216px] shrink-0 overflow-hidden border-b border-border/60 bg-muted/10",
        className,
      )}
    >
      <TraceHeader trace={trace} />
      <ol className="flex flex-col py-1">
        {hiddenBefore > 0 ? <TruncationRow direction="before" count={hiddenBefore} /> : null}
        {visibleSpans.map((span) => (
          <SpanRow
            depth={depthByParent.get(span.id) ?? 0}
            isCurrent={span.id === trace.currentSpanId}
            key={span.id}
            span={span}
            totalDurationUs={trace.totalDurationUs}
          />
        ))}
        {hiddenAfter > 0 ? <TruncationRow direction="after" count={hiddenAfter} /> : null}
      </ol>
      <button
        aria-label="Explore trace"
        className="absolute inset-0 flex cursor-pointer items-center justify-center bg-background/35 opacity-0 backdrop-blur-xs duration-100 hover:transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 disabled:cursor-default"
        disabled={onExplore === undefined}
        onClick={onExplore}
        type="button"
      >
        <span className="font-medium text-sm text-foreground">Explore trace</span>
      </button>
    </div>
  );
}

interface TraceHeaderProps {
  trace: TraceContext;
}

function TraceHeader({ trace }: TraceHeaderProps) {
  return (
    <div className="flex h-8 items-center justify-between gap-3 px-4 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground/50">Trace</span>
        <span className="min-w-0 truncate text-foreground/70" title={trace.traceId}>
          {shortenTraceId(trace.traceId)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3 normal-case tracking-normal">
        <span className="text-muted-foreground/50">
          {trace.spans.length} span{trace.spans.length === 1 ? "" : "s"}
        </span>
        <span className="text-foreground/70">{formatDuration(trace.totalDurationUs)}</span>
      </div>
    </div>
  );
}

interface SpanRowProps {
  span: TraceSpan;
  depth: number;
  isCurrent: boolean;
  totalDurationUs: number;
}

function SpanRow({ span, depth, isCurrent, totalDurationUs }: SpanRowProps) {
  // Proportional bar position. We clamp to a small minimum width so very
  // short spans still leave a visible mark on the timeline. When the trace
  // duration is zero we render an empty strip rather than divide by 0.
  const scale = totalDurationUs === 0 ? 0 : 100 / totalDurationUs;
  const startPercent = span.startOffsetUs * scale;
  const widthPercent = Math.max(span.durationUs * scale, 0.8);
  const remainingPercent = Math.max(100 - startPercent - widthPercent, 0);

  const barColour =
    span.status === "error" ? "bg-rose-500/70" : "bg-sky-500/70 dark:bg-sky-400/70";

  return (
    <li
      className={cn(
        "grid h-6 grid-cols-[minmax(0,1fr)_minmax(120px,1.2fr)_auto] items-center gap-3 px-4",
        isCurrent && "bg-foreground/[0.04]",
      )}
    >
      <div className="flex min-w-0 items-center">
        {/* Depth indent — rendered as a fixed-width spacer so alignment is
            stable regardless of monospace vs. sans. */}
        <span aria-hidden className="shrink-0" style={{ width: depth * 10 }} />
        <span
          aria-hidden
          className={cn(
            "mr-2 inline-block size-1.5 shrink-0 rounded-full",
            span.status === "error" ? "bg-rose-500 dark:bg-rose-400" : "bg-sky-500 dark:bg-sky-400",
            isCurrent && "ring-2 ring-foreground/40",
          )}
        />
        <span
          className={cn(
            "min-w-0 truncate font-mono text-[11px]",
            isCurrent ? "text-foreground" : "text-foreground/80",
          )}
          title={span.name}
        >
          {span.name}
        </span>
        <span
          className="ml-2 min-w-0 truncate text-[10px] text-muted-foreground/60"
          title={span.serviceName}
        >
          {span.serviceName}
        </span>
      </div>

      {/* Timeline bar. We render a three-cell flex strip (lead, bar, trail)
          so the bar's left/right spacing is proportional to the span's
          position inside the trace. */}
      <div
        aria-hidden
        className="flex h-1.5 w-full items-stretch overflow-hidden rounded-sm bg-foreground/[0.04]"
      >
        <span className="block" style={{ width: `${startPercent}%` }} />
        <span className={cn("block rounded-sm", barColour)} style={{ width: `${widthPercent}%` }} />
        <span className="block" style={{ width: `${remainingPercent}%` }} />
      </div>

      <span
        className={cn(
          "shrink-0 text-right font-mono text-[10px] tabular-nums",
          isCurrent ? "text-foreground/90" : "text-muted-foreground/70",
        )}
      >
        {formatDuration(span.durationUs)}
      </span>
    </li>
  );
}

interface TruncationRowProps {
  count: number;
  direction: "before" | "after";
}

function TruncationRow({ count, direction }: TruncationRowProps) {
  const label = `${count} ${direction === "before" ? "earlier" : "later"} span${count === 1 ? "" : "s"} hidden`;
  return (
    <li className="flex h-6 items-center px-4 font-mono text-[10px] text-muted-foreground/50">
      <span className="mr-2">{direction === "before" ? "↑" : "↓"}</span>
      {label}
    </li>
  );
}

interface WindowResult {
  readonly visibleSpans: ReadonlyArray<TraceSpan>;
  readonly hiddenBefore: number;
  readonly hiddenAfter: number;
  /**
   * Depth lookup keyed by span id. Calculated once per trace so the row
   * renderer doesn't walk parent chains on every paint.
   */
  readonly depthByParent: ReadonlyMap<string, number>;
}

/**
 * Compute which spans we render and how many we hide on each side. Depths
 * are computed from the full span list (not just the visible window) so
 * indentation stays stable when the current span changes.
 */
function buildWindow(trace: TraceContext): WindowResult {
  const depthByParent = computeDepths(trace.spans);

  const currentIndex = trace.spans.findIndex((span) => span.id === trace.currentSpanId);
  // Defensive fallback: if the backend ever ships a currentSpanId that isn't
  // in the span list we still render something rather than throwing.
  const anchorIndex = currentIndex >= 0 ? currentIndex : 0;

  const start = Math.max(anchorIndex - CONTEXT_WINDOW, 0);
  const end = Math.min(anchorIndex + CONTEXT_WINDOW + 1, trace.spans.length);

  return {
    visibleSpans: trace.spans.slice(start, end),
    hiddenBefore: start,
    hiddenAfter: Math.max(trace.spans.length - end, 0),
    depthByParent,
  };
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

function shortenTraceId(traceId: string): string {
  if (traceId.length <= 14) return traceId;
  return `${traceId.slice(0, 8)}…${traceId.slice(-4)}`;
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
