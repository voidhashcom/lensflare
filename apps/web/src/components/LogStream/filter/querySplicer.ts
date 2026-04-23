import type { TelemetryLogField } from "~/data/logApi";

import {
  defaultOperatorTokenForKind,
  TOKENS_BY_LENGTH,
  type OperatorSyntax,
} from "./syntax";

/**
 * Shared splicing helpers for the keyboard-first filter input. Each function
 * derives a `{ source, cursor }` tuple representing the new text buffer +
 * caret position after accepting a suggestion. Kept out of
 * `FilterQueryInput.tsx` so the rules are pure, testable in isolation, and
 * not entangled with the component's React state.
 */

export interface SpliceResult {
  readonly source: string;
  readonly cursor: number;
}

export interface SpliceContext {
  readonly source: string;
  readonly trailingStart: number;
  readonly trailingText: string;
}

/**
 * Accept a field suggestion: replace the composing field prefix with
 * `<field><default-op>` so the caret lands at the value position.
 */
export function applyFieldSuggestion(
  ctx: SpliceContext,
  field: TelemetryLogField,
): SpliceResult {
  const token = defaultOperatorTokenForKind(field.kind);
  const pathString = field.path.join(".");
  const wsIdx = findLastWhitespace(ctx.trailingText);
  const keepBefore = ctx.trailingText.slice(0, wsIdx + 1);
  const inserted = `${pathString}${token}`;
  const nextTrailing = keepBefore + inserted;
  const nextSource = ctx.source.slice(0, ctx.trailingStart) + nextTrailing;
  return { source: nextSource, cursor: ctx.trailingStart + nextTrailing.length };
}

/**
 * Accept an operator suggestion: extend the existing ident with the chosen
 * operator token. Returns `null` when the composing chunk doesn't start with
 * an identifier (no-op defensive guard — should not happen in practice since
 * the parser only produces "operator" cursor contexts when an ident exists).
 */
export function applyOperatorSuggestion(
  ctx: SpliceContext,
  syntax: OperatorSyntax,
): SpliceResult | null {
  const wsIdx = findLastWhitespace(ctx.trailingText);
  const keepBefore = ctx.trailingText.slice(0, wsIdx + 1);
  const composing = ctx.trailingText.slice(wsIdx + 1);
  const ident = extractLeadingIdent(composing);
  if (ident.length === 0) return null;
  const nextTrailing = keepBefore + ident + syntax.token;
  const nextSource = ctx.source.slice(0, ctx.trailingStart) + nextTrailing;
  return { source: nextSource, cursor: ctx.trailingStart + nextTrailing.length };
}

/**
 * Accept a value suggestion: replace the composing value prefix with the
 * chosen value and append a trailing space so the parser promotes the
 * segment to a full pill on the next parse. Returns `null` when the
 * composing chunk doesn't have a `<ident><op>` prefix to attach to.
 */
export function applyValueSuggestion(
  ctx: SpliceContext,
  value: string,
): SpliceResult | null {
  const wsIdx = findLastWhitespace(ctx.trailingText);
  const keepBefore = ctx.trailingText.slice(0, wsIdx + 1);
  const composing = ctx.trailingText.slice(wsIdx + 1);
  const ident = extractLeadingIdent(composing);
  if (ident.length === 0) return null;
  const rest = composing.slice(ident.length);
  const op = extractLeadingOperator(rest);
  if (op === null) return null;
  const quotedValue = quoteValueIfNeeded(value);
  const nextTrailing = `${keepBefore}${ident}${op.token}${quotedValue} `;
  const nextSource = ctx.source.slice(0, ctx.trailingStart) + nextTrailing;
  return { source: nextSource, cursor: ctx.trailingStart + nextTrailing.length };
}

/** Index of the last whitespace character in `text`, or `-1` if none. */
export function findLastWhitespace(text: string): number {
  return Math.max(
    text.lastIndexOf(" "),
    text.lastIndexOf("\t"),
    text.lastIndexOf("\n"),
    text.lastIndexOf("\r"),
  );
}

/** Greedy identifier match using the same grammar as the parser. */
export function extractLeadingIdent(text: string): string {
  const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(text);
  return match ? match[0] : "";
}

/** Longest-first operator match; uses the shared table from `syntax.ts`. */
export function extractLeadingOperator(text: string): { token: string } | null {
  for (const entry of TOKENS_BY_LENGTH) {
    if (text.startsWith(entry.token)) return { token: entry.token };
  }
  return null;
}

/**
 * Wrap `value` in double quotes when the bareword form would be ambiguous —
 * anything with whitespace, quotes, or an empty string needs quoting so the
 * parser consumes the whole value rather than treating the first space as a
 * pill boundary.
 */
export function quoteValueIfNeeded(value: string): string {
  if (value.length === 0) return '""';
  if (/[\s"]/.test(value)) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}
