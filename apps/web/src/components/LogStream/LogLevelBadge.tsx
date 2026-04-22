import { cn } from "~/lib/utils";

import type { LogLevel } from "./types";

/**
 * Colour + label tuple driving the dot-prefixed level badges used in the
 * Level column and inline message prefix. Palette is sourced from Tailwind's
 * default colour ramp so it Just Works without having to extend the
 * project's design tokens.
 */
const LEVEL_STYLE: Record<
  LogLevel,
  { label: string; dot: string; text: string }
> = {
  trace: {
    label: "TRACE",
    dot: "bg-zinc-400",
    text: "text-zinc-300",
  },
  debug: {
    label: "DEBUG",
    dot: "bg-sky-400",
    text: "text-sky-300",
  },
  info: {
    label: "INFO",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
  },
  warn: {
    label: "WARN",
    dot: "bg-amber-400",
    text: "text-amber-300",
  },
  error: {
    label: "ERROR",
    dot: "bg-rose-500",
    text: "text-rose-300",
  },
  fatal: {
    label: "FATAL",
    dot: "bg-fuchsia-500",
    text: "text-fuchsia-300",
  },
};

interface LogLevelBadgeProps {
  level: LogLevel;
  className?: string;
}

export function LogLevelBadge({ level, className }: LogLevelBadgeProps) {
  const style = LEVEL_STYLE[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide",
        style.text,
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}

/** Expose the palette for other components that want to colour-match. */
export function getLogLevelText(level: LogLevel): string {
  return LEVEL_STYLE[level].text;
}

export function getLogLevelLabel(level: LogLevel): string {
  return LEVEL_STYLE[level].label;
}
