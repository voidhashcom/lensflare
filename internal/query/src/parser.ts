import {
  QueryLanguageError,
  type ComparisonNode,
  type ExistsNode,
  type FieldPathNode,
  type LiteralNode,
  type ParseResult,
  type QueryDiagnostic,
  type QueryNode,
  type SourceSpan,
  mergeSpan,
  spanFromNodes,
} from "./ast.ts";
import { lexQuery, type Token } from "./lexer.ts";

const BOOLEAN_KEYWORDS = new Set(["and", "or", "not"]);
const VALUE_KEYWORDS = new Set(["true", "false", "null"]);
const WORD_OPERATORS = new Set(["contains", "startswith", "endswith", "in", "exists", "missing"]);

export function parseQuery(source: string): ParseResult {
  const lexed = lexQuery(source);
  const parser = new Parser(lexed.tokens, lexed.diagnostics);
  const ast = parser.parse();
  return {
    ast,
    tokens: lexed.tokens,
    diagnostics: parser.diagnostics,
  };
}

export function parseQueryStrict(source: string): QueryNode | null {
  const result = parseQuery(source);
  const error = result.diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (error !== undefined) {
    throw new QueryLanguageError(error.message);
  }
  return result.ast;
}

class Parser {
  private index = 0;
  readonly diagnostics: Array<QueryDiagnostic>;
  private readonly tokens: ReadonlyArray<Token>;

  constructor(
    tokens: ReadonlyArray<Token>,
    initialDiagnostics: ReadonlyArray<QueryDiagnostic>,
  ) {
    this.tokens = tokens;
    this.diagnostics = [...initialDiagnostics];
  }

  parse(): QueryNode | null {
    if (this.tokens.length === 0) return null;
    const node = this.parseOr();
    const token = this.peek();
    if (token !== undefined) {
      this.error(`Unexpected token '${token.raw}'.`, token.span);
    }
    return node;
  }

  private parseOr(): QueryNode {
    const children = [this.parseAnd()];
    while (this.consumeWord("or")) {
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0]! : { kind: "or", children, span: spanFromNodes(children) };
  }

  private parseAnd(): QueryNode {
    const children = [this.parseNot()];
    while (this.peek() !== undefined && this.peek()?.kind !== "rparen" && !this.isWord("or")) {
      this.consumeWord("and");
      children.push(this.parseNot());
    }
    return children.length === 1 ? children[0]! : { kind: "and", children, span: spanFromNodes(children) };
  }

  private parseNot(): QueryNode {
    const token = this.peek();
    if (this.consumeWord("not")) {
      const child = this.parseNot();
      return { kind: "not", child, span: mergeSpan(token!.span, child.span) };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode {
    const lparen = this.peek();
    if (this.consumeKind("lparen")) {
      const child = this.parseOr();
      const rparen = this.expectKind("rparen", "Expected ')' to close grouped expression.");
      return {
        kind: "group",
        child,
        span: { start: lparen!.span.start, end: rparen?.span.end ?? child.span.end },
      };
    }

    const comparison = this.tryParseFieldExpression();
    if (comparison !== null) {
      return comparison;
    }

    return this.parseText();
  }

  private tryParseFieldExpression(): ComparisonNode | ExistsNode | null {
    const fieldToken = this.peek();
    if (fieldToken?.kind !== "word") return null;
    const operator = this.readComparisonOperator(1);
    if (operator === null) return null;

    this.index += operator.consumed + 1;
    const field = fieldPathFromToken(fieldToken);

    if (operator.operator === "exists" || operator.operator === "notExists") {
      return {
        kind: "exists",
        field,
        present: operator.operator === "exists",
        span: { start: fieldToken.span.start, end: operator.end },
      };
    }

    const value = this.parseLiteral();
    if (value === null) {
      this.error("Expected a comparison value.", this.peek()?.span ?? { start: operator.end, end: operator.end });
      return {
        kind: "comparison",
        field,
        operator: operator.operator,
        value: { kind: "string", value: "", quoted: false, span: { start: operator.end, end: operator.end } },
        span: { start: field.span.start, end: operator.end },
      };
    }

    return {
      kind: "comparison",
      field,
      operator: operator.operator,
      value,
      span: { start: field.span.start, end: value.span.end },
    };
  }

  private readComparisonOperator(offset: number): {
    readonly operator: ComparisonNode["operator"] | "exists" | "notExists";
    readonly consumed: number;
    readonly end: number;
  } | null {
    const token = this.tokens[this.index + offset];
    if (token === undefined) return null;

    if (token.kind === "operator") {
      switch (token.text) {
        case "=":
          return { operator: "eq", consumed: 1, end: token.span.end };
        case "!=":
          return { operator: "ne", consumed: 1, end: token.span.end };
        case ">":
          return { operator: "gt", consumed: 1, end: token.span.end };
        case ">=":
          return { operator: "gte", consumed: 1, end: token.span.end };
        case "<":
          return { operator: "lt", consumed: 1, end: token.span.end };
        case "<=":
          return { operator: "lte", consumed: 1, end: token.span.end };
        case "~=":
          return { operator: "matchesRegex", consumed: 1, end: token.span.end };
        default:
          return null;
      }
    }

    if (token.kind !== "word") return null;
    const lower = token.text.toLowerCase();
    switch (lower) {
      case "contains":
        return { operator: "contains", consumed: 1, end: token.span.end };
      case "startswith":
        return { operator: "startsWith", consumed: 1, end: token.span.end };
      case "endswith":
        return { operator: "endsWith", consumed: 1, end: token.span.end };
      case "in":
        return { operator: "in", consumed: 1, end: token.span.end };
      case "exists":
        return { operator: "exists", consumed: 1, end: token.span.end };
      case "missing":
        return { operator: "notExists", consumed: 1, end: token.span.end };
      case "not": {
        const next = this.tokens[this.index + offset + 1];
        if (next?.kind === "word" && next.text.toLowerCase() === "in") {
          return { operator: "notIn", consumed: 2, end: next.span.end };
        }
        return null;
      }
      default:
        return null;
    }
  }

  private parseLiteral(): LiteralNode | null {
    const token = this.peek();
    if (token === undefined) return null;

    switch (token.kind) {
      case "string":
        this.index += 1;
        return { kind: "string", value: token.text, quoted: true, span: token.span };
      case "number": {
        this.index += 1;
        const value = Number(token.text);
        if (!Number.isFinite(value)) {
          this.error(`Invalid numeric literal '${token.raw}'.`, token.span);
        }
        return { kind: "number", value, span: token.span };
      }
      case "regex": {
        this.index += 1;
        const [pattern = "", flags = ""] = token.text.split("\u0000");
        return { kind: "regex", pattern, flags, span: token.span };
      }
      case "word": {
        this.index += 1;
        const lower = token.text.toLowerCase();
        if (lower === "true") return { kind: "boolean", value: true, span: token.span };
        if (lower === "false") return { kind: "boolean", value: false, span: token.span };
        if (lower === "null") return { kind: "null", span: token.span };
        return { kind: "string", value: token.text, quoted: false, span: token.span };
      }
      case "lbracket":
        return this.parseArrayLiteral();
      default:
        return null;
    }
  }

  private parseArrayLiteral(): LiteralNode | null {
    const start = this.expectKind("lbracket", "Expected '['.");
    const values: Array<LiteralNode> = [];
    if (!this.consumeKind("rbracket")) {
      do {
        const value = this.parseLiteral();
        if (value === null) {
          this.error("Expected a list value.", this.peek()?.span ?? start!.span);
          break;
        }
        values.push(value);
      } while (this.consumeKind("comma"));
      this.expectKind("rbracket", "Expected ']' to close list literal.");
    }
    const end = values.at(-1)?.span.end ?? start?.span.end ?? 0;
    const previous = this.tokens[this.index - 1];
    return {
      kind: "array",
      values,
      span: { start: start?.span.start ?? 0, end: previous?.kind === "rbracket" ? previous.span.end : end },
    };
  }

  private parseText(): QueryNode {
    const token = this.peek();
    if (token === undefined) {
      const end = this.tokens.at(-1)?.span.end ?? 0;
      return { kind: "text", value: "", span: { start: end, end } };
    }
    this.index += 1;
    if (token.kind === "word" && (BOOLEAN_KEYWORDS.has(token.text.toLowerCase()) || WORD_OPERATORS.has(token.text.toLowerCase()))) {
      this.error(`Unexpected keyword '${token.raw}'.`, token.span);
    }
    if (token.kind === "operator") {
      this.error(`Unexpected operator '${token.raw}'.`, token.span);
    }
    return {
      kind: "text",
      value: token.text,
      span: token.span,
    };
  }

  private consumeWord(word: string): boolean {
    if (!this.isWord(word)) return false;
    this.index += 1;
    return true;
  }

  private isWord(word: string): boolean {
    const token = this.peek();
    return token?.kind === "word" && token.text.toLowerCase() === word;
  }

  private consumeKind(kind: Token["kind"]): boolean {
    if (this.peek()?.kind !== kind) return false;
    this.index += 1;
    return true;
  }

  private expectKind(kind: Token["kind"], message: string): Token | null {
    const token = this.peek();
    if (token?.kind === kind) {
      this.index += 1;
      return token;
    }
    this.error(message, token?.span ?? { start: this.tokens.at(-1)?.span.end ?? 0, end: this.tokens.at(-1)?.span.end ?? 0 });
    return null;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private error(message: string, span: SourceSpan): void {
    this.diagnostics.push({ severity: "error", message, span });
  }
}

function fieldPathFromToken(token: Token): FieldPathNode {
  return {
    kind: "fieldPath",
    raw: token.text,
    segments: token.text.split(".").filter(Boolean),
    span: token.span,
  };
}

export function isValueKeyword(value: string): boolean {
  return VALUE_KEYWORDS.has(value.toLowerCase());
}
