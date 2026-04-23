/**
 * Shared types for the log stream UI. Kept lightweight and UI-only so the
 * view can be driven by mock data while the ingest/query backend is still
 * being wired up.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type SourceIconKind = "js" | "ts" | "go" | "py" | "rb" | "rs" | "java" | "default";

export interface LogEntry {
  id: string;
  timestamp: Date;
  sourceName: string;
  sourceIcon: SourceIconKind;
  level: LogLevel;
  message: string;
  /**
   * W3C trace id this log belongs to, if any. Absent when the log was emitted
   * outside of a trace context. Surfaces the trace-overview panel in the
   * log details view.
   */
  traceId?: string;
  /** W3C span id this log was emitted from, if any. */
  spanId?: string;
}

/**
 * A single span within a distributed trace. Times are expressed in
 * microseconds relative to the trace's root start — this keeps the shape
 * independent of the UI's timezone rendering and lets us place spans on a
 * proportional timeline without floating-point drift.
 */
export interface TraceSpan {
  readonly id: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly serviceName: string;
  /** Offset from the trace start, in microseconds. */
  readonly startOffsetUs: number;
  /** Duration in microseconds. */
  readonly durationUs: number;
  /** Span outcome — controls the colour of the timeline bar. */
  readonly status: "ok" | "error" | "unset";
}

/**
 * Sparse trace context attached to a log entry. `spans` is ordered by
 * `startOffsetUs` ascending so the trace overview can render a waterfall
 * without having to re-sort on every mount.
 */
export interface TraceContext {
  readonly traceId: string;
  /** Wall-clock start time of the trace's root span. */
  readonly startTime: Date;
  /** Total trace duration (root span's duration) in microseconds. */
  readonly totalDurationUs: number;
  readonly spans: ReadonlyArray<TraceSpan>;
  /** Span the log was emitted from. Must be present in `spans`. */
  readonly currentSpanId: string;
}

export interface HistogramBucket {
  /** Start of the bucket window. */
  timestamp: Date;
  /** Total log count in the bucket. */
  count: number;
  /** Subset of {@link count} that represents errors (rendered as the
   *  accent strip at the bottom of each bar). */
  errorCount: number;
}

export type DateRangePreset =
  | "Last 15 minutes"
  | "Last 1 hour"
  | "Last 24 hours"
  | "Last 7 days"
  | "Last 30 days"
  | "Last 90 days";

export const DATE_RANGE_PRESETS: Array<DateRangePreset> = [
  "Last 15 minutes",
  "Last 1 hour",
  "Last 24 hours",
  "Last 7 days",
  "Last 30 days",
  "Last 90 days",
];
