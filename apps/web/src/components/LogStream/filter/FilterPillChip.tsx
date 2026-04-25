import { XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Select,
  SelectButton,
  SelectItem,
  SelectPopup,
} from "~/components/ui/select";
import { IconButtonTooltip } from "~/components/ui/tooltip";
import type { TelemetryLogField } from "~/data/logApi";
import { cn } from "~/lib/utils";

import { FieldTypeBadge } from "./FieldTypeBadge";
import {
  OPERATOR_SYNTAX,
  operatorSyntaxesForKind,
  type OperatorSyntax,
  type ParsedPill,
} from "./syntax";

interface FilterPillChipProps {
  pill: ParsedPill;
  /** Resolved field from the catalog; `null` when the field path is unknown. */
  field: TelemetryLogField | null;
  /** Fires when the operator dropdown is changed. */
  onChangeOperator: (syntax: OperatorSyntax) => void;
  /** Fires when the × is clicked. */
  onRemove: () => void;
}

/**
 * Compact `field op value` chip rendered inline before the input. The chip
 * shows:
 *   - Field label + a small type badge (`STR` / `123` / `ENUM`).
 *   - Operator as a `<Select>` so the user can switch between the shorthand
 *     operators valid for the field's kind without retyping the pill.
 *   - The raw value as typed (quotes stripped).
 *   - A trailing × to remove the pill.
 *
 * The chip is intentionally dumb: all state lives in the parent's `source`
 * string, and mutations are emitted as typed events. This keeps the chip
 * renderable from any tokeniser output without a draft-copy layer.
 */
export function FilterPillChip({
  pill,
  field,
  onChangeOperator,
  onRemove,
}: FilterPillChipProps) {
  const fieldLabel = field?.label ?? pill.fieldPath.join(".");
  const kind = field?.kind ?? "string";
  const operatorOptions = operatorSyntaxesForKind(kind);

  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-input/80 bg-accent/30 pe-0.5 ps-1.5 text-xs",
        field === null && "border-destructive/40 bg-destructive/10",
      )}
      data-slot="filter-pill"
      // Keep focus in the parent input when the pill chrome is clicked so the
      // dropdown doesn't steal focus. Individual interactive children still
      // handle their own events (the Select opens on click normally).
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
        }
      }}
    >
      <FieldTypeBadge className="-ms-0.5 min-w-6 px-1 py-0" kind={kind} />
      <span className="max-w-[8rem] truncate font-medium text-foreground">
        {fieldLabel}
      </span>
      <Select
        onValueChange={(next: unknown) => {
          const syntax = OPERATOR_SYNTAX.find((entry) => entry.token === next);
          if (syntax) onChangeOperator(syntax);
        }}
        value={pill.operatorToken}
      >
        <SelectButton
          className="h-6 min-h-6 min-w-0 rounded-sm border-transparent bg-transparent px-1 py-0 font-mono text-xs text-muted-foreground hover:bg-accent/50 sm:min-h-6"
          size="xs"
        >
          {pill.operatorToken}
        </SelectButton>
        <SelectPopup>
          {operatorOptions.map((entry) => (
            <SelectItem key={entry.token} value={entry.token}>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-foreground">
                  {entry.token}
                </span>
                <span className="text-muted-foreground">{entry.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <span className="max-w-[12rem] truncate text-foreground/90">
        {pill.valueWasQuoted ? `"${pill.rawValue}"` : pill.rawValue}
      </span>
      <IconButtonTooltip label={`Remove filter ${fieldLabel}`}>
        <Button
          aria-label={`Remove filter ${fieldLabel}`}
          className="ml-0.5 shrink-0"
          onClick={onRemove}
          onMouseDown={(event) => event.preventDefault()}
          size="icon"
          variant="ghost"
        >
          <XIcon className="size-3.5" />
        </Button>
      </IconButtonTooltip>
    </span>
  );
}
