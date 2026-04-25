import type { QueryDiagnostic, SourceSpan } from "./ast.ts";

export type TokenKind =
  | "word"
  | "string"
  | "number"
  | "regex"
  | "operator"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "comma";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly raw: string;
  readonly span: SourceSpan;
}

export interface LexResult {
  readonly tokens: ReadonlyArray<Token>;
  readonly diagnostics: ReadonlyArray<QueryDiagnostic>;
}

const SYMBOL_OPERATORS = [">=", "<=", "!=", "~=", "=", ">", "<", "!"] as const;

export function lexQuery(source: string): LexResult {
  const tokens: Array<Token> = [];
  const diagnostics: Array<QueryDiagnostic> = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? "";
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const punct = punctuationToken(char, index);
    if (punct !== null) {
      tokens.push(punct);
      index += 1;
      continue;
    }

    if (char === '"') {
      const read = readQuotedString(source, index);
      tokens.push(read.token);
      diagnostics.push(...read.diagnostics);
      index = read.token.span.end;
      continue;
    }

    if (char === "/") {
      const read = readRegex(source, index);
      tokens.push(read.token);
      diagnostics.push(...read.diagnostics);
      index = read.token.span.end;
      continue;
    }

    const operator = readSymbolOperator(source, index);
    if (operator !== null) {
      tokens.push(operator);
      index = operator.span.end;
      continue;
    }

    if (isNumberStart(source, index)) {
      const token = readNumber(source, index);
      tokens.push(token);
      index = token.span.end;
      continue;
    }

    const word = readWord(source, index);
    if (word !== null) {
      tokens.push(word);
      index = word.span.end;
      continue;
    }

    diagnostics.push({
      severity: "error",
      message: `Unexpected character '${char}'.`,
      span: { start: index, end: index + 1 },
    });
    index += 1;
  }

  return { tokens, diagnostics };
}

function punctuationToken(char: string, index: number): Token | null {
  switch (char) {
    case "(":
      return { kind: "lparen", text: char, raw: char, span: { start: index, end: index + 1 } };
    case ")":
      return { kind: "rparen", text: char, raw: char, span: { start: index, end: index + 1 } };
    case "[":
      return { kind: "lbracket", text: char, raw: char, span: { start: index, end: index + 1 } };
    case "]":
      return { kind: "rbracket", text: char, raw: char, span: { start: index, end: index + 1 } };
    case ",":
      return { kind: "comma", text: char, raw: char, span: { start: index, end: index + 1 } };
    default:
      return null;
  }
}

function readQuotedString(
  source: string,
  start: number,
): { readonly token: Token; readonly diagnostics: ReadonlyArray<QueryDiagnostic> } {
  let value = "";
  let index = start + 1;

  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "\\") {
      const next = source[index + 1];
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
      return {
        token: {
          kind: "string",
          text: value,
          raw: source.slice(start, index + 1),
          span: { start, end: index + 1 },
        },
        diagnostics: [],
      };
    }
    value += char;
    index += 1;
  }

  return {
    token: {
      kind: "string",
      text: value,
      raw: source.slice(start),
      span: { start, end: source.length },
    },
    diagnostics: [
      {
        severity: "error",
        message: "Unterminated quoted string.",
        span: { start, end: source.length },
      },
    ],
  };
}

function readRegex(
  source: string,
  start: number,
): { readonly token: Token; readonly diagnostics: ReadonlyArray<QueryDiagnostic> } {
  let pattern = "";
  let index = start + 1;
  let inClass = false;

  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "\\") {
      const next = source[index + 1];
      if (next !== undefined) {
        pattern += char + next;
        index += 2;
        continue;
      }
    }
    if (char === "[") inClass = true;
    if (char === "]") inClass = false;
    if (char === "/" && !inClass) {
      index += 1;
      const flagsStart = index;
      while (index < source.length && /[A-Za-z]/.test(source[index] ?? "")) {
        index += 1;
      }
      const raw = source.slice(start, index);
      return {
        token: {
          kind: "regex",
          text: `${pattern}\u0000${source.slice(flagsStart, index)}`,
          raw,
          span: { start, end: index },
        },
        diagnostics: validateRegex(pattern, source.slice(flagsStart, index), { start, end: index }),
      };
    }
    pattern += char;
    index += 1;
  }

  return {
    token: {
      kind: "regex",
      text: `${pattern}\u0000`,
      raw: source.slice(start),
      span: { start, end: source.length },
    },
    diagnostics: [
      {
        severity: "error",
        message: "Unterminated regex literal.",
        span: { start, end: source.length },
      },
    ],
  };
}

function validateRegex(pattern: string, flags: string, span: SourceSpan): ReadonlyArray<QueryDiagnostic> {
  try {
    new RegExp(pattern, flags);
    return [];
  } catch (error) {
    return [
      {
        severity: "error",
        message: error instanceof Error ? error.message : "Invalid regex literal.",
        span,
      },
    ];
  }
}

function readSymbolOperator(source: string, start: number): Token | null {
  for (const operator of SYMBOL_OPERATORS) {
    if (source.startsWith(operator, start)) {
      return {
        kind: "operator",
        text: operator,
        raw: operator,
        span: { start, end: start + operator.length },
      };
    }
  }
  return null;
}

function isNumberStart(source: string, index: number): boolean {
  const char = source[index] ?? "";
  const next = source[index + 1] ?? "";
  return /\d/.test(char) || ((char === "-" || char === "+") && /\d/.test(next));
}

function readNumber(source: string, start: number): Token {
  const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(source.slice(start));
  const raw = match?.[0] ?? source[start] ?? "";
  return {
    kind: "number",
    text: raw,
    raw,
    span: { start, end: start + raw.length },
  };
}

function readWord(source: string, start: number): Token | null {
  if (start >= source.length) return null;
  let index = start;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (
      /\s/.test(char) ||
      ["(", ")", "[", "]", ",", '"', "/"].includes(char) ||
      readSymbolOperator(source, index) !== null
    ) {
      break;
    }
    index += 1;
  }

  if (index === start) return null;
  const raw = source.slice(start, index);
  return {
    kind: "word",
    text: raw,
    raw,
    span: { start, end: index },
  };
}

export function tokenContains(token: Token, offset: number): boolean {
  return token.span.start <= offset && offset <= token.span.end;
}
