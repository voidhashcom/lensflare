import { useMemo } from "react";

import { cn } from "~/lib/utils";

import type { HistogramBucket } from "./types";

interface LogVolumeHistogramProps {
  buckets: ReadonlyArray<HistogramBucket>;
  className?: string;
}

/**
 * Lightweight histogram used above the log table. Renders as a flexbox row
 * of bars (instead of SVG) so it scales fluidly with the container width
 * and stays crisp on every DPI. The bottom strip of each bar represents
 * the error subset.
 */
export function LogVolumeHistogram({ buckets, className }: LogVolumeHistogramProps) {
  const { yMax, yLabels, xLabels } = useMemo(() => derive(buckets), [buckets]);

  return (
    <div className={cn("relative flex gap-3 border-b border-border/70 px-4 pt-3 pb-2", className)}>
      <YAxis labels={yLabels} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex h-32 items-end gap-px">
          <GridLines count={yLabels.length} />
          {buckets.map((bucket, index) => (
            <HistogramBar bucket={bucket} key={index} yMax={yMax} />
          ))}
        </div>
        <XAxis labels={xLabels} />
      </div>
    </div>
  );
}

function HistogramBar({ bucket, yMax }: { bucket: HistogramBucket; yMax: number }) {
  const heightPct = clampPct((bucket.count / yMax) * 100);
  // Keep the error strip visible even when the ratio is tiny — ensures the
  // red accent line at the bottom of each bar reads at a glance.
  const errorPct = bucket.errorCount > 0
    ? Math.max(2, clampPct((bucket.errorCount / yMax) * 100))
    : 0;

  return (
    <div className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
      <div
        className="w-full rounded-t-[1px] bg-violet-500/70 transition-colors group-hover:bg-violet-400"
        style={{ height: `${heightPct}%` }}
      />
      {errorPct > 0 ? (
        <div
          className="absolute inset-x-0 bottom-0 bg-rose-500/80"
          style={{ height: `${errorPct}%` }}
        />
      ) : null}
    </div>
  );
}

function YAxis({ labels }: { labels: ReadonlyArray<string> }) {
  return (
    <div className="flex h-32 w-10 shrink-0 flex-col justify-between pt-px pb-2 text-right font-mono text-[10px] text-muted-foreground/60 tabular-nums">
      {[...labels].reverse().map((label) => (
        <div key={label}>{label}</div>
      ))}
    </div>
  );
}

function XAxis({ labels }: { labels: ReadonlyArray<{ label: string; position: number }> }) {
  return (
    <div className="relative mt-1 h-4">
      {labels.map(({ label, position }) => (
        <span
          className="absolute font-mono text-[10px] text-muted-foreground/60 tabular-nums"
          key={label}
          style={{ left: `${position}%` }}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function GridLines({ count }: { count: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
      {Array.from({ length: count }).map((_, i) => (
        <div className="border-t border-border/30" key={i} />
      ))}
    </div>
  );
}

function clampPct(value: number): number {
  if (Number.isNaN(value) || value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function derive(buckets: ReadonlyArray<HistogramBucket>) {
  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);
  const step = niceStep(peak / 6);
  const yMax = Math.max(step, Math.ceil(peak / step) * step);

  const yLabels: Array<string> = [];
  for (let v = 0; v <= yMax; v += step) {
    yLabels.push(formatCount(v));
  }

  const xLabels = pickXAxisTicks(buckets);

  return { yMax, yLabels, xLabels };
}

/** Chooses a human-readable step (e.g. 50K for 300K max). */
function niceStep(rawStep: number): number {
  if (rawStep <= 0) {
    return 10;
  }
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const normalised = rawStep / magnitude;
  let step: number;
  if (normalised <= 1) step = 1;
  else if (normalised <= 2) step = 2;
  else if (normalised <= 5) step = 5;
  else step = 10;
  return step * magnitude;
}

function formatCount(value: number): string {
  if (value === 0) return "0";
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return value.toString();
}

/**
 * Pick a handful of evenly-spaced buckets to use as x-axis anchors so the
 * axis doesn't get cluttered on small screens. We return percentage offsets
 * from the left edge so the render code can position them without knowing
 * the parent width.
 */
function pickXAxisTicks(
  buckets: ReadonlyArray<HistogramBucket>,
): Array<{ label: string; position: number }> {
  if (buckets.length === 0) {
    return [];
  }
  const desiredTicks = 8;
  const step = Math.max(1, Math.floor(buckets.length / desiredTicks));
  const ticks: Array<{ label: string; position: number }> = [];
  for (let i = 0; i < buckets.length; i += step) {
    const bucket = buckets[i];
    if (!bucket) continue;
    ticks.push({
      label: formatDateLabel(bucket.timestamp),
      position: (i / (buckets.length - 1)) * 100,
    });
  }
  return ticks;
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
