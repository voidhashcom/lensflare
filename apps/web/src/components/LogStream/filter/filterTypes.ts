import type {
  FilterNode,
  FilterOperator,
  FilterValue,
} from "@lensflare/contracts";

import type { TelemetryLogField } from "~/data/logApi";

import type { ParsedPill } from "./syntax";

/**
 * UI-level representation of a single filter row. Stays decoupled from the
 * wire AST while the user is editing — we only materialise a `FilterNode`
 * when the row is "committable" (field picked + operator known + value valid
 * for the op kind). The popover's draft state is just `Array<FilterRowDraft>`
 * plus an optional free-text node, which makes add / remove / reorder /
 * diff trivial.
 */
export interface FilterRowDraft {
  readonly id: string;
  readonly field: TelemetryLogField | null;
  readonly operator: FilterOperator;
  readonly value: string;
}

/** Operators that do not need a right-hand side value. */
export const UNARY_OPERATORS: ReadonlyArray<FilterOperator> = ["exists", "notExists"];

/** Operators that accept multiple comma-separated values. */
export const LIST_OPERATORS: ReadonlyArray<FilterOperator> = ["in", "notIn"];

/** Human-readable label for each operator, used in the operator `<Select>`. */
export const OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
  eq: "is",
  ne: "is not",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  matchesRegex: "matches regex",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  in: "is one of",
  notIn: "is none of",
  exists: "exists",
  notExists: "does not exist",
};

const STRING_OPERATORS: ReadonlyArray<FilterOperator> = [
  "eq",
  "ne",
  "contains",
  "startsWith",
  "endsWith",
  "matchesRegex",
  "in",
  "notIn",
  "exists",
  "notExists",
];

const NUMERIC_OPERATORS: ReadonlyArray<FilterOperator> = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "notIn",
  "exists",
  "notExists",
];

const ENUM_OPERATORS: ReadonlyArray<FilterOperator> = [
  "eq",
  "ne",
  "in",
  "notIn",
  "exists",
  "notExists",
];

/**
 * Operators applicable to the given field kind. Returned in stable order so
 * the `<Select>` dropdown renders consistently between renders.
 */
export function operatorsForField(kind: TelemetryLogField["kind"]): ReadonlyArray<FilterOperator> {
  switch (kind) {
    case "number":
      return NUMERIC_OPERATORS;
    case "enum":
      return ENUM_OPERATORS;
    case "string":
    default:
      return STRING_OPERATORS;
  }
}

/**
 * Convert a raw string (as typed by the user) into a `FilterValue` suitable
 * for the given field kind / operator. Returns `undefined` when the row is
 * not yet ready to contribute to the committed AST (e.g. empty value on a
 * binary op). This helper is the single point where we leave the "strings
 * all the way down" UI world and enter the typed wire AST.
 */
export function buildFilterValue(
  field: TelemetryLogField,
  operator: FilterOperator,
  raw: string,
): FilterValue | undefined {
  if (UNARY_OPERATORS.includes(operator)) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (LIST_OPERATORS.includes(operator)) {
    const values = trimmed
      .split(",")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    if (values.length === 0) {
      return undefined;
    }
    if (field.kind === "number") {
      const numeric = values.map(Number).filter((n) => Number.isFinite(n));
      return { _tag: "list", values: numeric };
    }
    return { _tag: "list", values };
  }

  if (field.kind === "number") {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      return undefined;
    }
    return { _tag: "number", value: n };
  }

  return { _tag: "string", value: trimmed };
}

/**
 * Compile a committable row to a `cmp` `FilterNode`. Returns `null` when the
 * row is still incomplete so callers can skip it.
 */
export function draftToFilterNode(draft: FilterRowDraft): FilterNode | null {
  if (draft.field === null) {
    return null;
  }

  const path = [...draft.field.path];
  if (path.length === 0) {
    return null;
  }

  if (UNARY_OPERATORS.includes(draft.operator)) {
    return {
      _tag: "cmp",
      field: { path: path as unknown as readonly [string, ...ReadonlyArray<string>] },
      op: draft.operator,
    };
  }

  const value = buildFilterValue(draft.field, draft.operator, draft.value);
  if (value === undefined) {
    return null;
  }

  return {
    _tag: "cmp",
    field: { path: path as unknown as readonly [string, ...ReadonlyArray<string>] },
    op: draft.operator,
    value,
  };
}

/**
 * Render a committed row for the inline chip. Uses the operator label and a
 * compact value formatting so the chip stays readable even when the value is
 * a list or a long string.
 */
export function describeRow(draft: FilterRowDraft): string {
  if (draft.field === null) {
    return "";
  }
  const label = draft.field.label || draft.field.path.join(".");
  const opLabel = OPERATOR_LABELS[draft.operator];

  if (UNARY_OPERATORS.includes(draft.operator)) {
    return `${label} ${opLabel}`;
  }

  const value = draft.value.trim();
  if (value.length === 0) {
    return `${label} ${opLabel} \u2026`;
  }
  return `${label} ${opLabel} ${value}`;
}

/**
 * Represents the popover's full editing state: a list of comparison rows plus
 * an optional free-text node carried in the search-bar input. We keep these
 * separate so the search-bar's typing path is fast (no AST rebuild per
 * keystroke) and only compose them when we need a `FilterNode` to send to
 * the backend.
 */
export interface FilterDraftState {
  readonly rows: ReadonlyArray<FilterRowDraft>;
  readonly text: string;
}

/**
 * Serialise the full draft to a committable `FilterNode`. Returns `null`
 * when the draft evaluates to an unconstrained filter (no rows, no text) so
 * callers can treat that as "no filter" and skip the query param entirely.
 */
export function draftToFilter(draft: FilterDraftState): FilterNode | null {
  const rowNodes: Array<FilterNode> = [];
  for (const row of draft.rows) {
    const node = draftToFilterNode(row);
    if (node !== null) {
      rowNodes.push(node);
    }
  }

  const trimmedText = draft.text.trim();
  const hasText = trimmedText.length > 0;

  if (rowNodes.length === 0 && !hasText) {
    return null;
  }

  const children: Array<FilterNode> = hasText
    ? [{ _tag: "text", query: trimmedText }, ...rowNodes]
    : rowNodes;

  if (children.length === 1) {
    // Unwrap single-child AND so the serialised form stays minimal.
    return children[0] ?? null;
  }

  return { _tag: "and", children };
}

/**
 * Resolve a parsed pill into an editor draft. Returns `null` when the field
 * path isn't in the catalog — the caller typically falls back to rendering
 * the pill read-only with a muted "unknown field" badge.
 *
 * Negation (`!~` → `not(contains)`) is intentionally NOT round-tripped
 * through `FilterRowDraft`: the primary editing surface for a negated
 * operator is the inline pill chip (which uses `OPERATOR_SYNTAX` directly
 * and handles negation natively). If the user opens the query-builder row
 * editor for a negated pill, the row displays the underlying comparison op
 * without the `not` wrap — editing through that surface loses the negation.
 */
export function parsedPillToDraft(
  pill: ParsedPill,
  fields: ReadonlyArray<TelemetryLogField>,
  makeId: () => string,
): FilterRowDraft | null {
  const key = pill.fieldPath.join(".");
  const field = fields.find(
    (entry) => entry.path.join(".") === key || entry.label === key,
  );
  if (field === undefined) {
    return null;
  }

  return {
    id: makeId(),
    field,
    operator: pill.operator,
    value: pill.rawValue,
  };
}
