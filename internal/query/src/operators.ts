import type { FilterOperator } from "@lensflare/contracts";
import type { OperatorSyntax, QueryField } from "./ast.ts";

export const OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
  eq: "is",
  ne: "is not",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  matchesRegex: "matches regex",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  in: "is one of",
  notIn: "is none of",
  exists: "exists",
  notExists: "does not exist",
};

export const UNARY_OPERATORS: ReadonlyArray<FilterOperator> = ["exists", "notExists"];
export const LIST_OPERATORS: ReadonlyArray<FilterOperator> = ["in", "notIn"];

export const OPERATOR_SYNTAX: ReadonlyArray<OperatorSyntax> = [
  { token: "=", operator: "eq", negated: false, kinds: ["string", "number", "enum"], label: "equals", requiresValue: true },
  { token: "!=", operator: "ne", negated: false, kinds: ["string", "number", "enum"], label: "does not equal", requiresValue: true },
  { token: ">", operator: "gt", negated: false, kinds: ["number"], label: ">", requiresValue: true },
  { token: ">=", operator: "gte", negated: false, kinds: ["number"], label: ">=", requiresValue: true },
  { token: "<", operator: "lt", negated: false, kinds: ["number"], label: "<", requiresValue: true },
  { token: "<=", operator: "lte", negated: false, kinds: ["number"], label: "<=", requiresValue: true },
  { token: "contains", operator: "contains", negated: false, kinds: ["string"], label: "contains", requiresValue: true },
  { token: "startsWith", operator: "startsWith", negated: false, kinds: ["string"], label: "starts with", requiresValue: true },
  { token: "endsWith", operator: "endsWith", negated: false, kinds: ["string"], label: "ends with", requiresValue: true },
  { token: "~=", operator: "matchesRegex", negated: false, kinds: ["string"], label: "matches regex", requiresValue: true },
  { token: "in", operator: "in", negated: false, kinds: ["string", "number", "enum"], label: "is one of", requiresValue: true },
  { token: "not in", operator: "notIn", negated: false, kinds: ["string", "number", "enum"], label: "is none of", requiresValue: true },
  { token: "exists", operator: "exists", negated: false, kinds: ["string", "number", "enum"], label: "exists", requiresValue: false },
  { token: "missing", operator: "notExists", negated: false, kinds: ["string", "number", "enum"], label: "does not exist", requiresValue: false },
];

export const TOKENS_BY_LENGTH: ReadonlyArray<OperatorSyntax> = [...OPERATOR_SYNTAX].sort(
  (a, b) => b.token.length - a.token.length,
);

const STRING_OPERATORS: ReadonlyArray<FilterOperator> = [
  "eq",
  "ne",
  "contains",
  "startsWith",
  "endsWith",
  "matchesRegex",
  "in",
  "notIn",
  "exists",
  "notExists",
];

const NUMERIC_OPERATORS: ReadonlyArray<FilterOperator> = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "notIn",
  "exists",
  "notExists",
];

const ENUM_OPERATORS: ReadonlyArray<FilterOperator> = [
  "eq",
  "ne",
  "in",
  "notIn",
  "exists",
  "notExists",
];

export function isValuelessOperator(operator: FilterOperator): boolean {
  return operator === "exists" || operator === "notExists";
}

export function operatorsForField(kind: QueryField["kind"]): ReadonlyArray<FilterOperator> {
  switch (kind) {
    case "number":
      return NUMERIC_OPERATORS;
    case "enum":
      return ENUM_OPERATORS;
    case "string":
      return STRING_OPERATORS;
  }
}

export function defaultOperatorTokenForKind(_kind: QueryField["kind"]): string {
  return "=";
}

export function operatorSyntaxesForKind(kind: QueryField["kind"]): ReadonlyArray<OperatorSyntax> {
  return OPERATOR_SYNTAX.filter((entry) => entry.kinds.includes(kind));
}

export function preferredTokenForOperator(
  operator: FilterOperator,
  negated: boolean,
  kind: QueryField["kind"],
): string {
  if (negated) {
    return "!=";
  }
  for (const entry of OPERATOR_SYNTAX) {
    if (entry.operator === operator && entry.kinds.includes(kind)) {
      return entry.token;
    }
  }
  return "=";
}

export function syntaxForOperatorToken(token: string): OperatorSyntax | undefined {
  return OPERATOR_SYNTAX.find((entry) => entry.token === token);
}
