import type { DuckDBValue } from "@duckdb/node-api";
import {
  ATTRIBUTE_SEGMENT_PATTERN,
  InvalidFilterError,
  type FilterField,
  type FilterNode,
  type FilterOperator,
  type FilterValue,
} from "@lensflare/contracts";

export interface TelemetryFilterSqlFragment {
  readonly whereClause: string;
  readonly params: Record<string, DuckDBValue>;
  readonly nextIndex: number;
}

interface Builder {
  nextIndex: number;
  readonly params: Record<string, DuckDBValue>;
}

interface ColumnExpression {
  readonly stringExpr: string;
  readonly numericExpr: string;
}

const FIELD_MAP: Record<string, ColumnExpression> = {
  id: { stringExpr: "telemetry.id", numericExpr: "TRY_CAST(telemetry.id AS DOUBLE)" },
  kind: { stringExpr: "telemetry.kind", numericExpr: "TRY_CAST(telemetry.kind AS DOUBLE)" },
  timestamp: {
    stringExpr: "CAST(telemetry.sort_timestamp AS VARCHAR)",
    numericExpr: "epoch(telemetry.sort_timestamp)",
  },
  level: { stringExpr: "telemetry.level", numericExpr: "TRY_CAST(telemetry.level AS DOUBLE)" },
  message: {
    stringExpr: "telemetry.message",
    numericExpr: "TRY_CAST(telemetry.message AS DOUBLE)",
  },
  name: { stringExpr: "telemetry.name", numericExpr: "TRY_CAST(telemetry.name AS DOUBLE)" },
  status: { stringExpr: "telemetry.status", numericExpr: "TRY_CAST(telemetry.status AS DOUBLE)" },
  durationUs: {
    stringExpr: "CAST(telemetry.duration_us AS VARCHAR)",
    numericExpr: "telemetry.duration_us",
  },
  sourceName: {
    stringExpr: "telemetry.source_name",
    numericExpr: "TRY_CAST(telemetry.source_name AS DOUBLE)",
  },
  severityNumber: {
    stringExpr: "CAST(telemetry.severity_number AS VARCHAR)",
    numericExpr: "telemetry.severity_number",
  },
  severityText: {
    stringExpr: "telemetry.severity_text",
    numericExpr: "TRY_CAST(telemetry.severity_text AS DOUBLE)",
  },
  serviceName: {
    stringExpr: "telemetry.service_name",
    numericExpr: "TRY_CAST(telemetry.service_name AS DOUBLE)",
  },
  traceId: {
    stringExpr: "telemetry.trace_id",
    numericExpr: "TRY_CAST(telemetry.trace_id AS DOUBLE)",
  },
  spanId: {
    stringExpr: "telemetry.span_id",
    numericExpr: "TRY_CAST(telemetry.span_id AS DOUBLE)",
  },
  parentSpanId: {
    stringExpr: "telemetry.parent_span_id",
    numericExpr: "TRY_CAST(telemetry.parent_span_id AS DOUBLE)",
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
      throw new InvalidFilterError({ reason: `unsafe attribute segment: '${segment}'` });
    }
  }
}

function attributeStringExpr(
  segments: ReadonlyArray<string>,
  column = "telemetry.attributes_json",
): string {
  const exactKey = segments.join(".");
  return `COALESCE(${column}['${exactKey}'], ${column}['${segments.at(-1) ?? ""}'])`;
}

function resolveField(field: FilterField): ColumnExpression {
  const [head, ...rest] = field.path;
  if (head === undefined) {
    throw new InvalidFilterError({ reason: "filter field path is empty" });
  }

  if (head === "attributes") {
    assertAttributeSegments(rest);
    const stringExpr = attributeStringExpr(rest);
    return { stringExpr, numericExpr: `TRY_CAST(${stringExpr} AS DOUBLE)` };
  }

  if (head === "relatedEvents") {
    throw new InvalidFilterError({
      reason: "relatedEvents fields require telemetry span filter compilation",
    });
  }

  const column = FIELD_MAP[head];
  if (!column || rest.length > 0) {
    throw new InvalidFilterError({ reason: `unknown filter field: '${field.path.join(".")}'` });
  }
  return column;
}

function bindParam(builder: Builder, value: DuckDBValue): string {
  const name = `flt_${builder.nextIndex}`;
  builder.nextIndex += 1;
  builder.params[name] = value;
  return `$${name}`;
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
      throw new InvalidFilterError({ reason: "list value must be flattened before binding" });
  }
}

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

function compileCmpAgainstExpr(
  builder: Builder,
  col: ColumnExpression,
  op: FilterOperator,
  value: FilterValue | undefined,
): string {
  if (op === "exists") {
    return `(${col.stringExpr} IS NOT NULL)`;
  }
  if (op === "notExists") {
    return `(${col.stringExpr} IS NULL)`;
  }
  if (value === undefined) {
    throw new InvalidFilterError({ reason: `operator '${op}' requires a value` });
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
        throw new InvalidFilterError({ reason: `operator '${op}' requires a string value` });
      }
      const placeholder = bindParam(builder, likePattern(value.value, op));
      return `(LOWER(${col.stringExpr}) LIKE ${placeholder} ESCAPE '\\')`;
    }
    case "matchesRegex": {
      if (value._tag !== "string") {
        throw new InvalidFilterError({ reason: "operator 'matchesRegex' requires a string value" });
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
        return op === "in" ? "(FALSE)" : "(TRUE)";
      }
      const hasNumber = items.some((item) => typeof item === "number");
      const expr = hasNumber ? col.numericExpr : col.stringExpr;
      const placeholders = items.map((item) => bindParam(builder, item as DuckDBValue));
      return op === "in"
        ? `(${expr} IN (${placeholders.join(", ")}))`
        : `(${expr} NOT IN (${placeholders.join(", ")}))`;
    }
  }
}

function compileRelatedEventCmp(
  builder: Builder,
  field: FilterField,
  op: FilterOperator,
  value: FilterValue | undefined,
): string {
  const [, relation, ...rest] = field.path;
  let col: ColumnExpression;
  if (relation === "name") {
    col = {
      stringExpr: `related."Events.Name"[event_index.i]`,
      numericExpr: `TRY_CAST(related."Events.Name"[event_index.i] AS DOUBLE)`,
    };
  } else if (relation === "attributes") {
    assertAttributeSegments(rest);
    const stringExpr = attributeStringExpr(rest, `related."Events.Attributes"[event_index.i]`);
    col = { stringExpr, numericExpr: `TRY_CAST(${stringExpr} AS DOUBLE)` };
  } else {
    throw new InvalidFilterError({ reason: `unknown filter field: '${field.path.join(".")}'` });
  }

  const predicate = compileCmpAgainstExpr(builder, col, op, value);
  return `(
    telemetry.kind = 'span'
    AND EXISTS (
      SELECT 1
      FROM otel_traces related,
        range(1, length(related."Events.Name") + 1) event_index(i)
      WHERE related.TraceId = telemetry.trace_id
        AND related.SpanId = telemetry.span_id
        AND ${predicate}
    )
  )`;
}

function compileCmp(
  builder: Builder,
  field: FilterField,
  op: FilterOperator,
  value: FilterValue | undefined,
): string {
  if (field.path[0] === "relatedEvents") {
    return compileRelatedEventCmp(builder, field, op, value);
  }
  return compileCmpAgainstExpr(builder, resolveField(field), op, value);
}

const TEXT_HAYSTACK_STRING_EXPRS: ReadonlyArray<string> = [
  "telemetry.kind",
  "telemetry.message",
  "telemetry.name",
  "telemetry.source_name",
  "telemetry.level",
  "telemetry.status",
  "telemetry.severity_text",
  "telemetry.service_name",
  "telemetry.trace_id",
  "telemetry.span_id",
  "telemetry.parent_span_id",
  "CAST(telemetry.attributes_json AS VARCHAR)",
];

function compileText(builder: Builder, query: string, mode: "substring" | "regex"): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return "(TRUE)";
  }

  if (mode === "regex") {
    const placeholder = bindParam(builder, trimmed);
    return `(${TEXT_HAYSTACK_STRING_EXPRS.map(
      (expr) => `regexp_matches(COALESCE(${expr}, ''), ${placeholder})`,
    ).join(" OR ")})`;
  }

  const placeholder = bindParam(builder, `%${escapeLikeLiteral(trimmed.toLowerCase())}%`);
  return `(${TEXT_HAYSTACK_STRING_EXPRS.map(
    (expr) => `LOWER(COALESCE(${expr}, '')) LIKE ${placeholder} ESCAPE '\\'`,
  ).join(" OR ")})`;
}

function compileNode(builder: Builder, node: FilterNode): string {
  switch (node._tag) {
    case "and":
      return node.children.length === 0
        ? "(TRUE)"
        : `(${node.children.map((child) => compileNode(builder, child)).join(" AND ")})`;
    case "or":
      return node.children.length === 0
        ? "(FALSE)"
        : `(${node.children.map((child) => compileNode(builder, child)).join(" OR ")})`;
    case "not":
      return `(NOT ${compileNode(builder, node.child)})`;
    case "cmp":
      return compileCmp(builder, node.field, node.op, node.value);
    case "text":
      return compileText(builder, node.query, node.mode ?? "substring");
  }
}

export function compileTelemetryFilterToSql(
  node: FilterNode,
  options: { readonly startIndex?: number } = {},
): TelemetryFilterSqlFragment {
  const builder: Builder = {
    nextIndex: options.startIndex ?? 0,
    params: {},
  };
  const whereClause = compileNode(builder, node);
  return { whereClause, params: builder.params, nextIndex: builder.nextIndex };
}
