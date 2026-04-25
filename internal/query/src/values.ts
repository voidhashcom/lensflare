import type { FilterOperator, FilterValue } from "@lensflare/contracts";
import type { FilterDraftState, FilterRowDraft } from "./editor.ts";
import type { LiteralNode, ParsedPill, QueryField } from "./ast.ts";
import { LIST_OPERATORS, UNARY_OPERATORS } from "./operators.ts";

export function literalToRawValue(literal: LiteralNode): {
  readonly rawValue: string;
  readonly valueWasQuoted: boolean;
} {
  switch (literal.kind) {
    case "string":
      return { rawValue: literal.value, valueWasQuoted: literal.quoted };
    case "number":
      return { rawValue: String(literal.value), valueWasQuoted: false };
    case "boolean":
      return { rawValue: String(literal.value), valueWasQuoted: false };
    case "null":
      return { rawValue: "null", valueWasQuoted: false };
    case "regex":
      return { rawValue: literal.pattern, valueWasQuoted: false };
    case "array":
      return {
        rawValue: literal.values.map((value) => literalToSource(value)).join(","),
        valueWasQuoted: literal.values.some((value) => value.kind === "string" && value.quoted),
      };
  }
}

export function literalToFilterValue(literal: LiteralNode): FilterValue | undefined {
  switch (literal.kind) {
    case "string":
      return { _tag: "string", value: literal.value };
    case "number":
      return Number.isFinite(literal.value) ? { _tag: "number", value: literal.value } : undefined;
    case "boolean":
      return { _tag: "boolean", value: literal.value };
    case "null":
      return { _tag: "null" };
    case "regex":
      return { _tag: "string", value: literal.pattern };
    case "array": {
      const values: Array<string | number | boolean> = [];
      for (const item of literal.values) {
        switch (item.kind) {
          case "string":
            values.push(item.value);
            break;
          case "number":
            if (Number.isFinite(item.value)) values.push(item.value);
            break;
          case "boolean":
            values.push(item.value);
            break;
          case "null":
          case "regex":
          case "array":
            return undefined;
        }
      }
      return { _tag: "list", values };
    }
  }
}

export function buildFilterValue(
  field: QueryField,
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
    const values = parseListLiteral(trimmed);
    if (values.length === 0) {
      return undefined;
    }
    if (field.kind === "number") {
      const numeric = values.map(Number).filter((value) => Number.isFinite(value));
      return { _tag: "list", values: numeric };
    }
    return { _tag: "list", values };
  }

  if (field.kind === "number") {
    const number = Number(trimmed);
    if (!Number.isFinite(number)) {
      return undefined;
    }
    return { _tag: "number", value: number };
  }

  if (trimmed === "true") return { _tag: "boolean", value: true };
  if (trimmed === "false") return { _tag: "boolean", value: false };
  if (trimmed === "null") return { _tag: "null" };
  return { _tag: "string", value: trimmed };
}

export function parseListLiteral(raw: string): ReadonlyArray<string> {
  const values: Array<string> = [];
  let segmentStart = 0;
  let index = 0;
  let inQuote = false;

  while (index < raw.length) {
    const char = raw[index] ?? "";
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      index += 1;
      continue;
    }
    if (char === "," && !inQuote) {
      pushListSegment(values, raw.slice(segmentStart, index));
      segmentStart = index + 1;
    }
    index += 1;
  }

  pushListSegment(values, raw.slice(segmentStart));
  return values;
}

function pushListSegment(values: Array<string>, rawSegment: string): void {
  const trimmed = rawSegment.trim();
  if (trimmed.length === 0) return;

  if (trimmed.startsWith('"')) {
    const quoted = parseQuotedListSegment(trimmed);
    if (quoted !== null) {
      values.push(quoted);
      return;
    }
  }

  values.push(trimmed);
}

function parseQuotedListSegment(segment: string): string | null {
  let value = "";
  let index = 1;

  while (index < segment.length) {
    const char = segment[index] ?? "";
    if (char === "\\") {
      const next = segment[index + 1];
      if (next === '"' || next === "\\") {
        value += next;
        index += 2;
        continue;
      }
      value += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      return segment.slice(index + 1).trim().length === 0 ? value : null;
    }
    value += char;
    index += 1;
  }

  return null;
}

export function serialiseListLiteral(values: ReadonlyArray<string>): string {
  return values.map(serialiseListValue).join(",");
}

function serialiseListValue(value: string): string {
  if (!needsListValueQuoting(value)) {
    return value;
  }
  return `"${escapeQuoted(value)}"`;
}

function needsListValueQuoting(value: string): boolean {
  if (value.length === 0) return true;
  for (const char of value) {
    if (char === "," || char === '"' || /\s/.test(char)) return true;
  }
  return false;
}

export function literalToSource(literal: LiteralNode): string {
  switch (literal.kind) {
    case "string":
      return literal.quoted || needsValueQuoting(literal.value)
        ? `"${escapeQuoted(literal.value)}"`
        : literal.value;
    case "number":
      return String(literal.value);
    case "boolean":
      return String(literal.value);
    case "null":
      return "null";
    case "regex":
      return `/${literal.pattern.replace(/\//g, "\\/")}/${literal.flags}`;
    case "array":
      return `[${literal.values.map(literalToSource).join(", ")}]`;
  }
}

export function serialisePill(pill: ParsedPill): string {
  const field = pill.fieldPath.join(".");
  if (UNARY_OPERATORS.includes(pill.operator)) {
    return `${field} ${pill.operatorToken}`;
  }
  const value = LIST_OPERATORS.includes(pill.operator)
    ? `[${pill.rawValue}]`
    : pill.valueWasQuoted || needsValueQuoting(pill.rawValue)
      ? `"${escapeQuoted(pill.rawValue)}"`
      : pill.rawValue;
  return `${field} ${pill.operatorToken} ${value}`;
}

function needsValueQuoting(value: string): boolean {
  if (value.length === 0) return true;
  for (const char of value) {
    if (/\s/.test(char) || char === '"' || ["(", ")", "[", "]", ","].includes(char)) return true;
  }
  return false;
}

function escapeQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function draftToFilterNode(draft: FilterRowDraft): import("@lensflare/contracts").FilterNode | null {
  if (draft.field === null) return null;
  const path = [...draft.field.path];
  if (path.length === 0) return null;

  if (UNARY_OPERATORS.includes(draft.operator)) {
    return {
      _tag: "cmp",
      field: { path: path as unknown as readonly [string, ...ReadonlyArray<string>] },
      op: draft.operator,
    };
  }

  const value = buildFilterValue(draft.field, draft.operator, draft.value);
  if (value === undefined) return null;

  return {
    _tag: "cmp",
    field: { path: path as unknown as readonly [string, ...ReadonlyArray<string>] },
    op: draft.operator,
    value,
  };
}

export function draftToFilter(draft: FilterDraftState): import("@lensflare/contracts").FilterNode | null {
  const rowNodes = draft.rows
    .map((row) => draftToFilterNode(row))
    .filter((node): node is import("@lensflare/contracts").FilterNode => node !== null);
  const text = draft.text.trim();
  const children: Array<import("@lensflare/contracts").FilterNode> = text.length > 0
    ? [{ _tag: "text", query: text }, ...rowNodes]
    : rowNodes;
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return { _tag: "and", children };
}

export function describeRow(draft: FilterRowDraft): string {
  if (draft.field === null) return "";
  const label = draft.field.label || draft.field.path.join(".");
  if (UNARY_OPERATORS.includes(draft.operator)) {
    return `${label} ${draft.operator}`;
  }
  const value = draft.value.trim();
  return `${label} ${draft.operator} ${value.length === 0 ? "..." : value}`;
}
