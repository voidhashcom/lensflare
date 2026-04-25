import type { QueryNode } from "./ast.ts";
import { literalToSource } from "./values.ts";

export function formatQuery(ast: QueryNode | null): string {
  return ast === null ? "" : formatNode(ast, 0);
}

function formatNode(node: QueryNode, parentPrecedence: number): string {
  switch (node.kind) {
    case "text":
      return quoteTextIfNeeded(node.value);
    case "comparison":
      return `${node.field.raw} ${operatorToken(node.operator)} ${literalToSource(node.value)}`;
    case "exists":
      return `${node.field.raw} ${node.present ? "exists" : "missing"}`;
    case "not": {
      const out = `not ${formatNode(node.child, 3)}`;
      return parentPrecedence > 3 ? `(${out})` : out;
    }
    case "and": {
      const out = node.children.map((child) => formatNode(child, 2)).join(" and ");
      return parentPrecedence > 2 ? `(${out})` : out;
    }
    case "or": {
      const out = node.children.map((child) => formatNode(child, 1)).join(" or ");
      return parentPrecedence > 1 ? `(${out})` : out;
    }
    case "group":
      return `(${formatNode(node.child, 0)})`;
  }
}

function operatorToken(operator: string): string {
  switch (operator) {
    case "eq":
      return "=";
    case "ne":
      return "!=";
    case "matchesRegex":
      return "~=";
    case "notIn":
      return "not in";
    default:
      return operator;
  }
}

function quoteTextIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;
}
