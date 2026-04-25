# Lensflare Query Language

`@lensflare/query` is the canonical parser, compiler, and editor language
service for telemetry filter input. The same source string is used by:

- the web filter editor and pill renderer
- MCP/local-server query parsing
- the shared filter AST compiler
- IntelliSense-like completion, semantic token, and diagnostic helpers

The implementation is intentionally small and synchronous. The language service
must be built from the lexer, parser, and AST rather than separate regular
expression heuristics.

## Pipeline

1. `lexQuery(source)` produces tokens with source spans and lexer diagnostics.
2. `parseQuery(source)` produces a recoverable AST and parser diagnostics.
3. `compileQueryToFilterResult(ast, fields)` resolves fields and value types
   into the shared `FilterNode` AST.
4. `analyzeQueryLanguage(source, cursor, fields)` powers editor features:
   cursor context, completions with text edits, semantic tokens, diagnostics,
   parsed pills, and trailing text.

Strict server-side use should call `parseTelemetryQuery(source, fields)`. Editor
use should call `analyzeQueryLanguage` or the compatibility wrapper
`parseFilterInput`.

## Lexical Model

Whitespace separates tokens and is otherwise insignificant, except that editor
cursor analysis uses whitespace to detect when a complete expression has ended.

Token kinds:

- `word`: field paths, bare text, word operators, booleans, `null`
- `string`: double-quoted strings
- `number`: signed decimal and exponent notation
- `regex`: slash-delimited regular expressions with optional flags
- `operator`: symbolic operators
- punctuation: `(`, `)`, `[`, `]`, `,`

Quoted strings support `\"` and `\\`. Other backslash sequences are preserved as
literal backslashes.

Regex literals are parsed as `/pattern/flags`. Character classes are respected,
so `/[a/b]/` does not terminate at the slash inside the class. Regex literals are
validated with JavaScript `RegExp`.

## Expressions

Queries are boolean expressions:

```text
query       := orExpr
orExpr      := andExpr ("or" andExpr)*
andExpr     := notExpr (("and")? notExpr)*
notExpr     := "not" notExpr | primary
primary     := "(" query ")" | fieldExpr | text
fieldExpr   := field operator value?
```

Precedence, from strongest to weakest:

1. parentheses
2. `not`
3. implicit or explicit `and`
4. `or`

Adjacent primaries are implicitly joined with `and`:

```text
timeout level = "error"
```

is equivalent to:

```text
timeout and level = "error"
```

Bare words that are not field expressions become full-text search nodes:

```text
timeout ECONNRESET
```

compiles to an `and` of text filters.

## Fields

Fields are word tokens with dot-separated segments:

```text
level
durationUs
attributes.http.status_code
attr.http.status_code
relatedEvents.name
```

Field resolution checks, in order:

1. exact catalog path
2. `attr.` shorthand mapped to `attributes.`
3. catalog label
4. catalog id
5. built-in fallback fields
6. dynamic `attr.*`, `attributes.*`, and `relatedEvents.*` fallback paths

Unknown fields are parser-valid but compiler-invalid. The editor can still
render an unknown pill and surface a diagnostic.

## Operators

Operators are field-kind aware.

| Token        | AST operator   | Kinds                | Value          |
| ------------ | -------------- | -------------------- | -------------- |
| `=`          | `eq`           | string, number, enum | required       |
| `!=`         | `ne`           | string, number, enum | required       |
| `>`          | `gt`           | number               | required       |
| `>=`         | `gte`          | number               | required       |
| `<`          | `lt`           | number               | required       |
| `<=`         | `lte`          | number               | required       |
| `contains`   | `contains`     | string               | required       |
| `startsWith` | `startsWith`   | string               | required       |
| `endsWith`   | `endsWith`     | string               | required       |
| `~=`         | `matchesRegex` | string               | required       |
| `in`         | `in`           | string, number, enum | array required |
| `not in`     | `notIn`        | string, number, enum | array required |
| `exists`     | `exists`       | string, number, enum | none           |
| `missing`    | `notExists`    | string, number, enum | none           |

Word operators are parsed case-insensitively where needed. The formatter and
pill serializer emit canonical forms such as `startsWith` and `endsWith`.

### Valueless Operators

`exists` and `missing` never take a value:

```text
traceId exists
parentSpanId missing
```

In editor analysis, the cursor after either operator is a new field context, not
a value context:

```text
traceId exists |
traceId exists serviceName|
```

This rule is important because the parser accepts implicit `and`; the second
example is a completed `exists` expression followed by the start of a new
expression.

## Literals

String values may be quoted or bare:

```text
message = "request timeout"
serviceName = api
```

Numbers are parsed with `Number(...)` and must be finite:

```text
durationUs >= 1000
durationUs < 1.5e6
```

Booleans and null are available as unquoted words:

```text
status = null
sampled = true
```

Regex values are only meaningful with `~=`:

```text
message ~= /timeout|ECONNRESET/i
```

Membership operators require array literals:

```text
level in ["error", "fatal"]
status not in ["ok", "unset"]
```

Arrays may contain strings, numbers, and booleans. Nested arrays, regex values,
and `null` inside arrays do not compile to filter values.

Editor completions for `in` and `not in` insert the brackets automatically:

```text
status in [|]
```

When the cursor is inside the brackets, value suggestions are multi-select.
Selecting an unselected value appends it to the array; selecting an already
selected value removes it:

```text
status in [error, ok|]
```

## Diagnostics

Lexer and parser diagnostics are recoverable and include source spans. Examples:

- unexpected character
- unterminated quoted string
- unterminated regex literal
- invalid regex literal
- unexpected keyword or operator
- missing comparison value
- missing closing `)` or `]`

Compiler diagnostics add semantic validation:

- unknown field
- non-numeric literal for numeric fields
- non-array literal for `in` or `not in`
- unsupported literal for a comparison

The language service returns both parse diagnostics and, when fields are
provided, compiler diagnostics.

## Editor Language Service

`analyzeQueryLanguage(source, cursor, fields)` returns:

- `cursorContext`: `field`, `operator`, or `value`
- `completions`: LSP-style items with `textEdit` ranges and cursor offsets
- `semanticTokens`: parser/AST-backed spans for highlighting
- `pills`: complete field expressions extracted from the AST
- `diagnostics`: parse and semantic diagnostics
- `trailingStart` and `trailingText`: compatibility data for legacy splicers

Cursor contexts:

```ts
{ kind: "field", prefix: "lev" }
{ kind: "operator", fieldPath: ["level"], tokenPrefix: "" }
{ kind: "value", fieldPath: ["level"], operator: "eq", operatorToken: "=", negated: false, valuePrefix: "err" }
```

Completion text edits replace only the active prefix:

```text
lev|
```

field completion `level` edits `lev` to:

```text
level |
```

Field completions intentionally stop after the field path. The next cursor
context is `operator`, so the user explicitly chooses `=`, `contains`, `in`, or
another operator.

Value completions use field catalog values when present. Dynamic server-backed
value lookup remains a UI concern, but the context and replacement range come
from the language service.

For list operators, value contexts may include a `list` object:

```ts
{
  kind: "value",
  fieldPath: ["status"],
  operator: "in",
  operatorToken: "in",
  negated: false,
  valuePrefix: "ok",
  list: {
    range: { start: 10, end: 21 },
    values: ["error", "ok"],
    itemRange: { start: 18, end: 20 }
  }
}
```

The command dialog uses this metadata to render checked values and to toggle
array items without reparsing source text in React.

## Edge Cases

- `and`, `or`, and `not` are reserved as boolean keywords in expression
  positions. In value position they can still be parsed as bare string values.
- `not in` is a two-token operator. A standalone `not` before an expression is
  boolean negation.
- `exists` and `missing` are complete expressions immediately after the operator.
  No value placeholder should be inserted after them.
- A complete field expression followed by whitespace starts a new field context.
  Example: `level = error ser|` suggests fields matching `ser`, not values for
  `level`.
- Unknown fields can still form pills, which allows the editor to preserve and
  display user input while surfacing an error.
- Free-text terms are valid expressions. This means a single word followed by
  whitespace is ambiguous; when it resolves as a known field the editor treats
  the next position as an operator context.
- Attribute shorthand `attr.foo.bar` compiles to `attributes.foo.bar`.
- Field labels can contain dots. Catalog resolution prefers exact catalog paths
  and labels before fallback expansion.
- `in` and `not in` require bracketed arrays in the textual language, even
  though row-editor draft values are stored as comma-separated strings.
- Regex literals begin with `/`; a plain slash cannot currently start a bare
  text term.

## Compatibility APIs

The older editor helpers are still exported:

- `parseFilterInput`
- `getEditorContext`
- `completeParsedPills`
- suggestion splicers in `splice.ts`

New editor integrations should prefer `analyzeQueryLanguage` and
`applyQueryCompletion` so completion ranges, cursor placement, and semantic
classification stay in one place.
