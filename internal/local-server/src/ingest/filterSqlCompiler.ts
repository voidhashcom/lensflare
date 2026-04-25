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
    stringExpr: "LensflareRecordId",
    numericExpr: "TRY_CAST(LensflareRecordId AS DOUBLE)",
  },
  timestamp: {
    stringExpr: "CAST(Timestamp AS VARCHAR)",
    numericExpr: "epoch(Timestamp)",
  },
  level: {
    stringExpr: `CASE
      WHEN lower(SeverityText) = 'fatal' THEN 'fatal'
      WHEN lower(SeverityText) = 'error' THEN 'error'
      WHEN lower(SeverityText) IN ('warn', 'warning') THEN 'warn'
      WHEN lower(SeverityText) = 'info' THEN 'info'
      WHEN lower(SeverityText) = 'debug' THEN 'debug'
      WHEN lower(SeverityText) = 'trace' THEN 'trace'
      WHEN SeverityNumber >= 21 THEN 'fatal'
      WHEN SeverityNumber >= 17 THEN 'error'
      WHEN SeverityNumber >= 13 THEN 'warn'
      WHEN SeverityNumber >= 9 THEN 'info'
      WHEN SeverityNumber >= 5 THEN 'debug'
      ELSE 'trace'
    END`,
    numericExpr: "SeverityNumber",
  },
  message: {
    stringExpr: "Body",
    numericExpr: "TRY_CAST(Body AS DOUBLE)",
  },
  sourceName: {
    stringExpr: "NULLIF(ServiceName, '')",
    numericExpr: "TRY_CAST(NULLIF(ServiceName, '') AS DOUBLE)",
  },
  severityNumber: {
    stringExpr: "CAST(SeverityNumber AS VARCHAR)",
    numericExpr: "SeverityNumber",
  },
  severityText: {
    stringExpr: "SeverityText",
    numericExpr: "TRY_CAST(SeverityText AS DOUBLE)",
  },
  serviceName: {
    stringExpr: "NULLIF(ServiceName, '')",
    numericExpr: "TRY_CAST(NULLIF(ServiceName, '') AS DOUBLE)",
  },
  traceId: {
    stringExpr: "NULLIF(TraceId, '')",
    numericExpr: "TRY_CAST(NULLIF(TraceId, '') AS DOUBLE)",
  },
  spanId: {
    stringExpr: "NULLIF(SpanId, '')",
    numericExpr: "TRY_CAST(NULLIF(SpanId, '') AS DOUBLE)",
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
  const exactKey = segments.join(".");
  return `COALESCE(LogAttributes['${exactKey}'], LogAttributes['${segments.at(-1) ?? ""}'])`;
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
  "Body",
  "COALESCE(NULLIF(ServiceName, ''), '')",
  "COALESCE(SeverityText, '')",
  "COALESCE(TraceId, '')",
  "COALESCE(SpanId, '')",
  "CAST(LogAttributes AS VARCHAR)",
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
