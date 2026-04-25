import type { TelemetryLogField } from "~/data/logApi";
import { cn } from "~/lib/utils";

import { isValuelessOperator, LIST_OPERATORS, resolvePillField, type ParsedPill } from "./syntax";

interface FilterPillsDisplayProps {
  pills: ReadonlyArray<ParsedPill>;
  /** Any free-typed text that didn't form a complete pill. Shown dimmed at the
   *  end so the user can still see what they originally typed. */
  trailingText?: string;
  fields: ReadonlyArray<TelemetryLogField>;
  className?: string;
}

/**
 * Read-only, Better Stack-style rendering of the applied filter pills. Mirrors
 * the Tiptap decoration classes in `FilterQueryInput` (`.filter-query-pill`
 * and its `--field/--operator/--value/--start/--end` modifiers) so the trigger
 * button and the in-dialog editor share a consistent look. This is purely a
 * display component — no events, no state; parents that want to edit a pill
 * open the command dialog.
 */
export function FilterPillsDisplay({
  pills,
  trailingText,
  fields,
  className,
}: FilterPillsDisplayProps) {
  const trimmedTrailing = trailingText?.trim() ?? "";

  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 overflow-hidden", className)}>
      {pills.map((pill, index) => (
        <FilterPillView fields={fields} key={`${index}:${pill.start}`} pill={pill} />
      ))}
      {trimmedTrailing.length > 0 ? (
        <span className="min-w-0 shrink truncate text-muted-foreground italic">
          {trimmedTrailing}
        </span>
      ) : null}
    </span>
  );
}

interface FilterPillViewProps {
  pill: ParsedPill;
  fields: ReadonlyArray<TelemetryLogField>;
}

function FilterPillView({ pill, fields }: FilterPillViewProps) {
  const resolved = resolvePillField(pill, fields);
  const fieldText = pill.fieldPath.join(".");
  const hasValue = !isValuelessOperator(pill.operator);
  const rawValueText = pill.valueWasQuoted ? `"${pill.rawValue}"` : pill.rawValue;
  const valueText = LIST_OPERATORS.includes(pill.operator) ? `[${rawValueText}]` : rawValueText;
  const unknownClass = resolved === null ? "filter-query-pill--unknown" : "";

  return (
    <span className="inline-flex shrink-0 items-center">
      <span
        className={cn(
          "filter-query-pill filter-query-pill--field filter-query-pill--start",
          unknownClass,
        )}
      >
        {fieldText}
      </span>
      <span
        className={cn(
          "filter-query-pill filter-query-pill--operator",
          "px-1",
          !hasValue && "filter-query-pill--end",
          unknownClass,
        )}
      >
        {pill.operatorToken}
      </span>
      {hasValue ? (
        <span
          className={cn(
            "filter-query-pill filter-query-pill--value filter-query-pill--end",
            unknownClass,
          )}
        >
          {valueText}
        </span>
      ) : null}
    </span>
  );
}
