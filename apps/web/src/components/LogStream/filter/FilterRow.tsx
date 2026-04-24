import type { FilterOperator } from "@lensflare/contracts";
import { TrashIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "~/components/ui/combobox";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { TelemetryLogField } from "~/data/logApi";
import { cn } from "~/lib/utils";

import { FieldTypeBadge } from "./FieldTypeBadge";
import { useFieldValues } from "./hooks/useFieldValues";
import {
  LIST_OPERATORS,
  OPERATOR_LABELS,
  UNARY_OPERATORS,
  operatorsForField,
  type FilterRowDraft,
} from "./filterTypes";

interface FilterRowProps {
  projectId: string;
  datasetId: string;
  draft: FilterRowDraft;
  onChange: (next: FilterRowDraft) => void;
  onRemove: () => void;
}

function fieldLabel(field: TelemetryLogField): string {
  return field.label;
}

/**
 * A single editable `{ field, operator, value }` row inside the query builder
 * popover. The field is fixed to the parsed pill; changing the operator or
 * value rewrites that pill back into the source query.
 */
export function FilterRow({
  projectId,
  datasetId,
  draft,
  onChange,
  onRemove,
}: FilterRowProps) {
  const field = draft.field;
  const operators = field === null ? [] : operatorsForField(field.kind);
  const isUnary = UNARY_OPERATORS.includes(draft.operator);
  const isListOperator = LIST_OPERATORS.includes(draft.operator);

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
        <div
          className={cn(
            "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-[calc(--spacing(2.5)-1px)] text-sm shadow-xs/5 sm:min-h-7",
            field === null && "border-destructive/40 bg-destructive/5",
          )}
        >
          {field === null ? null : (
            <FieldTypeBadge className="-ms-0.5 shrink-0" kind={field.kind} />
          )}
          <span className="min-w-0 truncate font-medium text-foreground">
            {field === null ? "Unknown field" : fieldLabel(field)}
          </span>
        </div>
      </div>

      <div className="w-36 shrink-0">
        <Select
          disabled={field === null}
          onValueChange={(next: unknown) => handleOperatorChange(next as FilterOperator)}
          value={draft.operator}
        >
          <SelectTrigger size="sm">
            <SelectValue>{OPERATOR_LABELS[draft.operator]}</SelectValue>
          </SelectTrigger>
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
        ) : isListOperator && knownValues.length > 0 ? (
          <ListValueCombobox
            onChange={handleValueChange}
            options={knownValues}
            value={draft.value}
          />
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

interface ListValueComboboxProps {
  value: string;
  options: ReadonlyArray<string>;
  onChange: (next: string) => void;
}

function ListValueCombobox({ value, options, onChange }: ListValueComboboxProps) {
  const [inputValue, setInputValue] = useState("");
  const selectedValues = splitListInput(value);

  return (
    <Combobox
      inputValue={inputValue}
      items={options as Array<string>}
      multiple
      onInputValueChange={setInputValue}
      onValueChange={(next) => {
        onChange(next.join(", "));
        setInputValue("");
      }}
      value={selectedValues}
    >
      <ComboboxChips className="min-h-8 p-[calc(--spacing(1)-1px)] sm:min-h-7">
        {selectedValues.map((item) => (
          <ComboboxChip key={item}>{item}</ComboboxChip>
        ))}
        <ComboboxChipsInput
          className="min-w-20"
          placeholder={selectedValues.length === 0 ? "Select values" : ""}
          size="sm"
        />
      </ComboboxChips>
      <ComboboxPopup>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty>No values.</ComboboxEmpty>
      </ComboboxPopup>
    </Combobox>
  );
}

function splitListInput(value: string): Array<string> {
  return value
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}
