import type { FilterNode, FilterValue } from "@lensflare/contracts";
import {
  QueryLanguageError,
  type LiteralNode,
  type QueryDiagnostic,
  type QueryField,
  type QueryNode,
  type SourceSpan,
} from "./ast.ts";
import { literalToFilterValue } from "./values.ts";
import { parseQueryStrict } from "./parser.ts";

export interface CompileResult {
  readonly filter: FilterNode | null;
  readonly diagnostics: ReadonlyArray<QueryDiagnostic>;
}

const TOP_LEVEL_FIELDS = new Set([
  "id",
  "timestamp",
  "kind",
  "level",
  "message",
  "name",
  "status",
  "statusMessage",
  "durationUs",
  "sourceName",
  "severityNumber",
  "severityText",
  "serviceName",
  "traceId",
  "spanId",
  "parentSpanId",
]);

export function compileQueryToFilter(
  ast: QueryNode | null,
  fields: ReadonlyArray<QueryField>,
): FilterNode | null {
  return compileQueryToFilterResult(ast, fields).filter;
}

export function compileQueryToFilterStrict(
  ast: QueryNode | null,
  fields: ReadonlyArray<QueryField>,
): FilterNode | null {
  const result = compileQueryToFilterResult(ast, fields);
  const error = result.diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (error !== undefined) {
    throw new QueryLanguageError(error.message);
  }
  return result.filter;
}

export function parseTelemetryQuery(
  source: string | undefined,
  fields: ReadonlyArray<QueryField>,
): FilterNode | null {
  const trimmed = source?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return compileQueryToFilterStrict(parseQueryStrict(trimmed), fields);
}

export function compileQueryToFilterResult(
  ast: QueryNode | null,
  fields: ReadonlyArray<QueryField>,
): CompileResult {
  const diagnostics: Array<QueryDiagnostic> = [];
  const filter = ast === null ? null : compileNode(ast, fields, diagnostics);
  return { filter, diagnostics };
}

function compileNode(
  node: QueryNode,
  fields: ReadonlyArray<QueryField>,
  diagnostics: Array<QueryDiagnostic>,
): FilterNode | null {
  switch (node.kind) {
    case "text":
      return node.value.trim().length === 0
        ? null
        : { _tag: "text", query: node.value.trim(), mode: "substring" };
    case "comparison": {
      const field = resolveQueryField(node.field.raw, fields, node.field.span, diagnostics);
      if (field === null) return null;
      const value = valueForOperator(node.value, node.operator, field, diagnostics);
      if (value === undefined) return null;
      return {
        _tag: "cmp",
        field: { path: field.path as readonly [string, ...ReadonlyArray<string>] },
        op: node.operator,
        value,
      };
    }
    case "exists": {
      const field = resolveQueryField(node.field.raw, fields, node.field.span, diagnostics);
      if (field === null) return null;
      return {
        _tag: "cmp",
        field: { path: field.path as readonly [string, ...ReadonlyArray<string>] },
        op: node.present ? "exists" : "notExists",
      };
    }
    case "and":
      return combine("and", node.children, fields, diagnostics);
    case "or":
      return combine("or", node.children, fields, diagnostics);
    case "not": {
      const child = compileNode(node.child, fields, diagnostics);
      return child === null ? null : { _tag: "not", child };
    }
    case "group":
      return compileNode(node.child, fields, diagnostics);
  }
}

function combine(
  tag: "and" | "or",
  children: ReadonlyArray<QueryNode>,
  fields: ReadonlyArray<QueryField>,
  diagnostics: Array<QueryDiagnostic>,
): FilterNode | null {
  const compiled = children
    .map((child) => compileNode(child, fields, diagnostics))
    .filter((child): child is FilterNode => child !== null);
  if (compiled.length === 0) return null;
  if (compiled.length === 1) return compiled[0] ?? null;
  return { _tag: tag, children: compiled };
}

function valueForOperator(
  literal: LiteralNode,
  operator: FilterNode extends infer _ ? string : never,
  field: QueryField,
  diagnostics: Array<QueryDiagnostic>,
): FilterValue | undefined {
  if (["gt", "gte", "lt", "lte"].includes(operator) && literal.kind !== "number") {
    diagnostics.push({
      severity: "error",
      message: "Ordering operators require a numeric literal.",
      span: literal.span,
    });
    return undefined;
  }
  if (operator === "matchesRegex" && literal.kind === "regex") {
    return { _tag: "string", value: literal.pattern };
  }
  if ((operator === "in" || operator === "notIn") && literal.kind !== "array") {
    diagnostics.push({
      severity: "error",
      message: "Membership operators require an array literal.",
      span: literal.span,
    });
    return undefined;
  }
  const value = literalToFilterValue(literal);
  if (value === undefined) {
    diagnostics.push({
      severity: "error",
      message: "Unsupported literal for this comparison.",
      span: literal.span,
    });
    return undefined;
  }
  if (field.kind === "number") {
    if (value._tag === "number") return value;
    if (value._tag === "list" && value.values.every((item) => typeof item === "number")) {
      return value;
    }
    diagnostics.push({
      severity: "error",
      message: "Numeric fields require numeric literals.",
      span: literal.span,
    });
    return undefined;
  }
  return value;
}

export function resolveQueryField(
  raw: string,
  fields: ReadonlyArray<QueryField>,
  span: SourceSpan,
  diagnostics?: Array<QueryDiagnostic>,
): QueryField | null {
  const normalized = raw.toLowerCase();
  const known = fields.find((field) => {
    const path = field.path.join(".");
    const attributeTail = normalized.startsWith("attr.")
      ? `attributes.${raw.slice("attr.".length)}`.toLowerCase()
      : normalized;
    return path.toLowerCase() === normalized ||
      path.toLowerCase() === attributeTail ||
      field.label.toLowerCase() === normalized ||
      field.label.toLowerCase() === raw.slice(raw.indexOf(".") + 1).toLowerCase() ||
      field.id?.toLowerCase() === normalized;
  });
  if (known !== undefined) return known;

  const fallback = fallbackField(raw);
  if (fallback !== null) return fallback;

  diagnostics?.push({
    severity: "error",
    message: `Unknown query field '${raw}'.`,
    span,
  });
  return null;
}

function fallbackField(raw: string): QueryField | null {
  const normalized = raw.toLowerCase();
  if (normalized.startsWith("attr.")) {
    const tail = raw.slice("attr.".length);
    return { path: ["attributes", ...tail.split(".").filter(Boolean)], label: raw, kind: "string" };
  }
  if (normalized.startsWith("attributes.")) {
    const tail = raw.slice(raw.indexOf(".") + 1);
    return { path: ["attributes", ...tail.split(".").filter(Boolean)], label: raw, kind: "string" };
  }
  if (normalized.startsWith("relatedevents.")) {
    return { path: ["relatedEvents", ...raw.split(".").slice(1).filter(Boolean)], label: raw, kind: "string" };
  }
  if (TOP_LEVEL_FIELDS.has(raw)) {
    const kind = raw === "durationUs" || raw === "severityNumber" ? "number" : "string";
    return { path: [raw], label: raw, kind };
  }
  return null;
}
