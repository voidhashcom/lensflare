import type { QueryField } from "./ast.ts";
import type { OperatorSyntax } from "./ast.ts";
import { defaultOperatorTokenForKind, TOKENS_BY_LENGTH } from "./operators.ts";

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
  const token = defaultOperatorTokenForKind(field.kind);
  const pathString = field.path.join(".");
  const expressionStart = findReplacementStart(ctx.trailingText);
  const keepBefore = ctx.trailingText.slice(0, expressionStart);
  const inserted = field.kind === "number"
    ? `${pathString} ${token} `
    : `${pathString} ${token} ""`;
  const nextTrailing = keepBefore + inserted;
  const nextSource = ctx.source.slice(0, ctx.trailingStart) + nextTrailing;
  const cursorOffset = field.kind === "number" ? nextTrailing.length : nextTrailing.length - 1;
  return { source: nextSource, cursor: ctx.trailingStart + cursorOffset };
}

export function applyOperatorSuggestion(
  ctx: SpliceContext,
  syntax: OperatorSyntax,
): SpliceResult | null {
  const expressionStart = findReplacementStart(ctx.trailingText);
  const keepBefore = ctx.trailingText.slice(0, expressionStart);
  const composing = ctx.trailingText.slice(expressionStart);
  const ident = extractLeadingIdent(composing);
  if (ident.length === 0) return null;
  const nextTrailing = `${keepBefore}${ident} ${syntax.token} `;
  const nextSource = ctx.source.slice(0, ctx.trailingStart) + nextTrailing;
  return { source: nextSource, cursor: ctx.trailingStart + nextTrailing.length };
}

export function applyValueSuggestion(ctx: SpliceContext, value: string): SpliceResult | null {
  const expressionStart = findReplacementStart(ctx.trailingText);
  const keepBefore = ctx.trailingText.slice(0, expressionStart);
  const composing = ctx.trailingText.slice(expressionStart);
  const ident = extractLeadingIdent(composing);
  if (ident.length === 0) return null;
  const afterIdent = composing.slice(ident.length).trimStart();
  const op = extractLeadingOperator(afterIdent);
  if (op === null) return null;
  const quotedValue = quoteValueIfNeeded(value);
  const nextTrailing = `${keepBefore}${ident} ${op.token} ${quotedValue} `;
  const nextSource = ctx.source.slice(0, ctx.trailingStart) + nextTrailing;
  return { source: nextSource, cursor: ctx.trailingStart + nextTrailing.length };
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
