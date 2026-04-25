import type { FilterNode, FilterOperator } from "@lensflare/contracts";
import {
  type CursorContext,
  type FilterInputParseResult,
  type ParsedPill,
  type QueryField,
} from "./ast.ts";
import { compileQueryToFilter, resolveQueryField } from "./compiler.ts";
import { type Token } from "./lexer.ts";
import { analyzeQueryLanguage } from "./languageService.ts";
import { preferredTokenForOperator } from "./operators.ts";
import { serialisePill } from "./values.ts";

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
  const result = analyzeQueryLanguage(source, cursor, fields);

  return {
    ast: result.ast,
    tokens: result.tokens,
    diagnostics: result.diagnostics,
    pills: result.pills,
    trailingText: result.trailingText,
    trailingStart: result.trailingStart,
    cursorContext: result.cursorContext,
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
