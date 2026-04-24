import { cn } from "~/lib/utils";

import type { SourceIconKind } from "./types";

/**
 * Per-language colour palette for the tiny language chip rendered on the
 * left side of a source badge. The palette intentionally mirrors the
 * "official" colour each community associates with the language so users
 * can scan a mixed dataset at a glance.
 */
const ICON_STYLE: Record<SourceIconKind, { label: string; swatch: string }> = {
  js: {
    label: "Js",
    swatch: "bg-yellow-100 text-yellow-700 dark:bg-yellow-400/20 dark:text-yellow-200",
  },
  ts: { label: "Ts", swatch: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200" },
  go: { label: "Go", swatch: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-200" },
  py: { label: "Py", swatch: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200" },
  rb: { label: "Rb", swatch: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200" },
  rs: {
    label: "Rs",
    swatch: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-200",
  },
  java: { label: "Jv", swatch: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200" },
  default: { label: "•", swatch: "bg-foreground/8 text-muted-foreground dark:bg-white/10" },
};

interface SourceBadgeProps {
  name: string;
  icon?: SourceIconKind;
  /** When true, the badge renders without a surrounding pill — used in the
   *  header where the dataset selector is the pill itself. */
  flat?: boolean;
  className?: string;
}

export function SourceBadge({ name, icon = "default", flat = false, className }: SourceBadgeProps) {
  const style = ICON_STYLE[icon];
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-2",
        flat ? "" : "rounded-md bg-foreground/4 py-0.5 pl-1 pr-2 dark:bg-white/5",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-sm font-mono text-[9px] font-semibold leading-none",
          style.swatch,
        )}
      >
        {style.label}
      </span>
      <span className="min-w-0 truncate text-xs text-foreground/80">{name}</span>
    </span>
  );
}
