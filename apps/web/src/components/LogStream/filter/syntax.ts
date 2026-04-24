import type { FilterNode, FilterOperator } from "@lensflare/contracts";

import type { TelemetryLogField } from "~/data/logApi";

import { buildFilterValue } from "./filterTypes";

/**
 * Tokeniser + AST adapter for the keyboard-first filter input. The input is
 * the user-typed string `source`; the output is a list of structured pills
 * ({field, operator, value}) plus the remaining free-typed tail that drives
 * the autocomplete dropdown.
 *
 * This module is intentionally free of React — the parser is pure so it can
 * be unit-tested and reused by any renderer. The AST produced by
 * `parsedToFilter` is the same wire shape consumed by the backend SQL
 * compiler.
 */

/** Field kinds that can be inferred purely from the shorthand token. */
type KindHint = "string" | "number" | "enum";

/**
 * Shorthand operators the user can type directly. Ordering matters only for
 * readability; token-length prioritisation during the scan is handled
 * explicitly in `TOKENS_BY_LENGTH`.
 */
export interface OperatorSyntax {
  readonly token: string;
  readonly operator: FilterOperator;
  /** When true, the produced `cmp` node is wrapped in a `not` before joining. */
  readonly negated: boolean;
  /** Which field kinds this token is idiomatic for — used for ambiguity
   *  resolution during cursor-context detection. */
  readonly kinds: ReadonlyArray<KindHint>;
  /** Human label shown in the suggestions list. */
  readonly label: string;
}

export const OPERATOR_SYNTAX: ReadonlyArray<OperatorSyntax> = [
  { token: ":", operator: "eq", negated: false, kinds: ["string", "enum"], label: "equals" },
  { token: "=", operator: "eq", negated: false, kinds: ["number"], label: "equals" },
  { token: "!:", operator: "ne", negated: false, kinds: ["string", "enum"], label: "does not equal" },
  { token: "!=", operator: "ne", negated: false, kinds: ["number"], label: "does not equal" },
  { token: "~", operator: "contains", negated: false, kinds: ["string"], label: "contains" },
  { token: "!~", operator: "contains", negated: true, kinds: ["string"], label: "does not contain" },
  { token: "^:", operator: "startsWith", negated: false, kinds: ["string"], label: "starts with" },
  { token: "$:", operator: "endsWith", negated: false, kinds: ["string"], label: "ends with" },
  { token: ">=", operator: "gte", negated: false, kinds: ["number"], label: "≥" },
  { token: "<=", operator: "lte", negated: false, kinds: ["number"], label: "≤" },
  { token: ">", operator: "gt", negated: false, kinds: ["number"], label: ">" },
  { token: "<", operator: "lt", negated: false, kinds: ["number"], label: "<" },
  { token: ":in:", operator: "in", negated: false, kinds: ["string", "number", "enum"], label: "is one of" },
  { token: ":notIn:", operator: "notIn", negated: false, kinds: ["string", "number", "enum"], label: "is none of" },
  { token: ":re:", operator: "matchesRegex", negated: false, kinds: ["string"], label: "matches regex" },
  { token: ":exists:", operator: "exists", negated: false, kinds: ["string", "number", "enum"], label: "exists" },
  { token: ":notExists:", operator: "notExists", negated: false, kinds: ["string", "number", "enum"], label: "does not exist" },
];

/**
 * Pre-sorted longest-first so the scanner can find the right token without
 * extra work. E.g. `!=` must win over `!` before `=`. Exported so consumers
 * that walk the operator table in the same longest-first order (e.g. the
 * suggestion splicer) don't have to re-sort per call.
 */
export const TOKENS_BY_LENGTH: ReadonlyArray<OperatorSyntax> = [...OPERATOR_SYNTAX].sort(
  (a, b) => b.token.length - a.token.length,
);

/** Characters that can appear as the *first* character of any operator token. */
const OPERATOR_LEAD_CHARS = new Set<string>(
  OPERATOR_SYNTAX.map((entry) => entry.token[0]).filter(
    (char): char is string => char !== undefined && char.length > 0,
  ),
);

const IDENT_START_RE = /[A-Za-z_]/;
const IDENT_BODY_RE = /[A-Za-z0-9_.-]/;

export interface ParsedPill {
  /** Field path as dot-split segments, e.g. `["attributes", "http", "status_code"]`. */
  readonly fieldPath: ReadonlyArray<string>;
  /** Raw token as typed (e.g. `":"`, `"!~"`). */
  readonly operatorToken: string;
  /** Resolved comparison operator. */
  readonly operator: FilterOperator;
  /** Whether the pill should be wrapped in a `not` node when materialising. */
  readonly negated: boolean;
  /** Value with quotes stripped and escapes decoded. */
  readonly rawValue: string;
  /** Whether the value appeared inside `"..."` in the source. */
  readonly valueWasQuoted: boolean;
  /** Start offset in `source` (inclusive). */
  readonly start: number;
  /** End offset in `source` (exclusive). */
  readonly end: number;
}

/**
 * Where the caret sits relative to the incomplete token the user is typing
 * in the `trailingText`. Used to pick what the suggestions dropdown shows.
 */
export type CursorContext =
  | { readonly kind: "field"; readonly prefix: string }
  | { readonly kind: "operator"; readonly fieldPath: ReadonlyArray<string>; readonly tokenPrefix: string }
  | {
      readonly kind: "value";
      readonly fieldPath: ReadonlyArray<string>;
      readonly operator: FilterOperator;
      readonly operatorToken: string;
      readonly negated: boolean;
      readonly valuePrefix: string;
    };

export interface ParseResult {
  readonly pills: ReadonlyArray<ParsedPill>;
  /** Everything after the last whitespace following the last committed pill. */
  readonly trailingText: string;
  /** Start offset of `trailingText` in the original `source`. */
  readonly trailingStart: number;
  readonly cursorContext: CursorContext;
}

/**
 * Tokenise `source` into a sequence of pills followed by whatever free text
 * remains on the right. The caller provides the caret position so the
 * `cursorContext` can be computed without a second pass.
 */
export function parseFilterInput(source: string, cursor: number): ParseResult {
  const pills: Array<ParsedPill> = [];
  let index = 0;
  const len = source.length;

  while (index < len) {
    // Skip whitespace between pills.
    while (index < len && isWhitespace(source[index] ?? "")) {
      index += 1;
    }
    if (index >= len) break;

    const segmentStart = index;
    const pill = tryReadPill(source, index);

    if (pill === null) {
      // Segment isn't a full structured pill — treat everything from here on
      // as trailing free text. We stop parsing further pills because the user
      // is clearly composing; anything after a partial token should drive
      // autocomplete, not be lost as a phantom pill.
      break;
    }

    // A pill must be followed by whitespace to be considered committed. If
    // the "pill" runs to EOF without trailing whitespace, the user is still
    // actively typing it — keep it in `trailingText` so the suggestion logic
    // can drive autocomplete on the value. This avoids the jarring UX where
    // a partial value flashes in and out of pill shape as characters arrive.
    const afterEnd = pill.end;
    if (afterEnd >= len || !isWhitespace(source[afterEnd] ?? "")) {
      index = segmentStart;
      break;
    }

    pills.push(pill);
    index = pill.end;
  }

  const trailingText = source.slice(index);
  const trailingStart = index;

  const clampedCursor = Math.max(trailingStart, Math.min(cursor, len));
  const localCursor = clampedCursor - trailingStart;
  const cursorContext = computeCursorContext(trailingText, localCursor);

  return { pills, trailingText, trailingStart, cursorContext };
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/**
 * Attempt to consume a full `<field><op><value>` pill starting at `index`.
 * Returns `null` if the segment doesn't fully parse — callers then treat the
 * remainder as `trailingText`.
 */
function tryReadPill(source: string, start: number): ParsedPill | null {
  const fieldRead = readIdentifier(source, start);
  if (fieldRead === null) return null;

  const opRead = readOperatorToken(source, fieldRead.end);
  if (opRead === null) return null;

  if (isValuelessOperator(opRead.syntax.operator)) {
    return {
      fieldPath: fieldRead.segments,
      operatorToken: opRead.syntax.token,
      operator: opRead.syntax.operator,
      negated: opRead.syntax.negated,
      rawValue: "",
      valueWasQuoted: false,
      start,
      end: opRead.end,
    };
  }

  const valueRead = readValue(source, opRead.end);
  if (valueRead === null) return null;

  // Values must have content (empty quoted `""` is accepted — explicit empty
  // match — but empty bareword is a partial, not a pill).
  if (!valueRead.wasQuoted && valueRead.value.length === 0) return null;

  return {
    fieldPath: fieldRead.segments,
    operatorToken: opRead.syntax.token,
    operator: opRead.syntax.operator,
    negated: opRead.syntax.negated,
    rawValue: valueRead.value,
    valueWasQuoted: valueRead.wasQuoted,
    start,
    end: valueRead.end,
  };
}

interface IdentifierRead {
  readonly segments: ReadonlyArray<string>;
  readonly end: number;
}

function readIdentifier(source: string, start: number): IdentifierRead | null {
  if (start >= source.length) return null;
  if (!IDENT_START_RE.test(source[start] ?? "")) return null;

  let end = start + 1;
  while (end < source.length && IDENT_BODY_RE.test(source[end] ?? "")) {
    end += 1;
  }

  const raw = source.slice(start, end);
  const segments = raw.split(".").filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;

  return { segments, end };
}

interface OperatorRead {
  readonly syntax: OperatorSyntax;
  readonly end: number;
}

function readOperatorToken(source: string, start: number): OperatorRead | null {
  for (const syntax of TOKENS_BY_LENGTH) {
    if (source.startsWith(syntax.token, start)) {
      return { syntax, end: start + syntax.token.length };
    }
  }
  return null;
}

interface ValueRead {
  readonly value: string;
  readonly wasQuoted: boolean;
  readonly end: number;
}

function readValue(source: string, start: number): ValueRead | null {
  if (start > source.length) return null;
  const first = source[start];
  if (first === undefined) return null;

  if (first === '"') {
    return readQuotedValue(source, start);
  }
  if (isWhitespace(first)) {
    return null;
  }
  return readBarewordValue(source, start);
}

function readQuotedValue(source: string, start: number): ValueRead | null {
  let i = start + 1;
  let value = "";
  while (i < source.length) {
    const char = source[i] ?? "";
    if (char === "\\") {
      const next = source[i + 1];
      if (next === '"' || next === "\\") {
        value += next;
        i += 2;
        continue;
      }
      // Unknown escape: keep the backslash verbatim.
      value += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      return { value, wasQuoted: true, end: i + 1 };
    }
    value += char;
    i += 1;
  }
  // Unterminated quoted string — not a pill.
  return null;
}

function readBarewordValue(source: string, start: number): ValueRead {
  let end = start;
  while (end < source.length && !isWhitespace(source[end] ?? "")) {
    end += 1;
  }
  return { value: source.slice(start, end), wasQuoted: false, end };
}

/**
 * Classify what the user is composing based on the substring of
 * `trailingText` left of the caret. The rule set is small:
 *   - no identifier at all → "field"
 *   - identifier, no operator yet → "field" (keeps suggesting fields while
 *     the user types the prefix)
 *   - identifier + partial operator chars → "operator"
 *   - identifier + operator → "value"
 */
function computeCursorContext(trailingText: string, cursor: number): CursorContext {
  const prefix = trailingText.slice(0, cursor);

  if (prefix.length === 0 || /\s$/.test(prefix)) {
    return { kind: "field", prefix: "" };
  }

  // If the last run of characters before the caret is pure whitespace after a
  // pill-shaped token (e.g. "level:info "), `trimStart` lands us on the next
  // field. Otherwise we work from the last whitespace boundary.
  const lastWsIndex = Math.max(
    prefix.lastIndexOf(" "),
    prefix.lastIndexOf("\t"),
    prefix.lastIndexOf("\n"),
    prefix.lastIndexOf("\r"),
  );
  const composing = prefix.slice(lastWsIndex + 1);

  if (composing.length === 0) {
    return { kind: "field", prefix: "" };
  }

  // Walk the composing chunk: identifier? operator? value?
  const identMatch = leadingIdentifier(composing);
  if (identMatch === null) {
    // No field yet — user is typing a name. Treat whatever they typed as a
    // field prefix even if the first char isn't `[A-Za-z_]` so the suggestion
    // list shows "no matches" instead of snapping to an unexpected context.
    return { kind: "field", prefix: composing };
  }

  if (identMatch.end === composing.length) {
    return { kind: "field", prefix: composing };
  }

  const afterIdent = composing.slice(identMatch.end);
  const opMatch = leadingOperator(afterIdent);

  if (opMatch === null) {
    // First char after ident isn't identifier-body and isn't operator-lead —
    // treat as field (unusual; e.g. user typed a stray space-less char).
    if (!OPERATOR_LEAD_CHARS.has(afterIdent[0] ?? "")) {
      return { kind: "field", prefix: composing };
    }
    // Starts with an operator char but doesn't match a known token yet.
    return {
      kind: "operator",
      fieldPath: splitIdent(identMatch.value),
      tokenPrefix: afterIdent,
    };
  }

  if (opMatch.end === afterIdent.length) {
    // They've typed exactly an operator token — moving into value.
    return {
      kind: "value",
      fieldPath: splitIdent(identMatch.value),
      operator: opMatch.syntax.operator,
      operatorToken: opMatch.syntax.token,
      negated: opMatch.syntax.negated,
      valuePrefix: "",
    };
  }

  const valuePrefix = normaliseValuePrefix(afterIdent.slice(opMatch.end));
  return {
    kind: "value",
    fieldPath: splitIdent(identMatch.value),
    operator: opMatch.syntax.operator,
    operatorToken: opMatch.syntax.token,
    negated: opMatch.syntax.negated,
    valuePrefix,
  };
}

interface LeadingIdentifier {
  readonly value: string;
  readonly end: number;
}

function leadingIdentifier(text: string): LeadingIdentifier | null {
  if (text.length === 0) return null;
  if (!IDENT_START_RE.test(text[0] ?? "")) return null;
  let end = 1;
  while (end < text.length && IDENT_BODY_RE.test(text[end] ?? "")) {
    end += 1;
  }
  return { value: text.slice(0, end), end };
}

function splitIdent(ident: string): ReadonlyArray<string> {
  return ident.split(".").filter((segment) => segment.length > 0);
}

function leadingOperator(text: string): { readonly syntax: OperatorSyntax; readonly end: number } | null {
  for (const syntax of TOKENS_BY_LENGTH) {
    if (text.startsWith(syntax.token)) {
      return { syntax, end: syntax.token.length };
    }
  }
  return null;
}

function normaliseValuePrefix(valuePrefix: string): string {
  if (!valuePrefix.startsWith('"')) {
    return valuePrefix;
  }

  let result = "";
  for (let index = 1; index < valuePrefix.length; index += 1) {
    const char = valuePrefix[index] ?? "";
    if (char === "\\") {
      const next = valuePrefix[index + 1];
      if (next === '"' || next === "\\") {
        result += next;
        index += 1;
        continue;
      }
    }
    if (char === '"') {
      break;
    }
    result += char;
  }
  return result;
}

/**
 * Serialise a pill back into the exact source shape the scanner accepts.
 * Used when pills are mutated via the dropdown editor and need to be spliced
 * back into `source`.
 */
export function serialisePill(pill: ParsedPill): string {
  const field = pill.fieldPath.join(".");
  if (isValuelessOperator(pill.operator)) {
    return `${field}${pill.operatorToken}`;
  }
  const value = pill.valueWasQuoted || needsQuoting(pill.rawValue)
    ? `"${escapeQuoted(pill.rawValue)}"`
    : pill.rawValue;
  return `${field}${pill.operatorToken}${value}`;
}

function needsQuoting(value: string): boolean {
  if (value.length === 0) return true;
  for (const char of value) {
    if (isWhitespace(char) || char === '"') return true;
  }
  return false;
}

function escapeQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Resolve a parsed pill against the known field catalog. Returns `null` when
 * the field path is unknown, in which case the caller drops the pill from
 * the committed filter (but can still render it with a warning badge in the
 * UI).
 */
export function resolvePillField(
  pill: ParsedPill,
  fields: ReadonlyArray<TelemetryLogField>,
): TelemetryLogField | null {
  const key = pill.fieldPath.join(".");
  for (const field of fields) {
    if (field.path.join(".") === key) return field;
    if (field.label === key) return field;
  }
  return null;
}

/**
 * Build a `FilterNode` (or `null` when empty) from the parser result. Uses
 * the field catalog to coerce raw string values into typed `FilterValue`s.
 * Unresolved pills are skipped — they stay visible in the UI but don't hit
 * the backend until the catalog catches up.
 */
export function parsedToFilter(
  result: ParseResult,
  fields: ReadonlyArray<TelemetryLogField>,
): FilterNode | null {
  const children: Array<FilterNode> = [];
  const pills = [...result.pills];
  const trailingPill = tryReadWholePill(result.trailingText);

  if (trailingPill !== null) {
    pills.push(trailingPill);
  }

  for (const pill of pills) {
    const field = resolvePillField(pill, fields);
    if (field === null) continue;

    if (isValuelessOperator(pill.operator)) {
      const cmp: FilterNode = {
        _tag: "cmp",
        field: {
          path: field.path as unknown as readonly [string, ...ReadonlyArray<string>],
        },
        op: pill.operator,
      };
      children.push(pill.negated ? { _tag: "not", child: cmp } : cmp);
      continue;
    }

    const value = buildFilterValue(field, pill.operator, pill.rawValue);
    if (value === undefined) continue;

    const cmp: FilterNode = {
      _tag: "cmp",
      field: {
        path: field.path as unknown as readonly [string, ...ReadonlyArray<string>],
      },
      op: pill.operator,
      value,
    };

    children.push(pill.negated ? { _tag: "not", child: cmp } : cmp);
  }

  const trailingTextNode = trailingTextToFilterNode(result);
  if (trailingTextNode !== null) {
    children.push(trailingTextNode);
  }

  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return { _tag: "and", children };
}

function tryReadWholePill(source: string): ParsedPill | null {
  const pill = tryReadPill(source, 0);
  if (pill === null) {
    return null;
  }
  return pill.end === source.length ? pill : null;
}

function trailingTextToFilterNode(result: ParseResult): FilterNode | null {
  const trimmed = result.trailingText.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (tryReadWholePill(result.trailingText) !== null) {
    return null;
  }

  switch (result.cursorContext.kind) {
    case "operator":
    case "value":
      return null;
    case "field":
      return { _tag: "text", query: trimmed, mode: "substring" };
  }
}

/**
 * Picks the default operator token for the given field kind. This is what
 * the input inserts after a field suggestion is accepted — `:` for text,
 * `=` for numbers — so users can immediately start typing the value.
 */
export function defaultOperatorTokenForKind(kind: TelemetryLogField["kind"]): string {
  if (kind === "number") return "=";
  return ":";
}

/**
 * Operators that can be expressed as a shorthand token on the given kind.
 * Used by the suggestions panel to render the operator hints.
 */
export function operatorSyntaxesForKind(
  kind: TelemetryLogField["kind"],
): ReadonlyArray<OperatorSyntax> {
  return OPERATOR_SYNTAX.filter((entry) => entry.kinds.includes(kind));
}

/**
 * Inverse of `defaultOperatorTokenForKind` for an existing pill — picks the
 * token we would serialise back into `source` when the operator changes via
 * the pill's dropdown. Falls back to `:` for operators without a shorthand.
 */
export function preferredTokenForOperator(
  operator: FilterOperator,
  negated: boolean,
  kind: TelemetryLogField["kind"],
): string {
  for (const entry of OPERATOR_SYNTAX) {
    if (entry.operator !== operator) continue;
    if (entry.negated !== negated) continue;
    if (entry.kinds.includes(kind)) return entry.token;
  }
  // Keep an equality fallback for any future operator added to the contract
  // before the query text grammar learns its source token.
  return ":";
}

function isValuelessOperator(operator: FilterOperator): boolean {
  return operator === "exists" || operator === "notExists";
}
