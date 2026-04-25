import type { FilterNode, FilterOperator } from "@lensflare/contracts";
import {
  type CursorContext,
  type FilterInputParseResult,
  type ParsedPill,
  type QueryField,
  type QueryNode,
} from "./ast.ts";
import { compileQueryToFilter, resolveQueryField } from "./compiler.ts";
import { type Token } from "./lexer.ts";
import { operatorSyntaxesForKind, preferredTokenForOperator } from "./operators.ts";
import { parseQuery } from "./parser.ts";
import { literalToRawValue, serialisePill } from "./values.ts";

export interface FilterRowDraft {
  readonly id: string;
  readonly field: QueryField | null;
  readonly operator: FilterOperator;
  readonly value: string;
}

export interface FilterDraftState {
  readonly rows: ReadonlyArray<FilterRowDraft>;
  readonly text: string;
}

export interface EditorContext {
  readonly parse: FilterInputParseResult;
  readonly tokens: ReadonlyArray<Token>;
  readonly cursorContext: CursorContext;
  readonly tokenHighlights: ReadonlyArray<{
    readonly kind: Token["kind"];
    readonly start: number;
    readonly end: number;
  }>;
  readonly diagnostics: FilterInputParseResult["diagnostics"];
}

export function getEditorContext(
  source: string,
  cursor: number,
  fields: ReadonlyArray<QueryField>,
): EditorContext {
  const parse = parseFilterInput(source, cursor, fields);
  return {
    parse,
    tokens: parse.tokens,
    cursorContext: parse.cursorContext,
    diagnostics: parse.diagnostics,
    tokenHighlights: parse.tokens.map((token) => ({
      kind: token.kind,
      start: token.span.start,
      end: token.span.end,
    })),
  };
}

export function parseFilterInput(
  source: string,
  cursor: number,
  fields: ReadonlyArray<QueryField> = [],
): FilterInputParseResult {
  const result = parseQuery(source);
  const pills = result.ast === null ? [] : collectPills(result.ast, source);
  const contextInfo = computeCursorContext(source, cursor, result.tokens, fields);
  const lastPill = pills.at(-1);
  const trailingStart = lastPill !== undefined &&
    cursor >= lastPill.end
    ? lastPill.end
    : contextInfo.trailingStart;
  const trailingText = source.slice(trailingStart);

  return {
    ...result,
    pills,
    trailingText,
    trailingStart,
    cursorContext: contextInfo.context,
  };
}

export function completeParsedPills(result: FilterInputParseResult): ReadonlyArray<ParsedPill> {
  return result.pills;
}

export function parsedToFilter(
  result: FilterInputParseResult,
  fields: ReadonlyArray<QueryField>,
): FilterNode | null {
  return compileQueryToFilter(result.ast, fields);
}

export function resolvePillField(
  pill: ParsedPill,
  fields: ReadonlyArray<QueryField>,
): QueryField | null {
  return resolveQueryField(pill.fieldPath.join("."), fields, { start: pill.start, end: pill.end });
}

export function parsedPillToDraft(
  pill: ParsedPill,
  fields: ReadonlyArray<QueryField>,
  makeId: () => string,
): FilterRowDraft | null {
  const field = resolvePillField(pill, fields);
  if (field === null) return null;
  return {
    id: makeId(),
    field,
    operator: pill.operator,
    value: pill.rawValue,
  };
}

function collectPills(ast: QueryNode, source: string): ReadonlyArray<ParsedPill> {
  const pills: Array<ParsedPill> = [];
  visit(ast, pills, source);
  return pills.sort((left, right) => left.start - right.start);
}

function visit(node: QueryNode, pills: Array<ParsedPill>, source: string): void {
  switch (node.kind) {
    case "comparison": {
      const raw = literalToRawValue(node.value);
      const operatorSpan = trimSpan(source, {
        start: node.field.span.end,
        end: node.value.span.start,
      });
      pills.push({
        fieldPath: node.field.segments,
        operatorToken: tokenForComparison(node.operator),
        operator: node.operator,
        negated: false,
        rawValue: raw.rawValue,
        valueWasQuoted: raw.valueWasQuoted,
        start: node.span.start,
        end: node.span.end,
        fieldSpan: node.field.span,
        operatorSpan,
        valueSpan: node.value.span,
      });
      return;
    }
    case "exists": {
      const operatorSpan = trimSpan(source, {
        start: node.field.span.end,
        end: node.span.end,
      });
      pills.push({
        fieldPath: node.field.segments,
        operatorToken: node.present ? "exists" : "missing",
        operator: node.present ? "exists" : "notExists",
        negated: false,
        rawValue: "",
        valueWasQuoted: false,
        start: node.span.start,
        end: node.span.end,
        fieldSpan: node.field.span,
        operatorSpan,
      });
      return;
    }
    case "and":
    case "or":
      for (const child of node.children) visit(child, pills, source);
      return;
    case "not":
    case "group":
      visit(node.child, pills, source);
      return;
    case "text":
      return;
  }
}

function trimSpan(source: string, span: { readonly start: number; readonly end: number }) {
  let start = span.start;
  let end = span.end;
  while (start < end && /\s/.test(source[start] ?? "")) start += 1;
  while (end > start && /\s/.test(source[end - 1] ?? "")) end -= 1;
  return { start, end };
}

function tokenForComparison(operator: FilterOperator): string {
  switch (operator) {
    case "eq":
      return "=";
    case "ne":
      return "!=";
    case "gt":
      return ">";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "lte":
      return "<=";
    case "contains":
      return "contains";
    case "startsWith":
      return "startsWith";
    case "endsWith":
      return "endsWith";
    case "matchesRegex":
      return "~=";
    case "in":
      return "in";
    case "notIn":
      return "not in";
    case "exists":
      return "exists";
    case "notExists":
      return "missing";
  }
}

function computeCursorContext(
  source: string,
  cursor: number,
  tokens: ReadonlyArray<Token>,
  fields: ReadonlyArray<QueryField>,
): { readonly context: CursorContext; readonly trailingStart: number } {
  const clamped = Math.max(0, Math.min(cursor, source.length));
  if (clamped > 0 && /\s/.test(source[clamped - 1] ?? "")) {
    const expressionStart = findExpressionStart(source, clamped);
    const recent = tokens.filter((token) => token.span.start >= expressionStart && token.span.end <= clamped);
    const first = recent[0];
    const last = recent.at(-1);
    if (first?.kind === "word" && recent.length === 1) {
      return {
        context: { kind: "operator", fieldPath: splitPath(first.text), tokenPrefix: "" },
        trailingStart: expressionStart,
      };
    }
    if (first?.kind === "word" && last !== undefined && isOperatorish(last)) {
      const field = resolveQueryField(first.text, fields, first.span);
      const kind = field?.kind ?? "string";
      const syntax = operatorSyntaxesForKind(kind).find((entry) => entry.token === last.text) ??
        operatorSyntaxesForKind(kind)[0];
      return {
        context: {
          kind: "value",
          fieldPath: splitPath(first.text),
          operator: syntax?.operator ?? "eq",
          operatorToken: syntax?.token ?? "=",
          negated: false,
          valuePrefix: "",
        },
        trailingStart: expressionStart,
      };
    }
    return { context: { kind: "field", prefix: "" }, trailingStart: clamped };
  }
  const before = tokens.filter((token) => token.span.start <= clamped);
  const current = [...before].reverse().find((token) => token.span.start <= clamped && clamped <= token.span.end);
  const last = current ?? before.at(-1);

  if (last === undefined) {
    return { context: { kind: "field", prefix: "" }, trailingStart: clamped };
  }

  const expressionStart = findExpressionStart(source, clamped);
  const recent = tokens.filter((token) => token.span.start >= expressionStart && token.span.start <= clamped);
  const first = recent[0];
  const second = recent[1];
  const third = recent[2];

  if (first?.kind === "word" && second === undefined) {
    if (clamped > first.span.end) {
      return {
        context: { kind: "operator", fieldPath: splitPath(first.text), tokenPrefix: "" },
        trailingStart: expressionStart,
      };
    }
    return {
      context: { kind: "field", prefix: source.slice(first.span.start, clamped) },
      trailingStart: expressionStart,
    };
  }

  if (first?.kind === "word" && second !== undefined && isOperatorish(second)) {
    const field = resolveQueryField(first.text, fields, first.span);
    const kind = field?.kind ?? "string";
    const syntax = operatorSyntaxesForKind(kind).find((entry) => entry.token === second.text) ??
      operatorSyntaxesForKind(kind)[0];
    return {
      context: {
        kind: "value",
        fieldPath: splitPath(first.text),
        operator: syntax?.operator ?? "eq",
        operatorToken: syntax?.token ?? "=",
        negated: false,
        valuePrefix: third === undefined ? "" : source.slice(third.span.start, clamped).replace(/^"/, "").replace(/"$/, ""),
      },
      trailingStart: expressionStart,
    };
  }

  if (first?.kind === "word" && second?.kind === "word") {
    const lower = second.text.toLowerCase();
    if (["contains", "startswith", "endswith", "in", "exists", "missing"].includes(lower)) {
      return {
        context: {
          kind: lower === "exists" || lower === "missing" ? "field" : "value",
          fieldPath: splitPath(first.text),
          operator: operatorFromWord(lower),
          operatorToken: second.text,
          negated: false,
          valuePrefix: third === undefined ? "" : source.slice(third.span.start, clamped).replace(/^"/, "").replace(/"$/, ""),
        } as CursorContext,
        trailingStart: expressionStart,
      };
    }
    return {
      context: { kind: "operator", fieldPath: splitPath(first.text), tokenPrefix: source.slice(second.span.start, clamped) },
      trailingStart: expressionStart,
    };
  }

  return {
    context: { kind: "field", prefix: last.kind === "word" ? source.slice(last.span.start, clamped) : "" },
    trailingStart: expressionStart,
  };
}

function operatorFromWord(word: string): FilterOperator {
  switch (word) {
    case "contains":
      return "contains";
    case "startswith":
      return "startsWith";
    case "endswith":
      return "endsWith";
    case "in":
      return "in";
    case "missing":
      return "notExists";
    case "exists":
      return "exists";
    default:
      return "eq";
  }
}

function isOperatorish(token: Token): boolean {
  return token.kind === "operator" || token.kind === "word" && [
    "contains",
    "startswith",
    "endswith",
    "in",
    "exists",
    "missing",
  ].includes(token.text.toLowerCase());
}

function splitPath(value: string): ReadonlyArray<string> {
  return value.split(".").filter(Boolean);
}

function findExpressionStart(source: string, cursor: number): number {
  let index = cursor - 1;
  while (index >= 0) {
    const char = source[index] ?? "";
    if (char === "(" || char === ")" || char === "\n" || char === "\r") return index + 1;
    index -= 1;
  }
  return 0;
}

export function editPillSource(source: string, pill: ParsedPill, mutation: ParsedPill): {
  readonly source: string;
  readonly cursor: number;
} {
  const serialized = serialisePill(mutation);
  return {
    source: source.slice(0, pill.start) + serialized + source.slice(pill.end),
    cursor: pill.start + serialized.length,
  };
}

export function preferredTokenForPillOperator(
  operator: FilterOperator,
  negated: boolean,
  field: QueryField,
): string {
  return preferredTokenForOperator(operator, negated, field.kind);
}
