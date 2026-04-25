import type { FilterOperator } from "@lensflare/contracts";

export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface QueryDiagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly span: SourceSpan;
}

export class QueryLanguageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryLanguageError";
  }
}

export interface QueryField {
  readonly id?: string;
  readonly path: ReadonlyArray<string>;
  readonly label: string;
  readonly kind: "string" | "number" | "enum";
  readonly values?: ReadonlyArray<string>;
  readonly frequency?: number;
}

export interface FieldPathNode {
  readonly kind: "fieldPath";
  readonly segments: ReadonlyArray<string>;
  readonly raw: string;
  readonly span: SourceSpan;
}

export type QueryNode =
  | TextNode
  | ComparisonNode
  | ExistsNode
  | AndNode
  | OrNode
  | NotNode
  | GroupNode;

export interface TextNode {
  readonly kind: "text";
  readonly value: string;
  readonly span: SourceSpan;
}

export type QueryComparisonOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "matchesRegex"
  | "in"
  | "notIn";

export interface ComparisonNode {
  readonly kind: "comparison";
  readonly field: FieldPathNode;
  readonly operator: QueryComparisonOperator;
  readonly value: LiteralNode;
  readonly span: SourceSpan;
}

export interface ExistsNode {
  readonly kind: "exists";
  readonly field: FieldPathNode;
  readonly present: boolean;
  readonly span: SourceSpan;
}

export interface AndNode {
  readonly kind: "and";
  readonly children: ReadonlyArray<QueryNode>;
  readonly span: SourceSpan;
}

export interface OrNode {
  readonly kind: "or";
  readonly children: ReadonlyArray<QueryNode>;
  readonly span: SourceSpan;
}

export interface NotNode {
  readonly kind: "not";
  readonly child: QueryNode;
  readonly span: SourceSpan;
}

export interface GroupNode {
  readonly kind: "group";
  readonly child: QueryNode;
  readonly span: SourceSpan;
}

export type LiteralNode =
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | NullLiteralNode
  | RegexLiteralNode
  | ArrayLiteralNode;

export interface StringLiteralNode {
  readonly kind: "string";
  readonly value: string;
  readonly quoted: boolean;
  readonly span: SourceSpan;
}

export interface NumberLiteralNode {
  readonly kind: "number";
  readonly value: number;
  readonly span: SourceSpan;
}

export interface BooleanLiteralNode {
  readonly kind: "boolean";
  readonly value: boolean;
  readonly span: SourceSpan;
}

export interface NullLiteralNode {
  readonly kind: "null";
  readonly span: SourceSpan;
}

export interface RegexLiteralNode {
  readonly kind: "regex";
  readonly pattern: string;
  readonly flags: string;
  readonly span: SourceSpan;
}

export interface ArrayLiteralNode {
  readonly kind: "array";
  readonly values: ReadonlyArray<LiteralNode>;
  readonly span: SourceSpan;
}

export interface OperatorSyntax {
  readonly token: string;
  readonly operator: FilterOperator;
  readonly negated: boolean;
  readonly kinds: ReadonlyArray<QueryField["kind"]>;
  readonly label: string;
  readonly requiresValue: boolean;
}

export interface ParsedPill {
  readonly fieldPath: ReadonlyArray<string>;
  readonly operatorToken: string;
  readonly operator: FilterOperator;
  readonly negated: boolean;
  readonly rawValue: string;
  readonly valueWasQuoted: boolean;
  readonly start: number;
  readonly end: number;
  readonly fieldSpan?: SourceSpan;
  readonly operatorSpan?: SourceSpan;
  readonly valueSpan?: SourceSpan;
}

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
  readonly ast: QueryNode | null;
  readonly tokens: ReadonlyArray<import("./lexer.ts").Token>;
  readonly diagnostics: ReadonlyArray<QueryDiagnostic>;
}

export interface FilterInputParseResult {
  readonly ast: QueryNode | null;
  readonly tokens: ReadonlyArray<import("./lexer.ts").Token>;
  readonly diagnostics: ReadonlyArray<QueryDiagnostic>;
  readonly pills: ReadonlyArray<ParsedPill>;
  readonly trailingText: string;
  readonly trailingStart: number;
  readonly cursorContext: CursorContext;
}

export function spanFromNodes(nodes: ReadonlyArray<QueryNode>): SourceSpan {
  const first = nodes[0];
  const last = nodes.at(-1);
  return first === undefined || last === undefined
    ? { start: 0, end: 0 }
    : { start: first.span.start, end: last.span.end };
}

export function mergeSpan(left: SourceSpan, right: SourceSpan): SourceSpan {
  return { start: left.start, end: right.end };
}
