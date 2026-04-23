/**
 * Compiles a {@link FilterNode} AST into a DuckDB `WHERE` fragment plus the
 * parameter bindings its placeholders depend on. The output is designed to be
 * spliced into an existing parameterised query (e.g. the log paging query)
 * with a single `AND` — the caller owns the surrounding `SELECT ... WHERE
 * project_id = $project_id AND ...` context.
 *
 * Placeholders are namespaced as `$flt_<n>` so they never collide with caller
 * bindings. The `nextIndex` field of the result lets callers chain multiple
 * compilations, or just assert it against `Object.keys(params).length` for
 * sanity.
 *
 * The compiler is the one component that has to guarantee injection safety:
 * all scalar / list values flow through bound parameters, and the only raw
 * string we interpolate into SQL is the JSON path for `attributes.*` lookups,
 * which is whitelisted by {@link ATTRIBUTE_SEGMENT_PATTERN} before being
 * emitted. Any violation raises {@link InvalidFilterError} so the HTTP
 * boundary can map it to a 400.
 */

import type { DuckDBValue } from "@duckdb/node-api";
import {
  ATTRIBUTE_SEGMENT_PATTERN,
  InvalidFilterError,
  type FilterField,
  type FilterNode,
  type FilterOperator,
  type FilterValue,
} from "@lensflare/contracts";

export interface FilterSqlFragment {
  readonly whereClause: string;
  readonly params: Record<string, DuckDBValue>;
  /** First un-used placeholder index after this fragment's bindings. */
  readonly nextIndex: number;
}

export interface CompileFilterOptions {
  /** Starting placeholder index; defaults to 0 (`$flt_0`). */
  readonly startIndex?: number;
}

interface ColumnExpression {
  readonly stringExpr: string;
  readonly numericExpr: string;
}

/**
 * Logical filter fields recognised by the compiler. The UI/schema expose
 * friendly names; the compiler owns the mapping into DuckDB columns. Kept
 * in lock-step with the client-side evaluator's top-level field handling
 * so the two agree on what "level" means.
 */
const FIELD_MAP: Record<string, ColumnExpression> = {
  id: {
    stringExpr: "id",
    numericExpr: "TRY_CAST(id AS DOUBLE)",
  },
  timestamp: {
    stringExpr: "CAST(COALESCE(timestamp, ingested_at) AS VARCHAR)",
    numericExpr: "epoch(COALESCE(timestamp, ingested_at))",
  },
  level: {
    stringExpr: "severity_text",
    numericExpr: "severity_number",
  },
  message: {
    stringExpr:
      "COALESCE(NULLIF(body_text, ''), CAST(body_json AS VARCHAR), CAST(raw_record_json AS VARCHAR))",
    numericExpr: "TRY_CAST(NULLIF(body_text, '') AS DOUBLE)",
  },
  sourceName: {
    stringExpr: "COALESCE(service_name, dataset_slug, provider_kind)",
    numericExpr:
      "TRY_CAST(COALESCE(service_name, dataset_slug, provider_kind) AS DOUBLE)",
  },
  severityNumber: {
    stringExpr: "CAST(severity_number AS VARCHAR)",
    numericExpr: "severity_number",
  },
  severityText: {
    stringExpr: "severity_text",
    numericExpr: "TRY_CAST(severity_text AS DOUBLE)",
  },
  serviceName: {
    stringExpr: "service_name",
    numericExpr: "TRY_CAST(service_name AS DOUBLE)",
  },
  traceId: {
    stringExpr: "trace_id",
    numericExpr: "TRY_CAST(trace_id AS DOUBLE)",
  },
  spanId: {
    stringExpr: "span_id",
    numericExpr: "TRY_CAST(span_id AS DOUBLE)",
  },
};

function assertAttributeSegments(segments: ReadonlyArray<string>): void {
  if (segments.length === 0) {
    throw new InvalidFilterError({
      reason: "attribute path requires at least one segment after 'attributes'",
    });
  }
  for (const segment of segments) {
    if (!ATTRIBUTE_SEGMENT_PATTERN.test(segment)) {
      throw new InvalidFilterError({
        reason: `unsafe attribute segment: '${segment}'`,
      });
    }
  }
}

function attributeStringExpr(segments: ReadonlyArray<string>): string {
  // Safe because we've already asserted every segment matches
  // ATTRIBUTE_SEGMENT_PATTERN — `$`, `.`, spaces, quotes etc. are rejected.
  return `json_extract_string(attributes_json, '${jsonPathForSegments(segments)}')`;
}

function jsonPathForSegments(segments: ReadonlyArray<string>): string {
  return `$${segments.map((segment) => (segment.includes(".") ? `."${segment}"` : `.${segment}`)).join("")}`;
}

function resolveField(
  field: FilterField,
): { readonly stringExpr: string; readonly numericExpr: string } {
  const [head, ...rest] = field.path;
  if (head === undefined) {
    throw new InvalidFilterError({ reason: "filter field path is empty" });
  }

  if (head === "attributes") {
    assertAttributeSegments(rest);
    const stringExpr = attributeStringExpr(rest);
    return { stringExpr, numericExpr: `TRY_CAST(${stringExpr} AS DOUBLE)` };
  }

  const column = FIELD_MAP[head];
  if (!column || rest.length > 0) {
    throw new InvalidFilterError({
      reason: `unknown filter field: '${field.path.join(".")}'`,
    });
  }

  return column;
}

/**
 * Escapes DuckDB LIKE metacharacters (`%`, `_`) and the backslash itself so a
 * user-supplied literal compared with `contains/startsWith/endsWith` cannot
 * cause accidental wildcard matches. Paired with `ESCAPE '\\'` in the emitted
 * SQL.
 */
function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function likePattern(value: string, op: "contains" | "startsWith" | "endsWith"): string {
  const escaped = escapeLikeLiteral(value.toLowerCase());
  switch (op) {
    case "contains":
      return `%${escaped}%`;
    case "startsWith":
      return `${escaped}%`;
    case "endsWith":
      return `%${escaped}`;
  }
}

function filterValueToDuckDbValue(value: FilterValue): DuckDBValue {
  switch (value._tag) {
    case "string":
      return value.value;
    case "number":
      return value.value;
    case "boolean":
      return value.value;
    case "null":
      return null;
    case "list":
      throw new InvalidFilterError({
        reason: "list value must be flattened before binding",
      });
  }
}

/**
 * Compiler state threaded through the recursive walk so placeholder names
 * stay globally unique.
 */
interface Builder {
  nextIndex: number;
  readonly params: Record<string, DuckDBValue>;
}

function bindParam(builder: Builder, value: DuckDBValue): string {
  const name = `flt_${builder.nextIndex}`;
  builder.nextIndex += 1;
  builder.params[name] = value;
  return `$${name}`;
}

function compileCmp(
  builder: Builder,
  field: FilterField,
  op: FilterOperator,
  value: FilterValue | undefined,
): string {
  const col = resolveField(field);

  if (op === "exists") {
    return `(${col.stringExpr} IS NOT NULL)`;
  }
  if (op === "notExists") {
    return `(${col.stringExpr} IS NULL)`;
  }

  if (value === undefined) {
    throw new InvalidFilterError({
      reason: `operator '${op}' requires a value`,
    });
  }

  switch (op) {
    case "eq":
    case "ne": {
      if (value._tag === "null") {
        return op === "eq" ? `(${col.stringExpr} IS NULL)` : `(${col.stringExpr} IS NOT NULL)`;
      }
      const placeholder = bindParam(builder, filterValueToDuckDbValue(value));
      const expr = value._tag === "number" ? col.numericExpr : col.stringExpr;
      return op === "eq" ? `(${expr} = ${placeholder})` : `(${expr} <> ${placeholder})`;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (value._tag === "list" || value._tag === "null" || value._tag === "boolean") {
        throw new InvalidFilterError({
          reason: `operator '${op}' requires a string or number value`,
        });
      }
      const placeholder = bindParam(builder, filterValueToDuckDbValue(value));
      const sqlOp = op === "gt" ? ">" : op === "gte" ? ">=" : op === "lt" ? "<" : "<=";
      return `(${col.numericExpr} ${sqlOp} ${placeholder})`;
    }
    case "contains":
    case "startsWith":
    case "endsWith": {
      if (value._tag !== "string") {
        throw new InvalidFilterError({
          reason: `operator '${op}' requires a string value`,
        });
      }
      const placeholder = bindParam(builder, likePattern(value.value, op));
      return `(LOWER(${col.stringExpr}) LIKE ${placeholder} ESCAPE '\\')`;
    }
    case "matchesRegex": {
      if (value._tag !== "string") {
        throw new InvalidFilterError({
          reason: "operator 'matchesRegex' requires a string value",
        });
      }
      const placeholder = bindParam(builder, value.value);
      return `(regexp_matches(COALESCE(${col.stringExpr}, ''), ${placeholder}))`;
    }
    case "in":
    case "notIn": {
      const items =
        value._tag === "list"
          ? value.values
          : value._tag === "null"
            ? [null as string | number | boolean | null]
            : [value.value];
      if (items.length === 0) {
        // `x IN ()` is a syntax error in DuckDB; emit a tautology that matches
        // the empty set instead. `notIn` on an empty list matches everything.
        return op === "in" ? "(FALSE)" : "(TRUE)";
      }
      const hasNumber = items.some((item) => typeof item === "number");
      const expr = hasNumber ? col.numericExpr : col.stringExpr;
      const placeholders = items.map((item) => bindParam(builder, item as DuckDBValue));
      const joined = placeholders.join(", ");
      return op === "in" ? `(${expr} IN (${joined}))` : `(${expr} NOT IN (${joined}))`;
    }
  }
}

/**
 * Haystacks used when compiling a `text` node. Mirrors the evaluator's
 * `evaluateText` so substring / regex semantics agree across the two sides.
 */
const TEXT_HAYSTACK_STRING_EXPRS: ReadonlyArray<string> = [
  "COALESCE(NULLIF(body_text, ''), CAST(body_json AS VARCHAR), CAST(raw_record_json AS VARCHAR))",
  "COALESCE(service_name, dataset_slug, provider_kind)",
  "COALESCE(severity_text, '')",
  "COALESCE(service_name, '')",
  "COALESCE(trace_id, '')",
  "COALESCE(span_id, '')",
  "CAST(attributes_json AS VARCHAR)",
];

function compileText(builder: Builder, query: string, mode: "substring" | "regex"): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return "(TRUE)";
  }

  if (mode === "regex") {
    const placeholder = bindParam(builder, trimmed);
    const parts = TEXT_HAYSTACK_STRING_EXPRS.map(
      (expr) => `regexp_matches(COALESCE(${expr}, ''), ${placeholder})`,
    );
    return `(${parts.join(" OR ")})`;
  }

  const placeholder = bindParam(builder, `%${escapeLikeLiteral(trimmed.toLowerCase())}%`);
  const parts = TEXT_HAYSTACK_STRING_EXPRS.map(
    (expr) => `LOWER(COALESCE(${expr}, '')) LIKE ${placeholder} ESCAPE '\\'`,
  );
  return `(${parts.join(" OR ")})`;
}

function compileNode(builder: Builder, node: FilterNode): string {
  switch (node._tag) {
    case "and": {
      if (node.children.length === 0) {
        return "(TRUE)";
      }
      const parts = node.children.map((child) => compileNode(builder, child));
      return `(${parts.join(" AND ")})`;
    }
    case "or": {
      if (node.children.length === 0) {
        return "(FALSE)";
      }
      const parts = node.children.map((child) => compileNode(builder, child));
      return `(${parts.join(" OR ")})`;
    }
    case "not":
      return `(NOT ${compileNode(builder, node.child)})`;
    case "cmp":
      return compileCmp(builder, node.field, node.op, node.value);
    case "text":
      return compileText(builder, node.query, node.mode ?? "substring");
  }
}

/**
 * Entry point. Converts a filter AST to the SQL fragment + parameter map
 * that the query layer splices into its paginated select.
 */
export function compileFilterToSql(
  ast: FilterNode,
  options: CompileFilterOptions = {},
): FilterSqlFragment {
  const builder: Builder = {
    nextIndex: options.startIndex ?? 0,
    params: {},
  };
  const whereClause = compileNode(builder, ast);
  return {
    whereClause,
    params: builder.params,
    nextIndex: builder.nextIndex,
  };
}
