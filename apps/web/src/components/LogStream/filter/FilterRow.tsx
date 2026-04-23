import type { FilterOperator } from "@lensflare/contracts";
import { TrashIcon } from "lucide-react";
import { useMemo } from "react";

import { Button } from "~/components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "~/components/ui/combobox";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectButton,
  SelectItem,
  SelectPopup,
} from "~/components/ui/select";
import type { TelemetryLogField } from "~/data/logApi";

import { limitAttributeFieldSuggestions } from "./fieldSuggestionLimits";
import { useFieldValues } from "./hooks/useFieldValues";
import {
  OPERATOR_LABELS,
  UNARY_OPERATORS,
  operatorsForField,
  type FilterRowDraft,
} from "./filterTypes";

interface FilterRowProps {
  projectId: string;
  datasetId: string;
  draft: FilterRowDraft;
  fields: ReadonlyArray<TelemetryLogField>;
  onChange: (next: FilterRowDraft) => void;
  onRemove: () => void;
}

function fieldLabel(field: TelemetryLogField): string {
  return field.label;
}

function fieldKey(field: TelemetryLogField): string {
  return field.path.join(".");
}

/**
 * A single editable `{ field, operator, value }` row inside the query builder
 * popover. The three inputs are coupled:
 *   - Picking a field resets the operator to the first valid choice for its
 *     kind (so e.g. switching from `level` → `status_code` drops `contains`).
 *   - Switching to a unary operator (`exists` / `notExists`) clears the value
 *     because the AST won't carry one anyway.
 *   - When the backend has known values for the field (enum, or harvested
 *     `values` attached to the catalog entry), the value input becomes a
 *     combobox that autocompletes against those values while still accepting
 *     free text.
 */
export function FilterRow({
  projectId,
  datasetId,
  draft,
  fields,
  onChange,
  onRemove,
}: FilterRowProps) {
  const field = draft.field;
  const operators = field === null ? [] : operatorsForField(field.kind);
  const isUnary = UNARY_OPERATORS.includes(draft.operator);
  const fieldOptions = useMemo(() => {
    const limited = limitAttributeFieldSuggestions(fields);
    if (field === null) return limited;

    const selectedKey = fieldKey(field);
    if (limited.some((option) => fieldKey(option) === selectedKey)) {
      return limited;
    }

    return [field, ...limited];
  }, [field, fields]);

  // Only fetch distinct values from the server for enum-kinded fields or when
  // the catalog entry didn't include values pre-baked. Fetching for every
  // field would be wasteful since a freeform `message` column has no useful
  // value catalog.
  const shouldFetchValues =
    field !== null && field.kind === "enum" && (!field.values || field.values.length === 0);
  const valuesState = useFieldValues(
    projectId,
    datasetId,
    shouldFetchValues ? field.path : null,
  );
  const knownValues =
    field?.values && field.values.length > 0 ? field.values : valuesState.values;

  const handleFieldChange = (next: TelemetryLogField | null) => {
    if (next === null) {
      onChange({ ...draft, field: null });
      return;
    }
    const allowedOps = operatorsForField(next.kind);
    const nextOp = allowedOps.includes(draft.operator)
      ? draft.operator
      : (allowedOps[0] ?? "eq");
    onChange({ ...draft, field: next, operator: nextOp });
  };

  const handleOperatorChange = (next: FilterOperator) => {
    const nextUnary = UNARY_OPERATORS.includes(next);
    onChange({
      ...draft,
      operator: next,
      value: nextUnary ? "" : draft.value,
    });
  };

  const handleValueChange = (next: string) => {
    onChange({ ...draft, value: next });
  };

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-[1.5]">
        <Combobox
          items={fieldOptions as Array<TelemetryLogField>}
          itemToStringLabel={fieldLabel}
          itemToStringValue={fieldKey}
          onValueChange={(next) => handleFieldChange(next)}
          value={field}
        >
          <ComboboxInput placeholder="Field" size="sm" />
          <ComboboxPopup>
            <ComboboxList>
              {(item: TelemetryLogField) => (
                <ComboboxItem key={fieldKey(item)} value={item}>
                  <div className="flex flex-col">
                    <span className="text-foreground">{item.label}</span>
                    {item.path.length > 1 ? (
                      <span className="text-muted-foreground text-xs">
                        {item.path.join(".")}
                      </span>
                    ) : null}
                  </div>
                </ComboboxItem>
              )}
            </ComboboxList>
            <ComboboxEmpty>No fields.</ComboboxEmpty>
          </ComboboxPopup>
        </Combobox>
      </div>

      <div className="w-36 shrink-0">
        <Select
          disabled={field === null}
          onValueChange={(next: unknown) => handleOperatorChange(next as FilterOperator)}
          value={draft.operator}
        >
          <SelectButton size="sm">{OPERATOR_LABELS[draft.operator]}</SelectButton>
          <SelectPopup>
            {operators.map((op) => (
              <SelectItem key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>

      <div className="min-w-0 flex-[1.5]">
        {isUnary ? (
          <Input disabled placeholder="—" size="sm" value="" />
        ) : knownValues.length > 0 ? (
          <Combobox
            inputValue={draft.value}
            items={knownValues as Array<string>}
            onInputValueChange={(next) => handleValueChange(next)}
            onValueChange={(next) => {
              if (typeof next === "string") {
                handleValueChange(next);
              }
            }}
          >
            <ComboboxInput placeholder="Value" size="sm" />
            <ComboboxPopup>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
              <ComboboxEmpty>No suggestions.</ComboboxEmpty>
            </ComboboxPopup>
          </Combobox>
        ) : (
          <Input
            disabled={field === null}
            onChange={(event) => {
              handleValueChange(event.currentTarget.value);
            }}
            placeholder="Value"
            size="sm"
            value={draft.value}
          />
        )}
      </div>

      <Button
        aria-label="Remove filter"
        onClick={onRemove}
        size="icon-sm"
        variant="ghost"
      >
        <TrashIcon />
      </Button>
    </div>
  );
}
