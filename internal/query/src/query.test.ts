import { describe, expect, it } from "vite-plus/test";
import {
  analyzeQueryLanguage,
  applyFieldSuggestion,
  applyOperatorSuggestion,
  applyQueryCompletion,
  applyValueSuggestion,
  compileQueryToFilter,
  getEditorContext,
  lexQuery,
  operatorSyntaxesForKind,
  parseFilterInput,
  parseQuery,
  parseQueryStrict,
  parseTelemetryQuery,
  QueryLanguageError,
  toggleListValueSuggestion,
} from "./index.ts";
import type { QueryField } from "./index.ts";

const fields: ReadonlyArray<QueryField> = [
  { path: ["level"], label: "level", kind: "enum", values: ["info", "warn", "error", "fatal"] },
  { path: ["status"], label: "status", kind: "enum", values: ["ok", "error", "unset"] },
  { path: ["message"], label: "message", kind: "string" },
  { path: ["serviceName"], label: "serviceName", kind: "string" },
  { path: ["durationUs"], label: "durationUs", kind: "number" },
  { path: ["attributes", "http.status_code"], label: "http.status_code", kind: "number" },
  { path: ["relatedEvents", "name"], label: "relatedEvents.name", kind: "string" },
];

describe("lexer", () => {
  it("returns tokens with source spans", () => {
    const result = lexQuery('level = "error"');
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map((token) => [token.kind, token.text, token.span])).toEqual([
      ["word", "level", { start: 0, end: 5 }],
      ["operator", "=", { start: 6, end: 7 }],
      ["string", "error", { start: 8, end: 15 }],
    ]);
  });
});

describe("parser", () => {
  it("parses bare text search as implicit AND terms", () => {
    const ast = parseQueryStrict("timeout ECONNRESET");
    expect(ast).toMatchObject({
      kind: "and",
      children: [
        { kind: "text", value: "timeout" },
        { kind: "text", value: "ECONNRESET" },
      ],
    });
  });

  it("parses comparisons, typed values, and implicit full text", () => {
    const ast = parseQueryStrict('timeout level = "error" durationUs >= 1000');
    expect(ast).toMatchObject({
      kind: "and",
      children: [
        { kind: "text", value: "timeout" },
        { kind: "comparison", operator: "eq", value: { kind: "string", value: "error" } },
        { kind: "comparison", operator: "gte", value: { kind: "number", value: 1000 } },
      ],
    });
  });

  it("parses full boolean syntax and parentheses", () => {
    const ast = parseQueryStrict('(level in ["error", "fatal"]) or status = "error"');
    expect(ast).toMatchObject({
      kind: "or",
      children: [
        { kind: "group", child: { kind: "comparison", operator: "in" } },
        { kind: "comparison", operator: "eq" },
      ],
    });
  });

  it("parses contains, startsWith, endsWith, regex, exists, and missing", () => {
    expect(parseQueryStrict('message contains "timeout"')).toMatchObject({
      kind: "comparison",
      operator: "contains",
    });
    expect(parseQueryStrict('message startsWith "GET"')).toMatchObject({
      kind: "comparison",
      operator: "startsWith",
    });
    expect(parseQueryStrict('message endsWith "done"')).toMatchObject({
      kind: "comparison",
      operator: "endsWith",
    });
    expect(parseQueryStrict("message ~= /timeout|ECONNRESET/")).toMatchObject({
      kind: "comparison",
      operator: "matchesRegex",
      value: { kind: "regex", pattern: "timeout|ECONNRESET" },
    });
    expect(parseQueryStrict("traceId exists")).toMatchObject({ kind: "exists", present: true });
    expect(parseQueryStrict("parentSpanId missing")).toMatchObject({
      kind: "exists",
      present: false,
    });
  });

  it("returns diagnostics for malformed input", () => {
    const result = parseQuery('message = "unterminated');
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(() => parseQueryStrict('message = "unterminated')).toThrow(QueryLanguageError);
  });

  it("returns diagnostics for invalid regex literals", () => {
    const result = parseQuery("message ~= /(/");
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("Invalid"))).toBe(
      true,
    );
  });
});

describe("compiler", () => {
  it("compiles to the existing FilterNode AST", () => {
    expect(
      parseTelemetryQuery('(level in ["error", "fatal"]) or status = "error"', fields),
    ).toEqual({
      _tag: "or",
      children: [
        {
          _tag: "cmp",
          field: { path: ["level"] },
          op: "in",
          value: { _tag: "list", values: ["error", "fatal"] },
        },
        {
          _tag: "cmp",
          field: { path: ["status"] },
          op: "eq",
          value: { _tag: "string", value: "error" },
        },
      ],
    });
  });

  it("resolves attributes, attr shorthand, and related events", () => {
    expect(
      parseTelemetryQuery("attr.http.status_code >= 500 relatedEvents.name = exception", fields),
    ).toEqual({
      _tag: "and",
      children: [
        {
          _tag: "cmp",
          field: { path: ["attributes", "http.status_code"] },
          op: "gte",
          value: { _tag: "number", value: 500 },
        },
        {
          _tag: "cmp",
          field: { path: ["relatedEvents", "name"] },
          op: "eq",
          value: { _tag: "string", value: "exception" },
        },
      ],
    });
  });

  it("reports unknown fields in strict compilation", () => {
    expect(() => parseTelemetryQuery('unknown = "x"', fields)).toThrow(QueryLanguageError);
    const result = parseQuery('unknown = "x"');
    expect(compileQueryToFilter(result.ast, fields)).toBeNull();
  });

  it("rejects non-numeric literals for numeric comparisons", () => {
    expect(() => parseTelemetryQuery('durationUs >= "slow"', fields)).toThrow(QueryLanguageError);
  });
});

describe("editor context", () => {
  it("detects partial field/operator/value contexts", () => {
    expect(getEditorContext("lev", 3, fields).cursorContext).toEqual({
      kind: "field",
      prefix: "lev",
    });
    expect(getEditorContext("level ", 6, fields).cursorContext).toEqual({
      kind: "operator",
      fieldPath: ["level"],
      tokenPrefix: "",
    });
    expect(getEditorContext("level = ", 8, fields).cursorContext).toEqual({
      kind: "value",
      fieldPath: ["level"],
      operator: "eq",
      operatorToken: "=",
      negated: false,
      valuePrefix: "",
    });
  });

  it("resets to field suggestions after whitespace following a complete filter", () => {
    expect(
      getEditorContext('kind = "span" ', 'kind = "span" '.length, fields).cursorContext,
    ).toEqual({
      kind: "field",
      prefix: "",
    });
  });

  it("does not request values after valueless operators", () => {
    for (const source of ["traceId exists ", "parentSpanId missing "]) {
      expect(getEditorContext(source, source.length, fields).cursorContext).toEqual({
        kind: "field",
        prefix: "",
      });
    }
  });

  it("starts a new field context after complete expressions", () => {
    expect(
      getEditorContext("traceId exists serv", "traceId exists serv".length, fields).cursorContext,
    ).toEqual({
      kind: "field",
      prefix: "serv",
    });
    expect(
      getEditorContext("level = error sta", "level = error sta".length, fields).cursorContext,
    ).toEqual({
      kind: "field",
      prefix: "sta",
    });
  });
});

describe("language service", () => {
  it("returns LSP-style completions with text edits", () => {
    const fieldAnalysis = analyzeQueryLanguage("lev", 3, fields);
    const fieldCompletion = fieldAnalysis.completions.find(
      (completion) => completion.label === "level",
    );
    expect(fieldCompletion).toMatchObject({
      kind: "field",
      textEdit: {
        range: { start: 0, end: 3 },
        newText: "level ",
        cursorOffset: 6,
      },
    });
    expect(
      fieldCompletion === undefined ? null : applyQueryCompletion("lev", fieldCompletion),
    ).toEqual({
      source: "level ",
      cursor: 6,
    });
    expect(getEditorContext("level ", 6, fields).cursorContext).toEqual({
      kind: "operator",
      fieldPath: ["level"],
      tokenPrefix: "",
    });

    const operatorAnalysis = analyzeQueryLanguage("durationUs !", "durationUs !".length, fields);
    expect(operatorAnalysis.completions.map((completion) => completion.label)).toContain("!=");

    const listOperatorAnalysis = analyzeQueryLanguage("status i", "status i".length, fields);
    const listOperatorCompletion = listOperatorAnalysis.completions.find(
      (completion) => completion.label === "in",
    );
    expect(listOperatorCompletion).toMatchObject({
      kind: "operator",
      textEdit: {
        newText: "in []",
        cursorOffset: 4,
      },
    });

    const valueAnalysis = analyzeQueryLanguage("level = e", "level = e".length, fields);
    const valueCompletion = valueAnalysis.completions.find(
      (completion) => completion.label === "error",
    );
    expect(valueCompletion).toMatchObject({
      kind: "value",
      textEdit: {
        range: { start: 8, end: 9 },
        newText: "error ",
        cursorOffset: 6,
      },
    });

    const quotedValueAnalysis = analyzeQueryLanguage('level = "er"', 'level = "er'.length, fields);
    const quotedValueCompletion = quotedValueAnalysis.completions.find(
      (completion) => completion.label === "error",
    );
    expect(quotedValueCompletion).toMatchObject({
      kind: "value",
      textEdit: {
        range: { start: 8, end: 12 },
        newText: "error ",
        cursorOffset: 6,
      },
    });
  });

  it("classifies semantic tokens from the parser AST", () => {
    const result = analyzeQueryLanguage('level = "error" and traceId exists', 0, fields);
    expect(result.semanticTokens).toEqual(
      expect.arrayContaining([
        { kind: "field", start: 0, end: 5 },
        { kind: "operator", start: 6, end: 7 },
        { kind: "value", start: 8, end: 15 },
        { kind: "keyword", start: 16, end: 19 },
        { kind: "field", start: 20, end: 27 },
        { kind: "operator", start: 28, end: 34 },
      ]),
    );
  });

  it("tracks selected list values when the cursor is inside an array literal", () => {
    expect(
      analyzeQueryLanguage("status in []", "status in [".length, fields).cursorContext,
    ).toMatchObject({
      kind: "value",
      fieldPath: ["status"],
      operator: "in",
      valuePrefix: "",
      list: {
        range: { start: 10, end: 12 },
        values: [],
      },
    });

    const result = analyzeQueryLanguage(
      "status in [error, ok]",
      "status in [error, ok".length,
      fields,
    );

    expect(result.cursorContext).toMatchObject({
      kind: "value",
      fieldPath: ["status"],
      operator: "in",
      valuePrefix: "ok",
      list: {
        range: { start: 10, end: 21 },
        values: ["error", "ok"],
      },
    });
  });
});

describe("suggestion splicing", () => {
  it("inserts only the field and leaves the cursor in operator context", () => {
    const source = "mess";
    const field = fields.find((entry) => entry.path.join(".") === "message");

    expect(
      field === undefined
        ? null
        : applyFieldSuggestion(
            {
              source,
              trailingStart: 0,
              trailingText: source,
            },
            field,
          ),
    ).toEqual({
      source: "message ",
      cursor: "message ".length,
    });
  });

  it("preserves the separator before a new expression when applying an operator", () => {
    const source = "serviceName = lensflare-desktop spanId";
    const parsed = parseFilterInput(source, source.length, fields);
    const startsWith = operatorSyntaxesForKind("string").find(
      (syntax) => syntax.token === "startsWith",
    );

    expect(parsed.trailingText).toBe(" spanId");
    expect(
      startsWith === undefined
        ? null
        : applyOperatorSuggestion(
            {
              source,
              trailingStart: parsed.trailingStart,
              trailingText: parsed.trailingText,
            },
            startsWith,
          ),
    ).toEqual({
      source: "serviceName = lensflare-desktop spanId startsWith ",
      cursor: "serviceName = lensflare-desktop spanId startsWith ".length,
    });
  });

  it("wraps list operators in brackets and places the cursor inside", () => {
    const source = "status";
    const parsed = parseFilterInput(source, source.length, fields);
    const listOperator = operatorSyntaxesForKind("enum").find((syntax) => syntax.token === "in");

    expect(
      listOperator === undefined
        ? null
        : applyOperatorSuggestion(
            {
              source,
              trailingStart: parsed.trailingStart,
              trailingText: parsed.trailingText,
            },
            listOperator,
          ),
    ).toEqual({
      source: "status in []",
      cursor: "status in [".length,
    });
  });

  it("preserves the separator before a new expression when applying a value", () => {
    const source = "serviceName = lensflare-desktop level = ";
    const trailingStart = "serviceName = lensflare-desktop".length;

    expect(
      applyValueSuggestion(
        {
          source,
          trailingStart,
          trailingText: source.slice(trailingStart),
        },
        "error",
      ),
    ).toEqual({
      source: "serviceName = lensflare-desktop level = error ",
      cursor: "serviceName = lensflare-desktop level = error ".length,
    });
  });

  it("applies a value after an incomplete not-equals expression", () => {
    const source = "message != ";
    const parsed = parseFilterInput(source, source.length, fields);

    expect(parsed.trailingText).toBe(source);
    expect(
      applyValueSuggestion(
        {
          source,
          trailingStart: parsed.trailingStart,
          trailingText: parsed.trailingText,
        },
        "DatasetService.listDatasets",
      ),
    ).toEqual({
      source: "message != DatasetService.listDatasets ",
      cursor: "message != DatasetService.listDatasets ".length,
    });
  });

  it("wraps values for list operators when brackets are missing", () => {
    const source = "status in ";
    expect(
      applyValueSuggestion(
        {
          source,
          trailingStart: 0,
          trailingText: source,
        },
        "error",
      ),
    ).toEqual({
      source: "status in [error] ",
      cursor: "status in [error] ".length,
    });
  });

  it("toggles values inside list literals", () => {
    const source = "status in [error]";
    const parsed = parseFilterInput(source, "status in [error".length, fields);

    if (parsed.cursorContext.kind !== "value" || parsed.cursorContext.list === undefined) {
      throw new Error("Expected list value context.");
    }

    expect(toggleListValueSuggestion(source, parsed.cursorContext.list, "ok")).toEqual({
      source: "status in [error, ok]",
      cursor: "status in [error, ok".length,
    });
    expect(toggleListValueSuggestion(source, parsed.cursorContext.list, "error")).toEqual({
      source: "status in []",
      cursor: "status in [".length,
    });
  });
});
