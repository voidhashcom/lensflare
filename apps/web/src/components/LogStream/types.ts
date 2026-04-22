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
