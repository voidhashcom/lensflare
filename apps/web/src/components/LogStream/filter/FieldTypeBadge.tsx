import { cn } from "~/lib/utils";
import type { TelemetryLogField } from "~/data/logApi";

interface FieldTypeBadgeProps {
  kind: TelemetryLogField["kind"];
  className?: string;
}

const BADGE_LABELS: Readonly<Record<TelemetryLogField["kind"], string>> = {
  string: "STR",
  number: "123",
  enum: "ENUM",
};

/**
 * Compact glyph identifying a field's value kind — used in the suggestions
 * list and on pill chips so the user can tell at a glance whether a field is
 * numeric, free-text, or enumerated. Rendered as a small uppercase pill that
 * sits alongside the field label.
 */
export function FieldTypeBadge({ kind, className }: FieldTypeBadgeProps) {
  return (
    <span
      aria-label={`${kind} field`}
      className={cn(
        "inline-flex min-w-8 justify-center rounded-sm bg-muted/70 px-1 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {BADGE_LABELS[kind]}
    </span>
  );
}
