import * as Schema from "effect/Schema";

/**
 * JSON-serialisable filter AST shared between the log viewer frontend (which
 * runs it against streamed events in memory) and the local server (which
 * compiles it to parameterised DuckDB SQL for paginated queries). One source
 * of truth ensures the two sides can never drift.
 *
 * The shape is a recursive discriminated union via `Schema.suspend`:
 *   - `and` / `or` / `not` — boolean composition.
 *   - `cmp` — comparison of one field to one value using one operator.
 *   - `text` — full-text search treated as a first-class node so it composes
 *     naturally with the rest of the AST (e.g. `and(text("oops"), cmp(...))`).
 */

/**
 * Reference to a field addressable by the evaluator / compiler.
 *
 * - Top-level fields (`level`, `message`, `sourceName`, `severityNumber`,
 *   `severityText`, `serviceName`, `traceId`, `spanId`) are represented as a
 *   single-segment path.
 * - Attribute keys live under `["attributes", ...segments]`. Segments must
 *   match `ATTRIBUTE_SEGMENT_PATTERN` before compiling to SQL — this is the
 *   injection-safety invariant.
 */
export const FilterFieldSchema = Schema.Struct({
  path: Schema.NonEmptyArray(Schema.String),
});

export type FilterField = Schema.Schema.Type<typeof FilterFieldSchema>;

/**
 * Scalar / list literal passed as the right-hand side of a comparison.
 *
 * Tagged to keep JSON round-trippable and to let the compiler pick the right
 * parameter encoding (e.g. number literal → bound DuckDB DOUBLE, string →
 * VARCHAR). `null` is its own tag so `eq` against `null` is encoded as
 * `IS NULL` by the SQL compiler rather than `= NULL` (which never matches).
 */
export const FilterValueSchema = Schema.Union([
  Schema.TaggedStruct("string", { value: Schema.String }),
  Schema.TaggedStruct("number", { value: Schema.Number }),
  Schema.TaggedStruct("boolean", { value: Schema.Boolean }),
  Schema.TaggedStruct("null", {}),
  Schema.TaggedStruct("list", {
    values: Schema.Array(
      Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
    ),
  }),
]);

export type FilterValue = Schema.Schema.Type<typeof FilterValueSchema>;

export const FilterOperatorSchema = Schema.Literals([
  "eq",
  "ne",
  "contains",
  "startsWith",
  "endsWith",
  "matchesRegex",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "notIn",
  "exists",
  "notExists",
]);

export type FilterOperator = Schema.Schema.Type<typeof FilterOperatorSchema>;

export const FilterTextModeSchema = Schema.Literals(["substring", "regex"]);

export type FilterTextMode = Schema.Schema.Type<typeof FilterTextModeSchema>;

/**
 * Runtime shape of a filter node. Declared as a TS interface so the recursive
 * schema below can be typed explicitly — without the annotation, TypeScript
 * cannot stabilise the self-referential type (see Effect Schema docs on
 * recursive schemas).
 */
export type FilterNode =
  | { readonly _tag: "and"; readonly children: ReadonlyArray<FilterNode> }
  | { readonly _tag: "or"; readonly children: ReadonlyArray<FilterNode> }
  | { readonly _tag: "not"; readonly child: FilterNode }
  | {
      readonly _tag: "cmp";
      readonly field: FilterField;
      readonly op: FilterOperator;
      // `| undefined` is required alongside `?` because the repo enables
      // `exactOptionalPropertyTypes`, and `Schema.optional` produces an
      // encoded shape where the property may be either absent or
      // explicitly `undefined`.
      readonly value?: FilterValue | undefined;
    }
  | {
      readonly _tag: "text";
      readonly query: string;
      readonly mode?: FilterTextMode | undefined;
    };

const FilterNodeRef = Schema.suspend((): Schema.Codec<FilterNode> => FilterNodeSchema);

export const FilterNodeSchema: Schema.Codec<FilterNode> = Schema.Union([
  Schema.TaggedStruct("and", { children: Schema.Array(FilterNodeRef) }),
  Schema.TaggedStruct("or", { children: Schema.Array(FilterNodeRef) }),
  Schema.TaggedStruct("not", { child: FilterNodeRef }),
  Schema.TaggedStruct("cmp", {
    field: FilterFieldSchema,
    op: FilterOperatorSchema,
    value: Schema.optional(FilterValueSchema),
  }),
  Schema.TaggedStruct("text", {
    query: Schema.String,
    mode: Schema.optional(FilterTextModeSchema),
  }),
]);

const decodeFilterNodeSchema = Schema.decodeUnknownSync(FilterNodeSchema);

export function decodeFilterNode(input: unknown): FilterNode {
  return decodeFilterNodeSchema(input);
}

/**
 * Raised by the SQL compiler (and surfaced over HTTP as a 400) when an AST is
 * structurally fine but references a field path or literal that cannot be
 * compiled safely — e.g. an attribute segment with shell-breaking characters.
 * Never thrown by the pure client-side evaluator, which tolerates anything
 * the schema accepts.
 */
export class InvalidFilterError extends Schema.TaggedErrorClass<InvalidFilterError>()(
  "InvalidFilterError",
  {
    reason: Schema.String,
  },
) {}

/**
 * Subset of `TelemetryLogEntry` that the evaluator needs. Declared here
 * structurally so this module stays free of a circular import on the full
 * entry schema (which lives in `index.ts`).
 */
interface EvaluatedEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly sourceName: string;
  readonly level: string;
  readonly message: string;
  readonly severityNumber: number | null;
  readonly severityText: string | null;
  readonly serviceName: string | null;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
}

/**
 * Top-level field keys that the evaluator resolves directly from the log
 * entry instead of looking them up under `attributes`.
 */
const TOP_LEVEL_FIELDS = new Set<string>([
  "id",
  "timestamp",
  "level",
  "message",
  "sourceName",
  "severityNumber",
  "severityText",
  "serviceName",
  "traceId",
  "spanId",
]);

function resolveField(entry: EvaluatedEntry, path: ReadonlyArray<string>): unknown {
  if (path.length === 0) {
    return undefined;
  }

  const first = path[0];
  if (first === "attributes") {
    let current: unknown = entry.attributes;
    for (let index = 1; index < path.length; index += 1) {
      if (current === null || typeof current !== "object") {
        return undefined;
      }
      const segment = path[index];
      if (segment === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  if (first !== undefined && TOP_LEVEL_FIELDS.has(first)) {
    return (entry as unknown as Record<string, unknown>)[first];
  }

  return undefined;
}

function toComparable(value: unknown): number | string | boolean | null | undefined {
  if (value === null || value === undefined) {
    return value === undefined ? undefined : null;
  }
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function safeRegExp(source: string, flags = "i"): RegExp | null {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function filterValueToComparable(value: FilterValue): number | string | boolean | null {
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
      return "";
  }
}

function compareNumeric(left: unknown, right: FilterValue): number | null {
  const leftNumber = asNumber(left);
  if (leftNumber === undefined) {
    return null;
  }
  if (right._tag === "number") {
    return leftNumber === right.value ? 0 : leftNumber < right.value ? -1 : 1;
  }
  if (right._tag === "string") {
    const rightNumber = asNumber(right.value);
    if (rightNumber === undefined) {
      return null;
    }
    return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  }
  return null;
}

function evaluateComparison(
  entry: EvaluatedEntry,
  field: FilterField,
  op: FilterOperator,
  value: FilterValue | undefined,
): boolean {
  const resolved = resolveField(entry, field.path);

  if (op === "exists") {
    return resolved !== undefined && resolved !== null;
  }
  if (op === "notExists") {
    return resolved === undefined || resolved === null;
  }

  if (value === undefined) {
    return false;
  }

  if (op === "in" || op === "notIn") {
    const list = value._tag === "list" ? value.values : [filterValueToComparable(value)];
    const resolvedComparable = toComparable(resolved);
    const isIn = list.some((candidate) => candidate === resolvedComparable);
    return op === "in" ? isIn : !isIn;
  }

  if (op === "eq" || op === "ne") {
    if (value._tag === "null") {
      const isNull = resolved === null || resolved === undefined;
      return op === "eq" ? isNull : !isNull;
    }
    const rhs = filterValueToComparable(value);
    const equal = toComparable(resolved) === rhs;
    return op === "eq" ? equal : !equal;
  }

  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    const delta = compareNumeric(resolved, value);
    if (delta === null) {
      return false;
    }
    switch (op) {
      case "gt":
        return delta > 0;
      case "gte":
        return delta >= 0;
      case "lt":
        return delta < 0;
      case "lte":
        return delta <= 0;
    }
  }

  if (op === "contains" || op === "startsWith" || op === "endsWith") {
    const haystack = asString(resolved);
    const needleRaw = value._tag === "string" ? value.value : undefined;
    if (haystack === undefined || needleRaw === undefined) {
      return false;
    }
    const haystackLower = haystack.toLowerCase();
    const needleLower = needleRaw.toLowerCase();
    switch (op) {
      case "contains":
        return haystackLower.includes(needleLower);
      case "startsWith":
        return haystackLower.startsWith(needleLower);
      case "endsWith":
        return haystackLower.endsWith(needleLower);
    }
  }

  if (op === "matchesRegex") {
    const haystack = asString(resolved);
    const pattern = value._tag === "string" ? value.value : undefined;
    if (haystack === undefined || pattern === undefined) {
      return false;
    }
    const regex = safeRegExp(pattern);
    return regex === null ? false : regex.test(haystack);
  }

  return false;
}

function evaluateText(entry: EvaluatedEntry, query: string, mode: FilterTextMode): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return true;
  }

  let attributesText = "";
  try {
    attributesText = JSON.stringify(entry.attributes);
  } catch {
    attributesText = "";
  }

  const haystacks: ReadonlyArray<string> = [
    entry.message,
    entry.sourceName,
    entry.level,
    entry.severityText ?? "",
    entry.serviceName ?? "",
    entry.traceId ?? "",
    entry.spanId ?? "",
    attributesText,
  ];

  if (mode === "regex") {
    const regex = safeRegExp(trimmed);
    if (regex === null) {
      return false;
    }
    return haystacks.some((haystack) => regex.test(haystack));
  }

  const needle = trimmed.toLowerCase();
  return haystacks.some((haystack) => haystack.toLowerCase().includes(needle));
}

/**
 * Pure, synchronous AST evaluator. Safe to call in hot paths (log stream,
 * thousand-entry tables) — no allocations per call beyond the JSON stringify
 * for the text-search backdrop.
 *
 * Unknown operators return `false` so a future wire-level op that this client
 * version hasn't learned about never throws — the log just doesn't match.
 */
export function evaluateFilter(ast: FilterNode, entry: EvaluatedEntry): boolean {
  switch (ast._tag) {
    case "and": {
      for (const child of ast.children) {
        if (!evaluateFilter(child, entry)) {
          return false;
        }
      }
      return true;
    }
    case "or": {
      if (ast.children.length === 0) {
        return false;
      }
      for (const child of ast.children) {
        if (evaluateFilter(child, entry)) {
          return true;
        }
      }
      return false;
    }
    case "not":
      return !evaluateFilter(ast.child, entry);
    case "cmp":
      return evaluateComparison(entry, ast.field, ast.op, ast.value);
    case "text":
      return evaluateText(entry, ast.query, ast.mode ?? "substring");
  }
}

/**
 * Validates each path segment after "attributes" is safe to interpolate into
 * a DuckDB `json_extract_string` path literal. Exported so the SQL compiler
 * and HTTP handlers can share the exact same rule.
 */
export const ATTRIBUTE_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Helper predicate used by the SQL compiler and UI validation. */
export function isValidAttributeSegment(segment: string): boolean {
  return ATTRIBUTE_SEGMENT_PATTERN.test(segment);
}

/**
 * Small constructor helpers. Not required by the wire format — the UI builds
 * ASTs with plain objects — but they make tests and call sites more readable.
 */
export const Filter = {
  and(children: ReadonlyArray<FilterNode>): FilterNode {
    return { _tag: "and", children };
  },
  or(children: ReadonlyArray<FilterNode>): FilterNode {
    return { _tag: "or", children };
  },
  not(child: FilterNode): FilterNode {
    return { _tag: "not", child };
  },
  cmp(
    path: ReadonlyArray<string>,
    op: FilterOperator,
    value?: FilterValue,
  ): FilterNode {
    if (path.length === 0) {
      throw new Error("Filter.cmp requires a non-empty field path.");
    }
    const field: FilterField = { path: path as unknown as readonly [string, ...ReadonlyArray<string>] };
    return value === undefined ? { _tag: "cmp", field, op } : { _tag: "cmp", field, op, value };
  },
  text(query: string, mode?: FilterTextMode): FilterNode {
    return mode === undefined ? { _tag: "text", query } : { _tag: "text", query, mode };
  },
  stringValue(value: string): FilterValue {
    return { _tag: "string", value };
  },
  numberValue(value: number): FilterValue {
    return { _tag: "number", value };
  },
  booleanValue(value: boolean): FilterValue {
    return { _tag: "boolean", value };
  },
  nullValue(): FilterValue {
    return { _tag: "null" };
  },
  listValue(values: ReadonlyArray<string | number | boolean>): FilterValue {
    return { _tag: "list", values };
  },
};
