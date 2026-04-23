import type { FilterOperator } from "@lensflare/contracts";
import { useEffect, useMemo } from "react";

import type { TelemetryLogField } from "~/data/logApi";
import { cn } from "~/lib/utils";

import { FieldTypeBadge } from "./FieldTypeBadge";
import { FilterRow } from "./FilterRow";
import { limitAttributeFieldSuggestions } from "./fieldSuggestionLimits";
import {
  OPERATOR_LABELS,
  UNARY_OPERATORS,
  parsedPillToDraft,
  type FilterRowDraft,
} from "./filterTypes";
import { useFieldValues } from "./hooks/useFieldValues";
import {
  operatorSyntaxesForKind,
  preferredTokenForOperator,
  resolvePillField,
  type CursorContext,
  type OperatorSyntax,
  type ParsedPill,
} from "./syntax";

/**
 * What the user emits when they pick a row from the suggestions list. Each
 * variant maps 1:1 to a `CursorContext` kind so the parent can splice the
 * right slice of `source` (field prefix / partial operator / partial value).
 */
export type FilterSuggestion =
  | { readonly kind: "field"; readonly field: TelemetryLogField }
  | { readonly kind: "operator"; readonly syntax: OperatorSyntax }
  | { readonly kind: "value"; readonly value: string };

/**
 * Describes how the parent should patch the pill at index `index` back into
 * `source`. Passed to the mutation callback so the parent re-serialises with
 * the pill's canonical shape (field join, preferred operator token, quoted
 * value when necessary).
 */
export interface PillMutation {
  readonly fieldPath: ReadonlyArray<string>;
  readonly operator: FilterOperator;
  readonly operatorToken: string;
  readonly negated: boolean;
  readonly rawValue: string;
  readonly valueWasQuoted: boolean;
}

interface FilterSuggestionsPanelProps {
  suggestionsId: string;
  projectId: string;
  datasetId: string;
  pills: ReadonlyArray<ParsedPill>;
  fields: ReadonlyArray<TelemetryLogField>;
  cursorContext: CursorContext;
  highlightedSuggestionIndex: number | null;
  onEditPill: (index: number, mutation: PillMutation) => void;
  onHighlightSuggestion: (index: number) => void;
  onRemovePill: (index: number) => void;
  onApplySuggestion: (suggestion: FilterSuggestion) => void;
  onSuggestionCountChange: (count: number) => void;
}

/**
 * Dropdown body for the query input. Holds two stacked sections:
 *
 *   1. **Query builder** — one `FilterRow` per committed pill, re-using the
 *      existing row editor so users still have the explicit control surface
 *      for rarely-typed operators (`matchesRegex`, `in`, `notIn`, …). The
 *      section is hidden when there are no pills.
 *
 *   2. **Suggestions** — a context-sensitive list of what can come next:
 *      fields when the caret is in a field position, operators when it's in
 *      an operator position, and (for enum-ish fields) known values when in
 *      a value position. The list is derived purely from `cursorContext` and
 *      the catalog — it doesn't own any interaction state beyond hover.
 */
export function FilterSuggestionsPanel({
  suggestionsId,
  projectId,
  datasetId,
  pills,
  fields,
  cursorContext,
  highlightedSuggestionIndex,
  onEditPill,
  onHighlightSuggestion,
  onRemovePill,
  onApplySuggestion,
  onSuggestionCountChange,
}: FilterSuggestionsPanelProps) {
  return (
    <div className="flex w-full min-w-0 flex-col divide-y" id={suggestionsId}>
      {pills.length > 0 ? (
        <QueryBuilderSection
          datasetId={datasetId}
          fields={fields}
          onEditPill={onEditPill}
          onRemovePill={onRemovePill}
          pills={pills}
          projectId={projectId}
        />
      ) : null}
      <SuggestionsSection
        cursorContext={cursorContext}
        datasetId={datasetId}
        fields={fields}
        highlightedSuggestionIndex={highlightedSuggestionIndex}
        onApplySuggestion={onApplySuggestion}
        onHighlightSuggestion={onHighlightSuggestion}
        onSuggestionCountChange={onSuggestionCountChange}
        projectId={projectId}
      />
    </div>
  );
}

interface QueryBuilderSectionProps {
  projectId: string;
  datasetId: string;
  pills: ReadonlyArray<ParsedPill>;
  fields: ReadonlyArray<TelemetryLogField>;
  onEditPill: (index: number, mutation: PillMutation) => void;
  onRemovePill: (index: number) => void;
}

function QueryBuilderSection({
  projectId,
  datasetId,
  pills,
  fields,
  onEditPill,
  onRemovePill,
}: QueryBuilderSectionProps) {
  return (
    <section className="flex flex-col gap-2 p-3">
      <header className="flex items-center justify-between">
        <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Query builder
        </h3>
      </header>
      <div className="flex flex-col gap-2">
        {pills.map((pill, index) => (
          <PillRow
            datasetId={datasetId}
            fields={fields}
            index={index}
            key={`${index}:${pill.start}`}
            onEditPill={onEditPill}
            onRemovePill={onRemovePill}
            pill={pill}
            projectId={projectId}
          />
        ))}
      </div>
    </section>
  );
}

interface PillRowProps {
  projectId: string;
  datasetId: string;
  index: number;
  pill: ParsedPill;
  fields: ReadonlyArray<TelemetryLogField>;
  onEditPill: (index: number, mutation: PillMutation) => void;
  onRemovePill: (index: number) => void;
}

function PillRow({
  projectId,
  datasetId,
  index,
  pill,
  fields,
  onEditPill,
  onRemovePill,
}: PillRowProps) {
  const resolvedField = resolvePillField(pill, fields);
  const draft: FilterRowDraft = useMemo(() => {
    const adapted = parsedPillToDraft(pill, fields, () => `pill-${index}`);
    if (adapted !== null) return adapted;
    return { id: `pill-${index}`, field: null, operator: pill.operator, value: pill.rawValue };
  }, [pill, fields, index]);

  const handleChange = (next: FilterRowDraft) => {
    if (next.field === null) {
      // User cleared the field from the row editor — treat as "remove pill"
      // to avoid an inconsistent half-deleted pill in `source`.
      onRemovePill(index);
      return;
    }
    const kind = next.field.kind;
    const token = preferredTokenForOperator(next.operator, pill.negated, kind);
    const isUnary = UNARY_OPERATORS.includes(next.operator);
    const rawValue = isUnary ? "" : next.value;
    const valueWasQuoted =
      !isUnary && (rawValue.includes(" ") || rawValue.includes('"'));
    onEditPill(index, {
      fieldPath: next.field.path,
      operator: next.operator,
      operatorToken: token,
      negated: pill.negated,
      rawValue,
      valueWasQuoted,
    });
  };

  return (
    <div
      className={cn(
        "rounded-md",
        resolvedField === null && "bg-destructive/5 p-2",
      )}
    >
      <FilterRow
        datasetId={datasetId}
        draft={draft}
        fields={fields}
        onChange={handleChange}
        onRemove={() => onRemovePill(index)}
        projectId={projectId}
      />
      {pill.negated ? (
        <p className="mt-1 text-muted-foreground text-xs">
          Typed as <code className="font-mono">{pill.operatorToken}</code> — row
          editor shows the positive form; edits are wrapped in{" "}
          <code className="font-mono">NOT</code>.
        </p>
      ) : null}
      {resolvedField === null ? (
        <p className="mt-1 text-destructive text-xs">
          Unknown field "{pill.fieldPath.join(".")}".
        </p>
      ) : null}
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
  onHighlightSuggestion: (index: number) => void;
  onSuggestionCountChange: (count: number) => void;
}

function SuggestionsSection({
  projectId,
  datasetId,
  fields,
  cursorContext,
  highlightedSuggestionIndex,
  onApplySuggestion,
  onHighlightSuggestion,
  onSuggestionCountChange,
}: SuggestionsSectionProps) {
  switch (cursorContext.kind) {
    case "field":
      return (
        <FieldSuggestions
          fields={fields}
          highlightedSuggestionIndex={highlightedSuggestionIndex}
          onHighlightSuggestion={onHighlightSuggestion}
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
          onHighlightSuggestion={onHighlightSuggestion}
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
          onHighlightSuggestion={onHighlightSuggestion}
          onSelect={(value) => onApplySuggestion({ kind: "value", value })}
          onSuggestionCountChange={onSuggestionCountChange}
          path={cursorContext.fieldPath}
          projectId={projectId}
          valuePrefix={cursorContext.valuePrefix}
        />
      );
  }
}

interface FieldSuggestionsProps {
  fields: ReadonlyArray<TelemetryLogField>;
  prefix: string;
  highlightedSuggestionIndex: number | null;
  onHighlightSuggestion: (index: number) => void;
  onSelect: (field: TelemetryLogField) => void;
  onSuggestionCountChange: (count: number) => void;
}

function FieldSuggestions({
  fields,
  prefix,
  highlightedSuggestionIndex,
  onHighlightSuggestion,
  onSelect,
  onSuggestionCountChange,
}: FieldSuggestionsProps) {
  const needle = prefix.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const matches = needle.length === 0 ? fields : fields.filter((field) => {
      const label = field.label.toLowerCase();
      const path = field.path.join(".").toLowerCase();
      return label.includes(needle) || path.includes(needle);
    });

    return limitAttributeFieldSuggestions(matches);
  }, [fields, needle]);

  useEffect(() => {
    onSuggestionCountChange(suggestions.length);
  }, [onSuggestionCountChange, suggestions.length]);

  return (
    <SuggestionList emptyLabel="No matching fields." title="Fields">
      {suggestions.map((field, index) => (
        <SuggestionListItem
          highlighted={index === highlightedSuggestionIndex}
          index={index}
          key={field.path.join(".")}
          onHighlight={onHighlightSuggestion}
          onSelect={() => onSelect(field)}
        >
          <FieldTypeBadge className="-ms-0.5" kind={field.kind} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-foreground">
              {field.label}
            </span>
            {field.path.length > 1 ? (
              <span className="truncate text-muted-foreground text-xs">
                {field.path.join(".")}
              </span>
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
  onHighlightSuggestion: (index: number) => void;
  onSelect: (syntax: OperatorSyntax) => void;
  onSuggestionCountChange: (count: number) => void;
}

function OperatorSuggestions({
  fields,
  path,
  tokenPrefix,
  highlightedSuggestionIndex,
  onHighlightSuggestion,
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
          index={index}
          key={`${syntax.token}-${syntax.operator}-${syntax.negated}`}
          onHighlight={onHighlightSuggestion}
          onSelect={() => onSelect(syntax)}
        >
          <span className="w-12 font-mono text-foreground text-sm">
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
  path: ReadonlyArray<string>;
  valuePrefix: string;
  highlightedSuggestionIndex: number | null;
  onHighlightSuggestion: (index: number) => void;
  onSelect: (value: string) => void;
  onSuggestionCountChange: (count: number) => void;
}

function ValueSuggestions({
  projectId,
  datasetId,
  fields,
  path,
  valuePrefix,
  highlightedSuggestionIndex,
  onHighlightSuggestion,
  onSelect,
  onSuggestionCountChange,
}: ValueSuggestionsProps) {
  const field = useMemo(() => findFieldByPath(fields, path), [fields, path]);

  // Only ask the server for values when it could actually supply a useful
  // enumeration — i.e. the field is enum-kinded and the catalog didn't bake
  // them in already.
  const shouldFetchValues =
    field !== null && field.kind === "enum" && (!field.values || field.values.length === 0);
  const valuesState = useFieldValues(
    projectId,
    datasetId,
    shouldFetchValues ? field.path : null,
  );

  const knownValues = useMemo(() => {
    if (field === null) return [];
    if (field.values && field.values.length > 0) return field.values;
    return valuesState.values;
  }, [field, valuesState.values]);

  const needle = valuePrefix.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (needle.length === 0) return knownValues;
    return knownValues.filter((value) => value.toLowerCase().includes(needle));
  }, [knownValues, needle]);

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
          valuesState.isLoading
            ? "Loading values…"
            : "Type a value and press space to commit."
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
          index={index}
          key={value}
          onHighlight={onHighlightSuggestion}
          onSelect={() => onSelect(value)}
        >
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
  index: number;
  onHighlight: (index: number) => void;
  onSelect: () => void;
  children: React.ReactNode;
}

function SuggestionListItem({
  highlighted,
  index,
  onHighlight,
  onSelect,
  children,
}: SuggestionListItemProps) {
  return (
    <li aria-selected={highlighted} role="option">
      <button
        className={cn(
          "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent/50",
          highlighted && "bg-accent text-accent-foreground",
        )}
        data-filter-suggestion-active={highlighted ? "true" : undefined}
        // Avoid stealing focus from the outer input so clicking a suggestion
        // doesn't dismiss the popover before the click handler has a chance
        // to run.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onMouseEnter={() => onHighlight(index)}
        onClick={onSelect}
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
