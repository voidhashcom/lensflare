import type { FilterOperator } from "@lensflare/contracts";
import {
  type CursorContext,
  type ParsedPill,
  type OperatorSyntax,
  type QueryDiagnostic,
  type QueryField,
  type QueryListCursorContext,
  type QueryNode,
  type SourceSpan,
} from "./ast.ts";
import { compileQueryToFilterResult, resolveQueryField } from "./compiler.ts";
import type { Token } from "./lexer.ts";
import {
  isValuelessOperator,
  LIST_OPERATORS,
  operatorSyntaxesForKind,
  syntaxForOperatorToken,
} from "./operators.ts";
import { parseQuery } from "./parser.ts";
import { literalToRawValue, parseListLiteral } from "./values.ts";

export type QueryCompletionKind = "field" | "operator" | "value";

export type QuerySemanticTokenKind =
  | "field"
  | "keyword"
  | "number"
  | "operator"
  | "punctuation"
  | "regex"
  | "string"
  | "text"
  | "value";

export interface QueryTextEdit {
  readonly range: SourceSpan;
  readonly newText: string;
  readonly cursorOffset: number;
}

export interface QueryCompletionItem {
  readonly kind: QueryCompletionKind;
  readonly label: string;
  readonly detail: string;
  readonly textEdit: QueryTextEdit;
  readonly field?: QueryField;
  readonly operatorSyntax?: OperatorSyntax;
  readonly value?: string;
}

export interface QuerySemanticToken {
  readonly kind: QuerySemanticTokenKind;
  readonly start: number;
  readonly end: number;
}

export interface QueryCursorState {
  readonly context: CursorContext;
  readonly replacementRange: SourceSpan;
  readonly expressionStart: number;
}

export interface QueryLanguageServiceResult {
  readonly ast: QueryNode | null;
  readonly tokens: ReadonlyArray<Token>;
  readonly diagnostics: ReadonlyArray<QueryDiagnostic>;
  readonly pills: ReadonlyArray<ParsedPill>;
  readonly cursorState: QueryCursorState;
  readonly cursorContext: CursorContext;
  readonly completions: ReadonlyArray<QueryCompletionItem>;
  readonly semanticTokens: ReadonlyArray<QuerySemanticToken>;
  readonly trailingText: string;
  readonly trailingStart: number;
}

interface OperatorRead {
  readonly syntax: OperatorSyntax;
  readonly start: number;
  readonly end: number;
  readonly tokenText: string;
}

export function analyzeQueryLanguage(
  source: string,
  cursor: number,
  fields: ReadonlyArray<QueryField> = [],
): QueryLanguageServiceResult {
  const parse = parseQuery(source);
  const pills = parse.ast === null ? [] : collectPills(parse.ast, source);
  const cursorState = getQueryCursorState(source, cursor, parse.tokens, fields);
  const lastPill = pills.at(-1);
  const isMissingValueContext =
    cursorState.context.kind === "value" && cursorState.context.valuePrefix.length === 0;
  const trailingStart =
    lastPill !== undefined && cursor >= lastPill.end && !isMissingValueContext
      ? lastPill.end
      : cursorState.expressionStart;
  const compileDiagnostics =
    fields.length > 0 ? compileQueryToFilterResult(parse.ast, fields).diagnostics : [];

  return {
    ast: parse.ast,
    tokens: parse.tokens,
    diagnostics: [...parse.diagnostics, ...compileDiagnostics],
    pills,
    cursorState,
    cursorContext: cursorState.context,
    completions: getQueryCompletions(source, cursorState, fields),
    semanticTokens: getQuerySemanticTokens(source, parse.tokens, parse.ast),
    trailingText: source.slice(trailingStart),
    trailingStart,
  };
}

export function applyQueryCompletion(
  source: string,
  completion: QueryCompletionItem,
): { readonly source: string; readonly cursor: number } {
  const { range, newText, cursorOffset } = completion.textEdit;
  return {
    source: source.slice(0, range.start) + newText + source.slice(range.end),
    cursor: range.start + cursorOffset,
  };
}

export function getQueryCursorState(
  source: string,
  cursor: number,
  tokens: ReadonlyArray<Token>,
  fields: ReadonlyArray<QueryField> = [],
): QueryCursorState {
  const clamped = clamp(cursor, 0, source.length);
  const expressionStart = findCurrentExpressionStart(source, clamped, tokens, fields);
  const expressionTokens = tokens.filter((token) => token.span.end > expressionStart);
  const segment = tokens.filter(
    (token) => token.span.end > expressionStart && token.span.start <= clamped,
  );
  const fallbackRange = { start: clamped, end: clamped };

  if (segment.length === 0) {
    return {
      context: { kind: "field", prefix: "" },
      replacementRange: fallbackRange,
      expressionStart,
    };
  }

  const first = segment[0];
  if (first?.kind !== "word") {
    return {
      context: { kind: "field", prefix: "" },
      replacementRange: fallbackRange,
      expressionStart,
    };
  }

  const fieldRange = clampRange({ start: first.span.start, end: clamped }, first.span);
  if (segment.length === 1) {
    if (clamped <= first.span.end && !isCursorAfterWhitespace(source, clamped)) {
      return {
        context: { kind: "field", prefix: source.slice(first.span.start, clamped) },
        replacementRange: fieldRange,
        expressionStart,
      };
    }
    return {
      context: { kind: "operator", fieldPath: splitPath(first.text), tokenPrefix: "" },
      replacementRange: fallbackRange,
      expressionStart,
    };
  }

  const operator = readOperator(segment);
  if (operator === null) {
    const second = segment[1];
    const range = second === undefined ? fallbackRange : { start: second.span.start, end: clamped };
    return {
      context: {
        kind: "operator",
        fieldPath: splitPath(first.text),
        tokenPrefix: second === undefined ? "" : source.slice(second.span.start, clamped),
      },
      replacementRange: range,
      expressionStart,
    };
  }

  if (isValuelessOperator(operator.syntax.operator)) {
    if (clamped < operator.end) {
      return {
        context: {
          kind: "operator",
          fieldPath: splitPath(first.text),
          tokenPrefix: source.slice(operator.start, clamped),
        },
        replacementRange: { start: operator.start, end: clamped },
        expressionStart,
      };
    }
    return {
      context: { kind: "field", prefix: "" },
      replacementRange: fallbackRange,
      expressionStart,
    };
  }

  if (isCursorAfterWhitespace(source, clamped) && isCompleteSegment(segment, fields)) {
    return {
      context: { kind: "field", prefix: "" },
      replacementRange: fallbackRange,
      expressionStart,
    };
  }

  const value = readValuePrefix(
    source,
    clamped,
    segment,
    expressionTokens,
    operator.end,
    operator.syntax.operator,
  );
  return {
    context: {
      kind: "value",
      fieldPath: splitPath(first.text),
      operator: operator.syntax.operator,
      operatorToken: operator.tokenText,
      negated: operator.syntax.negated,
      valuePrefix: value.prefix,
      ...(value.list === undefined ? {} : { list: value.list }),
    },
    replacementRange: value.replacementRange,
    expressionStart,
  };
}

export function getQueryCompletions(
  source: string,
  cursorState: QueryCursorState,
  fields: ReadonlyArray<QueryField>,
): ReadonlyArray<QueryCompletionItem> {
  switch (cursorState.context.kind) {
    case "field":
      return fieldCompletions(cursorState, fields);
    case "operator":
      return operatorCompletions(cursorState, fields);
    case "value":
      return valueCompletions(source, cursorState, fields);
  }
}

export function getQuerySemanticTokens(
  source: string,
  tokens: ReadonlyArray<Token>,
  ast: QueryNode | null,
): ReadonlyArray<QuerySemanticToken> {
  const semanticTokens = tokens.map(
    (token): QuerySemanticToken => ({
      kind: semanticKindForToken(token),
      start: token.span.start,
      end: token.span.end,
    }),
  );

  if (ast !== null) {
    appendAstSemanticTokens(source, ast, semanticTokens);
  }

  return semanticTokens.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function collectPills(ast: QueryNode, source: string): ReadonlyArray<ParsedPill> {
  const pills: Array<ParsedPill> = [];
  visitPills(ast, pills, source);
  return pills.sort((left, right) => left.start - right.start);
}

function fieldCompletions(
  cursorState: QueryCursorState,
  fields: ReadonlyArray<QueryField>,
): ReadonlyArray<QueryCompletionItem> {
  if (cursorState.context.kind !== "field") return [];
  const needle = cursorState.context.prefix.trim().toLowerCase();
  const matches =
    needle.length === 0 ? fields : fields.filter((field) => fieldMatchesPrefix(field, needle));

  return matches.map((field): QueryCompletionItem => {
    const path = field.path.join(".");
    const newText = `${path} `;
    return {
      kind: "field",
      label: field.label,
      detail: `${field.kind} field`,
      field,
      textEdit: {
        range: cursorState.replacementRange,
        newText,
        cursorOffset: newText.length,
      },
    };
  });
}

function operatorCompletions(
  cursorState: QueryCursorState,
  fields: ReadonlyArray<QueryField>,
): ReadonlyArray<QueryCompletionItem> {
  if (cursorState.context.kind !== "operator") return [];
  const field = resolveQueryField(
    cursorState.context.fieldPath.join("."),
    fields,
    cursorState.replacementRange,
  );
  const kind = field?.kind ?? "string";
  const prefix = cursorState.context.tokenPrefix.toLowerCase();

  return operatorSyntaxesForKind(kind)
    .filter((syntax) => syntax.token.toLowerCase().startsWith(prefix))
    .map((syntax): QueryCompletionItem => {
      const needsList = LIST_OPERATORS.includes(syntax.operator);
      const newText = needsList ? `${syntax.token} []` : `${syntax.token} `;
      return {
        kind: "operator",
        label: syntax.token,
        detail: syntax.label,
        operatorSyntax: syntax,
        textEdit: {
          range: cursorState.replacementRange,
          newText,
          cursorOffset: needsList ? newText.length - 1 : newText.length,
        },
      };
    });
}

function valueCompletions(
  _source: string,
  cursorState: QueryCursorState,
  fields: ReadonlyArray<QueryField>,
): ReadonlyArray<QueryCompletionItem> {
  if (cursorState.context.kind !== "value") return [];
  const field = resolveQueryField(
    cursorState.context.fieldPath.join("."),
    fields,
    cursorState.replacementRange,
  );
  if (field?.values === undefined || field.values.length === 0) return [];
  const needle = cursorState.context.valuePrefix.trim().toLowerCase();

  return field.values
    .filter((value) => needle.length === 0 || value.toLowerCase().includes(needle))
    .map((value): QueryCompletionItem => {
      const newText = `${quoteCompletionValue(value)} `;
      return {
        kind: "value",
        label: value,
        detail: `${field.label} value`,
        value,
        textEdit: {
          range: cursorState.replacementRange,
          newText,
          cursorOffset: newText.length,
        },
      };
    });
}

function quoteCompletionValue(value: string): string {
  if (value.length === 0) return '""';
  if (/[\s",()[\]]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function fieldMatchesPrefix(field: QueryField, needle: string): boolean {
  return (
    field.label.toLowerCase().includes(needle) ||
    field.path.join(".").toLowerCase().includes(needle) ||
    field.id?.toLowerCase().includes(needle) === true
  );
}

function findCurrentExpressionStart(
  source: string,
  cursor: number,
  tokens: ReadonlyArray<Token>,
  fields: ReadonlyArray<QueryField>,
): number {
  let expressionStart = previousHardBoundary(source, cursor);
  const prior = tokens.filter((token) => token.span.end <= cursor);

  for (let index = 0; index < prior.length; index += 1) {
    const token = prior[index];
    if (token === undefined || token.span.start < expressionStart) continue;
    if (isLogicalBoundary(prior, index, expressionStart, fields)) {
      expressionStart = token.span.end;
      continue;
    }
    const segmentBefore = tokens.filter(
      (candidate) => candidate.span.end > expressionStart && candidate.span.end <= token.span.start,
    );
    const segmentEnd = segmentBefore.at(-1)?.span.end;
    if (
      segmentEnd !== undefined &&
      segmentEnd < token.span.start &&
      !hasUnclosedList(segmentBefore) &&
      isCompleteSegment(segmentBefore, fields)
    ) {
      expressionStart = token.span.start;
    }
    if (token.kind === "lparen" || token.kind === "rparen") {
      expressionStart = token.span.end;
      continue;
    }
  }

  return expressionStart;
}

function hasUnclosedList(tokens: ReadonlyArray<Token>): boolean {
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === "lbracket") depth += 1;
    if (token.kind === "rbracket") depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

function previousHardBoundary(source: string, cursor: number): number {
  let index = cursor - 1;
  while (index >= 0) {
    const char = source[index] ?? "";
    if (char === "\n" || char === "\r") return index + 1;
    index -= 1;
  }
  return 0;
}

function isLogicalBoundary(
  tokens: ReadonlyArray<Token>,
  index: number,
  expressionStart: number,
  fields: ReadonlyArray<QueryField>,
): boolean {
  const token = tokens[index];
  if (token?.kind !== "word") return false;
  const lower = token.text.toLowerCase();
  if (lower !== "and" && lower !== "or") return false;
  const segment = tokens.filter(
    (candidate) => candidate.span.end > expressionStart && candidate.span.end <= token.span.start,
  );
  return isCompleteSegment(segment, fields);
}

function isCompleteSegment(
  segment: ReadonlyArray<Token>,
  fields: ReadonlyArray<QueryField>,
): boolean {
  const first = segment[0];
  if (first === undefined) return false;
  if (segment.length === 1) {
    return first.kind !== "word" || resolveQueryField(first.text, fields, first.span) === null;
  }
  if (first.kind !== "word") return true;
  const operator = readOperator(segment);
  if (operator === null) return true;
  return (
    isValuelessOperator(operator.syntax.operator) ||
    segment.some((token) => token.span.start >= operator.end && isValueToken(token))
  );
}

function readOperator(segment: ReadonlyArray<Token>): OperatorRead | null {
  const second = segment[1];
  if (second === undefined) return null;
  if (second.kind === "operator") {
    const syntax = syntaxForOperatorToken(second.text);
    if (syntax === undefined) return null;
    return { syntax, start: second.span.start, end: second.span.end, tokenText: second.text };
  }
  if (second.kind !== "word") return null;

  const lower = second.text.toLowerCase();
  if (lower === "not") {
    const third = segment[2];
    if (third?.kind === "word" && third.text.toLowerCase() === "in") {
      const syntax = syntaxForOperatorToken("not in");
      return syntax === undefined
        ? null
        : { syntax, start: second.span.start, end: third.span.end, tokenText: "not in" };
    }
    return null;
  }

  const syntax = syntaxForOperatorToken(canonicalOperatorToken(lower));
  return syntax === undefined
    ? null
    : { syntax, start: second.span.start, end: second.span.end, tokenText: second.text };
}

function canonicalOperatorToken(lower: string): string {
  switch (lower) {
    case "startswith":
      return "startsWith";
    case "endswith":
      return "endsWith";
    default:
      return lower;
  }
}

function readValuePrefix(
  source: string,
  cursor: number,
  segment: ReadonlyArray<Token>,
  expressionTokens: ReadonlyArray<Token>,
  operatorEnd: number,
  operator: FilterOperator,
): {
  readonly prefix: string;
  readonly replacementRange: SourceSpan;
  readonly list?: QueryListCursorContext;
} {
  if (LIST_OPERATORS.includes(operator)) {
    const list = readListValuePrefix(source, cursor, segment, expressionTokens, operatorEnd);
    if (list !== null) return list;
  }

  const valueTokens = segment.filter(
    (token) => token.span.start >= operatorEnd && token.span.start <= cursor,
  );
  const last = valueTokens.at(-1);
  if (last === undefined || last.kind === "lbracket" || last.kind === "comma") {
    return { prefix: "", replacementRange: { start: cursor, end: cursor } };
  }
  if (last.kind === "rbracket") {
    return { prefix: "", replacementRange: { start: last.span.end, end: last.span.end } };
  }
  if (last.kind === "string") {
    const start = source[last.span.start] === '"' ? last.span.start + 1 : last.span.start;
    const hasClosingQuote = source[last.span.end - 1] === '"';
    const prefixEnd = clamp(cursor, start, hasClosingQuote ? last.span.end - 1 : last.span.end);
    return {
      prefix: source.slice(start, prefixEnd),
      replacementRange: last.span,
    };
  }

  const start = last.span.start;
  const end = clamp(cursor, start, last.span.end);
  return {
    prefix: source.slice(start, end),
    replacementRange: { start, end },
  };
}

function readListValuePrefix(
  source: string,
  cursor: number,
  segment: ReadonlyArray<Token>,
  expressionTokens: ReadonlyArray<Token>,
  operatorEnd: number,
): {
  readonly prefix: string;
  readonly replacementRange: SourceSpan;
  readonly list: QueryListCursorContext;
} | null {
  const visibleValueTokens = segment.filter((token) => token.span.start >= operatorEnd);
  const valueTokens = expressionTokens.filter((token) => token.span.start >= operatorEnd);
  const open = [...visibleValueTokens]
    .reverse()
    .find((token) => token.kind === "lbracket" && token.span.end <= cursor);
  if (open === undefined) return null;

  const close = valueTokens.find(
    (token) => token.kind === "rbracket" && token.span.start >= open.span.end,
  );
  const contentEnd = close?.span.start ?? source.length;
  const boundedCursor = clamp(cursor, open.span.end, contentEnd);
  const itemRange = currentListItemRange(source, open.span.end, boundedCursor);
  const content = source.slice(open.span.end, contentEnd);
  return {
    prefix: source.slice(itemRange.start, itemRange.end).replace(/^"/, "").replace(/"$/, ""),
    replacementRange: itemRange,
    list: {
      range: { start: open.span.start, end: close?.span.end ?? contentEnd },
      values: parseListLiteral(content),
      itemRange,
    },
  };
}

function currentListItemRange(source: string, contentStart: number, cursor: number): SourceSpan {
  let start = contentStart;
  let index = contentStart;
  let inQuote = false;

  while (index < cursor) {
    const char = source[index] ?? "";
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
      start = index + 1;
    }
    index += 1;
  }

  while (start < cursor && /\s/.test(source[start] ?? "")) start += 1;
  let end = cursor;
  while (end > start && /\s/.test(source[end - 1] ?? "")) end -= 1;
  return { start, end };
}

function isValueToken(token: Token): boolean {
  return (
    token.kind === "word" ||
    token.kind === "string" ||
    token.kind === "number" ||
    token.kind === "regex" ||
    token.kind === "lbracket"
  );
}

function isCursorAfterWhitespace(source: string, cursor: number): boolean {
  return cursor > 0 && /\s/.test(source[cursor - 1] ?? "");
}

function splitPath(value: string): ReadonlyArray<string> {
  return value.split(".").filter(Boolean);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function clampRange(range: SourceSpan, bounds: SourceSpan): SourceSpan {
  return {
    start: clamp(range.start, bounds.start, bounds.end),
    end: clamp(range.end, bounds.start, bounds.end),
  };
}

function visitPills(node: QueryNode, pills: Array<ParsedPill>, source: string): void {
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
      for (const child of node.children) visitPills(child, pills, source);
      return;
    case "not":
    case "group":
      visitPills(node.child, pills, source);
      return;
    case "text":
      return;
  }
}

function trimSpan(source: string, span: SourceSpan): SourceSpan {
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

function semanticKindForToken(token: Token): QuerySemanticTokenKind {
  switch (token.kind) {
    case "operator":
      return "operator";
    case "string":
      return "string";
    case "number":
      return "number";
    case "regex":
      return "regex";
    case "lparen":
    case "rparen":
    case "lbracket":
    case "rbracket":
    case "comma":
      return "punctuation";
    case "word": {
      const lower = token.text.toLowerCase();
      return lower === "and" || lower === "or" || lower === "not" ? "keyword" : "text";
    }
  }
}

function appendAstSemanticTokens(
  source: string,
  node: QueryNode,
  semanticTokens: Array<QuerySemanticToken>,
): void {
  switch (node.kind) {
    case "comparison": {
      semanticTokens.push({
        kind: "field",
        start: node.field.span.start,
        end: node.field.span.end,
      });
      const operatorSpan = trimSpan(source, {
        start: node.field.span.end,
        end: node.value.span.start,
      });
      semanticTokens.push({ kind: "operator", start: operatorSpan.start, end: operatorSpan.end });
      semanticTokens.push({
        kind: "value",
        start: node.value.span.start,
        end: node.value.span.end,
      });
      return;
    }
    case "exists": {
      semanticTokens.push({
        kind: "field",
        start: node.field.span.start,
        end: node.field.span.end,
      });
      const operatorSpan = trimSpan(source, {
        start: node.field.span.end,
        end: node.span.end,
      });
      semanticTokens.push({ kind: "operator", start: operatorSpan.start, end: operatorSpan.end });
      return;
    }
    case "text":
      semanticTokens.push({ kind: "text", start: node.span.start, end: node.span.end });
      return;
    case "and":
    case "or":
      for (const child of node.children) appendAstSemanticTokens(source, child, semanticTokens);
      return;
    case "not":
    case "group":
      appendAstSemanticTokens(source, node.child, semanticTokens);
      return;
  }
}
