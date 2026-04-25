import type { QueryField, QueryListCursorContext } from "./ast.ts";
import type { OperatorSyntax } from "./ast.ts";
import { LIST_OPERATORS, syntaxForOperatorToken, TOKENS_BY_LENGTH } from "./operators.ts";

export interface SpliceResult {
  readonly source: string;
  readonly cursor: number;
}

export interface SpliceContext {
  readonly source: string;
  readonly trailingStart: number;
  readonly trailingText: string;
}

export function applyFieldSuggestion(ctx: SpliceContext, field: QueryField): SpliceResult {
  const pathString = field.path.join(".");
  const expressionStart = findReplacementStart(ctx.trailingText);
  const keepBefore = ctx.trailingText.slice(0, expressionStart);
  const composing = readComposingIdent(ctx.trailingText.slice(expressionStart));
  const inserted = `${pathString} `;
  const nextTrailing = keepBefore + composing.leadingWhitespace + inserted;
  const nextSource = ctx.source.slice(0, ctx.trailingStart) + nextTrailing;
  const cursorOffset = nextTrailing.length;
  return { source: nextSource, cursor: ctx.trailingStart + cursorOffset };
}

export function applyOperatorSuggestion(
  ctx: SpliceContext,
  syntax: OperatorSyntax,
): SpliceResult | null {
  const expressionStart = findReplacementStart(ctx.trailingText);
  const keepBefore = ctx.trailingText.slice(0, expressionStart);
  const composing = ctx.trailingText.slice(expressionStart);
  const head = readComposingIdent(composing);
  if (head.ident.length === 0) return null;
  const inserted = LIST_OPERATORS.includes(syntax.operator)
    ? `${syntax.token} []`
    : `${syntax.token} `;
  const nextTrailing = `${keepBefore}${head.leadingWhitespace}${head.ident} ${inserted}`;
  const nextSource = ctx.source.slice(0, ctx.trailingStart) + nextTrailing;
  return {
    source: nextSource,
    cursor:
      ctx.trailingStart + nextTrailing.length - (LIST_OPERATORS.includes(syntax.operator) ? 1 : 0),
  };
}

export function applyValueSuggestion(ctx: SpliceContext, value: string): SpliceResult | null {
  const expressionStart = findReplacementStart(ctx.trailingText);
  const keepBefore = ctx.trailingText.slice(0, expressionStart);
  const composing = ctx.trailingText.slice(expressionStart);
  const head = readComposingIdent(composing);
  if (head.ident.length === 0) return null;
  const afterIdent = head.afterIdent.trimStart();
  const op = extractLeadingOperator(afterIdent);
  if (op === null) return null;
  const quotedValue = quoteValueIfNeeded(value);
  const syntax = syntaxForOperatorToken(op.token);
  const valueSource =
    syntax !== undefined && LIST_OPERATORS.includes(syntax.operator)
      ? `[${quotedValue}] `
      : `${quotedValue} `;
  const nextTrailing = `${keepBefore}${head.leadingWhitespace}${head.ident} ${op.token} ${valueSource}`;
  const nextSource = ctx.source.slice(0, ctx.trailingStart) + nextTrailing;
  return { source: nextSource, cursor: ctx.trailingStart + nextTrailing.length };
}

export function toggleListValueSuggestion(
  source: string,
  list: QueryListCursorContext,
  value: string,
): SpliceResult {
  const nextValues = list.values.includes(value)
    ? list.values.filter((item) => item !== value)
    : [...list.values, value];
  const listSource = `[${nextValues.map(quoteValueIfNeeded).join(", ")}]`;
  const nextSource = source.slice(0, list.range.start) + listSource + source.slice(list.range.end);
  return {
    source: nextSource,
    cursor: list.range.start + listSource.length - 1,
  };
}

function readComposingIdent(text: string): {
  readonly leadingWhitespace: string;
  readonly ident: string;
  readonly afterIdent: string;
} {
  const match = /^(\s*)([A-Za-z_][A-Za-z0-9_.-]*)(.*)$/s.exec(text);
  return match === null
    ? { leadingWhitespace: /^\s*/.exec(text)?.[0] ?? "", ident: "", afterIdent: "" }
    : {
        leadingWhitespace: match[1] ?? "",
        ident: match[2] ?? "",
        afterIdent: match[3] ?? "",
      };
}

function findReplacementStart(text: string): number {
  return Math.max(
    text.lastIndexOf("(") + 1,
    text.lastIndexOf(")") + 1,
    text.lastIndexOf("\n") + 1,
    text.lastIndexOf("\r") + 1,
  );
}

export function findLastWhitespace(text: string): number {
  return Math.max(
    text.lastIndexOf(" "),
    text.lastIndexOf("\t"),
    text.lastIndexOf("\n"),
    text.lastIndexOf("\r"),
  );
}

export function extractLeadingIdent(text: string): string {
  const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(text.trimStart());
  return match ? match[0] : "";
}

export function extractLeadingOperator(text: string): { readonly token: string } | null {
  const trimmed = text.trimStart();
  for (const entry of TOKENS_BY_LENGTH) {
    if (trimmed.toLowerCase().startsWith(entry.token.toLowerCase())) {
      return { token: entry.token };
    }
  }
  return null;
}

export function quoteValueIfNeeded(value: string): string {
  if (value.length === 0) return '""';
  if (/[\s",()[\]]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}
