import { useEffect, useMemo, useRef } from "react";
import { CheckIcon } from "lucide-react";

import type { TelemetryLogField } from "~/data/logApi";
import { cn } from "~/lib/utils";

import { FieldTypeBadge } from "./FieldTypeBadge";
import { limitAttributeFieldSuggestions, sortFieldsByFrequency } from "./fieldSuggestionLimits";
import { OPERATOR_LABELS } from "./filterTypes";
import { useFieldValues } from "./hooks/useFieldValues";
import { operatorSyntaxesForKind, type CursorContext, type OperatorSyntax } from "./syntax";

/**
 * What the user emits when they pick a row from the suggestions list. Each
 * variant maps 1:1 to a `CursorContext` kind so the parent can splice the
 * right slice of `source` (field prefix / partial operator / partial value).
 */
export type FilterSuggestion =
  | { readonly kind: "field"; readonly field: TelemetryLogField }
  | { readonly kind: "operator"; readonly syntax: OperatorSyntax }
  | { readonly kind: "value"; readonly value: string };

interface FilterSuggestionsPanelProps {
  suggestionsId: string;
  projectId: string;
  datasetId: string;
  fields: ReadonlyArray<TelemetryLogField>;
  cursorContext: CursorContext;
  highlightedSuggestionIndex: number | null;
  onApplySuggestion: (suggestion: FilterSuggestion) => void;
  onSuggestionCountChange: (count: number) => void;
}

/**
 * Dropdown body for context-sensitive query suggestions: fields in field
 * position, operators in operator position, and known values in value position.
 */
export function FilterSuggestionsPanel({
  suggestionsId,
  projectId,
  datasetId,
  fields,
  cursorContext,
  highlightedSuggestionIndex,
  onApplySuggestion,
  onSuggestionCountChange,
}: FilterSuggestionsPanelProps) {
  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto divide-y"
      id={suggestionsId}
    >
      <SuggestionsSection
        cursorContext={cursorContext}
        datasetId={datasetId}
        fields={fields}
        highlightedSuggestionIndex={highlightedSuggestionIndex}
        onApplySuggestion={onApplySuggestion}
        onSuggestionCountChange={onSuggestionCountChange}
        projectId={projectId}
      />
    </div>
  );
}

interface SuggestionsSectionProps {
  projectId: string;
  datasetId: string;
  fields: ReadonlyArray<TelemetryLogField>;
  cursorContext: CursorContext;
  highlightedSuggestionIndex: number | null;
  onApplySuggestion: (suggestion: FilterSuggestion) => void;
  onSuggestionCountChange: (count: number) => void;
}

function SuggestionsSection({
  projectId,
  datasetId,
  fields,
  cursorContext,
  highlightedSuggestionIndex,
  onApplySuggestion,
  onSuggestionCountChange,
}: SuggestionsSectionProps) {
  switch (cursorContext.kind) {
    case "field":
      return (
        <FieldSuggestions
          fields={fields}
          highlightedSuggestionIndex={highlightedSuggestionIndex}
          onSelect={(field) => onApplySuggestion({ kind: "field", field })}
          onSuggestionCountChange={onSuggestionCountChange}
          prefix={cursorContext.prefix}
        />
      );
    case "operator":
      return (
        <OperatorSuggestions
          fields={fields}
          highlightedSuggestionIndex={highlightedSuggestionIndex}
          onSelect={(syntax) => onApplySuggestion({ kind: "operator", syntax })}
          onSuggestionCountChange={onSuggestionCountChange}
          path={cursorContext.fieldPath}
          tokenPrefix={cursorContext.tokenPrefix}
        />
      );
    case "value":
      return (
        <ValueSuggestions
          datasetId={datasetId}
          fields={fields}
          highlightedSuggestionIndex={highlightedSuggestionIndex}
          isMultiValue={cursorContext.list !== undefined}
          onSelect={(value) => onApplySuggestion({ kind: "value", value })}
          onSuggestionCountChange={onSuggestionCountChange}
          path={cursorContext.fieldPath}
          projectId={projectId}
          selectedValues={cursorContext.list?.values ?? []}
          valuePrefix={cursorContext.valuePrefix}
        />
      );
  }
}

interface FieldSuggestionsProps {
  fields: ReadonlyArray<TelemetryLogField>;
  prefix: string;
  highlightedSuggestionIndex: number | null;
  onSelect: (field: TelemetryLogField) => void;
  onSuggestionCountChange: (count: number) => void;
}

function FieldSuggestions({
  fields,
  prefix,
  highlightedSuggestionIndex,
  onSelect,
  onSuggestionCountChange,
}: FieldSuggestionsProps) {
  const needle = prefix.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const matches =
      needle.length === 0
        ? fields
        : fields.filter((field) => {
            const label = field.label.toLowerCase();
            const path = field.path.join(".").toLowerCase();
            return label.includes(needle) || path.includes(needle);
          });

    return limitAttributeFieldSuggestions(sortFieldsByFrequency(matches));
  }, [fields, needle]);

  useEffect(() => {
    onSuggestionCountChange(suggestions.length);
  }, [onSuggestionCountChange, suggestions.length]);

  return (
    <SuggestionList emptyLabel="No matching fields." title="Fields">
      {suggestions.map((field, index) => (
        <SuggestionListItem
          highlighted={index === highlightedSuggestionIndex}
          key={field.path.join(".")}
          onSelect={() => onSelect(field)}
        >
          <FieldTypeBadge className="-ms-0.5" kind={field.kind} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-foreground">{field.label}</span>
            {field.path.length > 1 ? (
              <span className="truncate text-muted-foreground text-xs">{field.path.join(".")}</span>
            ) : null}
          </span>
        </SuggestionListItem>
      ))}
    </SuggestionList>
  );
}

interface OperatorSuggestionsProps {
  fields: ReadonlyArray<TelemetryLogField>;
  path: ReadonlyArray<string>;
  tokenPrefix: string;
  highlightedSuggestionIndex: number | null;
  onSelect: (syntax: OperatorSyntax) => void;
  onSuggestionCountChange: (count: number) => void;
}

function OperatorSuggestions({
  fields,
  path,
  tokenPrefix,
  highlightedSuggestionIndex,
  onSelect,
  onSuggestionCountChange,
}: OperatorSuggestionsProps) {
  const field = useMemo(() => findFieldByPath(fields, path), [fields, path]);
  const kind = field?.kind ?? "string";
  const options = useMemo(() => {
    const syntaxes = operatorSyntaxesForKind(kind);
    if (tokenPrefix.length === 0) return syntaxes;
    return syntaxes.filter((entry) => entry.token.startsWith(tokenPrefix));
  }, [kind, tokenPrefix]);

  useEffect(() => {
    onSuggestionCountChange(options.length);
  }, [onSuggestionCountChange, options.length]);

  return (
    <SuggestionList emptyLabel="No matching operators." title="Operators">
      {options.map((syntax, index) => (
        <SuggestionListItem
          highlighted={index === highlightedSuggestionIndex}
          key={`${syntax.token}-${syntax.operator}-${syntax.negated}`}
          onSelect={() => onSelect(syntax)}
        >
          <span className="w-28 shrink-0 whitespace-nowrap font-mono text-foreground text-sm">
            {syntax.token}
          </span>
          <span className="truncate text-muted-foreground">
            {OPERATOR_LABELS[syntax.operator]}
            {syntax.negated ? " (negated)" : ""}
          </span>
        </SuggestionListItem>
      ))}
    </SuggestionList>
  );
}

interface ValueSuggestionsProps {
  projectId: string;
  datasetId: string;
  fields: ReadonlyArray<TelemetryLogField>;
  isMultiValue: boolean;
  path: ReadonlyArray<string>;
  selectedValues: ReadonlyArray<string>;
  valuePrefix: string;
  highlightedSuggestionIndex: number | null;
  onSelect: (value: string) => void;
  onSuggestionCountChange: (count: number) => void;
}

function ValueSuggestions({
  projectId,
  datasetId,
  fields,
  isMultiValue,
  path,
  selectedValues,
  valuePrefix,
  highlightedSuggestionIndex,
  onSelect,
  onSuggestionCountChange,
}: ValueSuggestionsProps) {
  const field = useMemo(() => findFieldByPath(fields, path), [fields, path]);

  // Only ask the server for values when it could actually supply a useful
  // enumeration — i.e. the field is enum-kinded and the catalog didn't bake
  // them in already.
  const shouldFetchValues =
    field !== null && field.kind === "enum" && (!field.values || field.values.length === 0);
  const valuesState = useFieldValues(projectId, datasetId, shouldFetchValues ? field.path : null);

  const knownValues = useMemo(() => {
    if (field === null) return [];
    if (field.values && field.values.length > 0) return field.values;
    return valuesState.values;
  }, [field, valuesState.values]);

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const needle = valuePrefix.trim().toLowerCase();
  const filtered = useMemo(() => {
    const exactPrefix = valuePrefix.trim();
    if (needle.length > 0 && selectedSet.has(exactPrefix) && knownValues.includes(exactPrefix)) {
      return knownValues;
    }
    if (needle.length === 0) return knownValues;
    return knownValues.filter((value) => value.toLowerCase().includes(needle));
  }, [knownValues, needle, selectedSet, valuePrefix]);

  useEffect(() => {
    onSuggestionCountChange(field === null || knownValues.length === 0 ? 0 : filtered.length);
  }, [field, filtered.length, knownValues.length, onSuggestionCountChange]);

  if (field === null) {
    return (
      <SuggestionList emptyLabel="Unknown field." title="Values">
        {[]}
      </SuggestionList>
    );
  }

  if (knownValues.length === 0) {
    return (
      <SuggestionList
        emptyLabel={
          valuesState.isLoading ? "Loading values…" : "Type a value and press space to commit."
        }
        title="Values"
      >
        {[]}
      </SuggestionList>
    );
  }

  return (
    <SuggestionList emptyLabel="No matching values." title="Values">
      {filtered.map((value, index) => (
        <SuggestionListItem
          highlighted={index === highlightedSuggestionIndex}
          key={value}
          onSelect={() => onSelect(value)}
        >
          {isMultiValue ? (
            <span className="flex size-4 shrink-0 items-center justify-center text-primary">
              {selectedSet.has(value) ? <CheckIcon className="size-3.5" /> : null}
            </span>
          ) : null}
          <span className="truncate text-foreground">{value}</span>
        </SuggestionListItem>
      ))}
    </SuggestionList>
  );
}

interface SuggestionListProps {
  title: string;
  emptyLabel: string;
  children: React.ReactNode | Array<React.ReactNode>;
}

function SuggestionList({ title, emptyLabel, children }: SuggestionListProps) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.some((child) => child !== null && child !== undefined && child !== false);

  return (
    <section className="flex flex-col gap-1 p-2">
      <header className="px-1">
        <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {title}
        </h3>
      </header>
      {hasItems ? (
        <ul className="flex flex-col" role="listbox">
          {items}
        </ul>
      ) : (
        <p className="px-1 py-1 text-muted-foreground text-sm">{emptyLabel}</p>
      )}
    </section>
  );
}

interface SuggestionListItemProps {
  highlighted: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}

function SuggestionListItem({ highlighted, onSelect, children }: SuggestionListItemProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!highlighted) return;
    buttonRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <li aria-selected={highlighted} role="option">
      <button
        className={cn(
          "flex w-full min-w-0  items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent/50",
          highlighted && "bg-accent text-accent-foreground",
        )}
        data-filter-suggestion-active={highlighted ? "true" : undefined}
        // Avoid stealing focus from the outer input so clicking a suggestion
        // doesn't dismiss the popover before the click handler has a chance
        // to run.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={onSelect}
        ref={buttonRef}
        type="button"
      >
        {children}
      </button>
    </li>
  );
}

function findFieldByPath(
  fields: ReadonlyArray<TelemetryLogField>,
  path: ReadonlyArray<string>,
): TelemetryLogField | null {
  const key = path.join(".");
  for (const field of fields) {
    if (field.path.join(".") === key) return field;
    if (field.label === key) return field;
  }
  return null;
}
