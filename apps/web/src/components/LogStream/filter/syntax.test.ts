import { describe, expect, it } from "vite-plus/test";

import type { TelemetryLogField } from "~/data/logApi";

import {
  completeParsedPills,
  defaultOperatorTokenForKind,
  parsedToFilter,
  parseFilterInput,
  preferredTokenForOperator,
  serialisePill,
} from "./syntax";

const levelField: TelemetryLogField = {
  path: ["level"],
  label: "Level",
  kind: "enum",
  values: ["info", "warn", "error"],
};

const messageField: TelemetryLogField = {
  path: ["message"],
  label: "Message",
  kind: "string",
};

const serviceNameField: TelemetryLogField = {
  path: ["serviceName"],
  label: "serviceName",
  kind: "string",
};

const requestIdField: TelemetryLogField = {
  path: ["attributes", "requestId"],
  label: "requestId",
  kind: "string",
};

const statusField: TelemetryLogField = {
  path: ["attributes", "http", "status_code"],
  label: "http.status_code",
  kind: "number",
};

const catalog: ReadonlyArray<TelemetryLogField> = [
  levelField,
  messageField,
  serviceNameField,
  requestIdField,
  statusField,
];

describe("parseFilterInput — pills", () => {
  it("returns no pills for an empty input", () => {
    const result = parseFilterInput("", 0);
    expect(result.pills).toEqual([]);
    expect(result.trailingText).toBe("");
    expect(result.cursorContext).toEqual({ kind: "field", prefix: "" });
  });

  it("emits a pill for `level:info ` (trailing space commits)", () => {
    const source = "level:info ";
    const result = parseFilterInput(source, source.length);
    expect(result.pills).toHaveLength(1);
    const pill = result.pills[0];
    if (!pill) throw new Error("missing pill");
    expect(pill.fieldPath).toEqual(["level"]);
    expect(pill.operator).toBe("eq");
    expect(pill.operatorToken).toBe(":");
    expect(pill.rawValue).toBe("info");
    expect(pill.negated).toBe(false);
    expect(pill.valueWasQuoted).toBe(false);
  });

  it("leaves a pill-shaped bareword at EOF as trailing text", () => {
    // No trailing whitespace: user is still typing the value.
    const result = parseFilterInput("level:info", 10);
    expect(result.pills).toHaveLength(0);
    expect(result.trailingText).toBe("level:info");
    expect(result.cursorContext.kind).toBe("value");
    if (result.cursorContext.kind !== "value") throw new Error("unexpected");
    expect(result.cursorContext.valuePrefix).toBe("info");
  });

  it("exposes a complete EOF pill for renderers without committing it in parser state", () => {
    const source = "level:error serviceName:api";
    const result = parseFilterInput(source, source.length);
    const pills = completeParsedPills(result);

    expect(result.pills).toHaveLength(1);
    expect(result.trailingText).toBe("serviceName:api");
    expect(pills).toHaveLength(2);
    expect(pills[1]?.fieldPath).toEqual(["serviceName"]);
    expect(pills[1]?.rawValue).toBe("api");
    expect(pills[1]?.start).toBe("level:error ".length);
    expect(pills[1]?.end).toBe(source.length);
  });

  it("keeps an unfinished pill as trailing text", () => {
    const source = "level:info foo";
    const result = parseFilterInput(source, source.length);
    expect(result.pills).toHaveLength(1);
    expect(result.trailingText).toBe("foo");
    expect(result.cursorContext).toEqual({ kind: "field", prefix: "foo" });
  });

  it("parses quoted values with spaces as a single pill", () => {
    const source = 'message:"multi word value" ';
    const result = parseFilterInput(source, source.length);
    expect(result.pills).toHaveLength(1);
    const pill = result.pills[0];
    if (!pill) throw new Error("missing pill");
    expect(pill.rawValue).toBe("multi word value");
    expect(pill.valueWasQuoted).toBe(true);
  });

  it("decodes backslash escapes inside quoted values", () => {
    const source = 'message:"quot\\"ed" ';
    const result = parseFilterInput(source, source.length);
    expect(result.pills).toHaveLength(1);
    const pill = result.pills[0];
    if (!pill) throw new Error("missing pill");
    expect(pill.rawValue).toBe('quot"ed');
  });

  it("prefers the longest matching operator token", () => {
    const source = "status!=500 ";
    const result = parseFilterInput(source, source.length);
    expect(result.pills).toHaveLength(1);
    const pill = result.pills[0];
    if (!pill) throw new Error("missing pill");
    expect(pill.operatorToken).toBe("!=");
    expect(pill.operator).toBe("ne");
  });

  it("parses textual membership operator tokens", () => {
    const source = "level:in:error,warn serviceName:notIn:api,worker ";
    const result = parseFilterInput(source, source.length);

    expect(result.pills[0]?.operatorToken).toBe(":in:");
    expect(result.pills[0]?.operator).toBe("in");
    expect(result.pills[0]?.rawValue).toBe("error,warn");
    expect(result.pills[1]?.operatorToken).toBe(":notIn:");
    expect(result.pills[1]?.operator).toBe("notIn");
    expect(result.pills[1]?.rawValue).toBe("api,worker");
  });

  it("parses quoted membership values as one pill", () => {
    const source = 'level:in:"","warn" ';
    const result = parseFilterInput(source, source.length);

    expect(result.pills).toHaveLength(1);
    expect(result.pills[0]?.operator).toBe("in");
    expect(result.pills[0]?.rawValue).toBe('"","warn"');
    expect(result.pills[0]?.valueWasQuoted).toBe(true);
  });

  it("allows spaces after list separators without ending the pill", () => {
    const source = "level:in:error, warn serviceName:api ";
    const result = parseFilterInput(source, source.length);

    expect(result.pills).toHaveLength(2);
    expect(result.pills[0]?.operator).toBe("in");
    expect(result.pills[0]?.rawValue).toBe("error,warn");
    expect(result.pills[1]?.fieldPath).toEqual(["serviceName"]);
  });

  it("parses the textual regex operator token", () => {
    const source = 'message:re:"error|fatal" ';
    const result = parseFilterInput(source, source.length);
    expect(result.pills[0]?.operatorToken).toBe(":re:");
    expect(result.pills[0]?.operator).toBe("matchesRegex");
    expect(result.pills[0]?.rawValue).toBe("error|fatal");
  });

  it("parses textual valueless operator tokens", () => {
    const source = "level:exists: serviceName:notExists: ";
    const result = parseFilterInput(source, source.length);

    expect(result.pills[0]?.operatorToken).toBe(":exists:");
    expect(result.pills[0]?.operator).toBe("exists");
    expect(result.pills[0]?.rawValue).toBe("");
    expect(result.pills[1]?.operatorToken).toBe(":notExists:");
    expect(result.pills[1]?.operator).toBe("notExists");
    expect(result.pills[1]?.rawValue).toBe("");
  });

  it("treats `level:` (no value) as trailing, not a pill", () => {
    const result = parseFilterInput("level:", 6);
    expect(result.pills).toHaveLength(0);
    expect(result.trailingText).toBe("level:");
    expect(result.cursorContext).toEqual({
      kind: "value",
      fieldPath: ["level"],
      operator: "eq",
      operatorToken: ":",
      negated: false,
      valuePrefix: "",
    });
  });

  it("marks `!~` pills as negated with contains underneath", () => {
    const source = 'requestId!~"abc" ';
    const result = parseFilterInput(source, source.length);
    expect(result.pills).toHaveLength(1);
    const pill = result.pills[0];
    if (!pill) throw new Error("missing pill");
    expect(pill.operator).toBe("contains");
    expect(pill.negated).toBe(true);
  });

  it("parses dotted field paths into segments", () => {
    const source = "attributes.http.status_code>=500 ";
    const result = parseFilterInput(source, source.length);
    expect(result.pills).toHaveLength(1);
    const pill = result.pills[0];
    if (!pill) throw new Error("missing pill");
    expect(pill.fieldPath).toEqual(["attributes", "http", "status_code"]);
    expect(pill.operator).toBe("gte");
  });

  it("parses multiple whitespace-separated pills", () => {
    const source = "level:error status>=500 ";
    const result = parseFilterInput(source, source.length);
    expect(result.pills).toHaveLength(2);
    expect(result.pills[0]?.fieldPath).toEqual(["level"]);
    expect(result.pills[1]?.fieldPath).toEqual(["status"]);
    expect(result.trailingText).toBe("");
  });

  it("rolls an unterminated quoted value back into trailing text", () => {
    const source = 'message:"unterminated';
    const result = parseFilterInput(source, source.length);
    expect(result.pills).toHaveLength(0);
    expect(result.trailingText).toBe('message:"unterminated');
  });
});

describe("parseFilterInput — cursor context", () => {
  it("classifies an ident prefix as `field`", () => {
    const result = parseFilterInput("lev", 3);
    expect(result.cursorContext).toEqual({ kind: "field", prefix: "lev" });
  });

  it("classifies ident + partial op as `operator`", () => {
    const result = parseFilterInput("level!", 6);
    expect(result.cursorContext).toEqual({
      kind: "operator",
      fieldPath: ["level"],
      tokenPrefix: "!",
    });
  });

  it("classifies ident + complete op as `value` with empty prefix", () => {
    const result = parseFilterInput("level:", 6);
    expect(result.cursorContext.kind).toBe("value");
    if (result.cursorContext.kind !== "value") throw new Error("unexpected");
    expect(result.cursorContext.valuePrefix).toBe("");
  });

  it("classifies ident + op + partial value as `value` with prefix", () => {
    const result = parseFilterInput("level:inf", 9);
    expect(result.cursorContext.kind).toBe("value");
    if (result.cursorContext.kind !== "value") throw new Error("unexpected");
    expect(result.cursorContext.valuePrefix).toBe("inf");
  });

  it("treats the cursor inside inserted quotes as an empty value prefix", () => {
    const result = parseFilterInput('level:""', 7);
    expect(result.cursorContext.kind).toBe("value");
    if (result.cursorContext.kind !== "value") throw new Error("unexpected");
    expect(result.cursorContext.valuePrefix).toBe("");
  });

  it("normalises quoted partial values for suggestions", () => {
    const result = parseFilterInput('level:"in"', 9);
    expect(result.cursorContext.kind).toBe("value");
    if (result.cursorContext.kind !== "value") throw new Error("unexpected");
    expect(result.cursorContext.valuePrefix).toBe("in");
  });

  it("resets to `field` context after a committed pill + space", () => {
    const result = parseFilterInput("level:info ", 11);
    expect(result.cursorContext).toEqual({ kind: "field", prefix: "" });
  });
});

describe("parsedToFilter", () => {
  it("returns null for an empty parse result", () => {
    const result = parseFilterInput("", 0);
    expect(parsedToFilter(result, catalog)).toBeNull();
  });

  it("emits a text node for plain free-text input", () => {
    const result = parseFilterInput("timeout", "timeout".length);
    expect(parsedToFilter(result, catalog)).toEqual({
      _tag: "text",
      query: "timeout",
      mode: "substring",
    });
  });

  it("emits a bare cmp node for a single pill", () => {
    const source = "level:error ";
    const result = parseFilterInput(source, source.length);
    expect(parsedToFilter(result, catalog)).toEqual({
      _tag: "cmp",
      field: { path: ["level"] },
      op: "eq",
      value: { _tag: "string", value: "error" },
    });
  });

  it("includes a complete trailing pill at EOF", () => {
    const result = parseFilterInput('serviceName:"hello"', 'serviceName:"hello"'.length);
    expect(parsedToFilter(result, catalog)).toEqual({
      _tag: "cmp",
      field: { path: ["serviceName"] },
      op: "eq",
      value: { _tag: "string", value: "hello" },
    });
  });

  it("wraps negated pills in a `not` node", () => {
    const source = 'requestId!~"abc" ';
    const result = parseFilterInput(source, source.length);
    expect(parsedToFilter(result, catalog)).toEqual({
      _tag: "not",
      child: {
        _tag: "cmp",
        field: { path: ["attributes", "requestId"] },
        op: "contains",
        value: { _tag: "string", value: "abc" },
      },
    });
  });

  it("combines multiple pills into a top-level AND", () => {
    const source = "level:error attributes.http.status_code>=500 ";
    const result = parseFilterInput(source, source.length);
    const filter = parsedToFilter(result, catalog);
    expect(filter?._tag).toBe("and");
    if (filter?._tag !== "and") throw new Error("unexpected");
    expect(filter.children).toHaveLength(2);
  });

  it("includes a final complete pill even without trailing whitespace", () => {
    const source = 'level:error serviceName:"hello"';
    const result = parseFilterInput(source, source.length);
    expect(parsedToFilter(result, catalog)).toEqual({
      _tag: "and",
      children: [
        {
          _tag: "cmp",
          field: { path: ["level"] },
          op: "eq",
          value: { _tag: "string", value: "error" },
        },
        {
          _tag: "cmp",
          field: { path: ["serviceName"] },
          op: "eq",
          value: { _tag: "string", value: "hello" },
        },
      ],
    });
  });

  it("emits cmp nodes without values for valueless operators", () => {
    const result = parseFilterInput(
      "level:exists: serviceName:notExists:",
      "level:exists: serviceName:notExists:".length,
    );

    expect(parsedToFilter(result, catalog)).toEqual({
      _tag: "and",
      children: [
        {
          _tag: "cmp",
          field: { path: ["level"] },
          op: "exists",
        },
        {
          _tag: "cmp",
          field: { path: ["serviceName"] },
          op: "notExists",
        },
      ],
    });
  });

  it("emits list values for textual membership operators", () => {
    const result = parseFilterInput("level:in:error,warn", "level:in:error,warn".length);

    expect(parsedToFilter(result, catalog)).toEqual({
      _tag: "cmp",
      field: { path: ["level"] },
      op: "in",
      value: { _tag: "list", values: ["error", "warn"] },
    });
  });

  it("emits list values when source has spaces after separators", () => {
    const result = parseFilterInput("level:in:error, warn", "level:in:error, warn".length);

    expect(parsedToFilter(result, catalog)).toEqual({
      _tag: "cmp",
      field: { path: ["level"] },
      op: "in",
      value: { _tag: "list", values: ["error", "warn"] },
    });
  });

  it("preserves explicit empty strings in quoted membership operators", () => {
    const result = parseFilterInput('level:in:"","warn"', 'level:in:"","warn"'.length);

    expect(parsedToFilter(result, catalog)).toEqual({
      _tag: "cmp",
      field: { path: ["level"] },
      op: "in",
      value: { _tag: "list", values: ["", "warn"] },
    });
  });

  it("combines committed pills with trailing free text", () => {
    const source = "level:error timeout";
    const result = parseFilterInput(source, source.length);
    expect(parsedToFilter(result, catalog)).toEqual({
      _tag: "and",
      children: [
        {
          _tag: "cmp",
          field: { path: ["level"] },
          op: "eq",
          value: { _tag: "string", value: "error" },
        },
        {
          _tag: "text",
          query: "timeout",
          mode: "substring",
        },
      ],
    });
  });

  it("does not turn partial structured syntax into free-text search", () => {
    expect(parsedToFilter(parseFilterInput("level:", 6), catalog)).toBeNull();
    expect(parsedToFilter(parseFilterInput('serviceName:"hel', 'serviceName:"hel'.length), catalog)).toBeNull();
  });

  it("drops pills that reference unknown fields", () => {
    const source = "mystery_field:x level:info ";
    const result = parseFilterInput(source, source.length);
    const filter = parsedToFilter(result, catalog);
    // Only `level:info` survives (committed by trailing space).
    expect(filter).toEqual({
      _tag: "cmp",
      field: { path: ["level"] },
      op: "eq",
      value: { _tag: "string", value: "info" },
    });
  });

  it("drops pills with invalid numeric values", () => {
    const source = "attributes.http.status_code>=banana ";
    const result = parseFilterInput(source, source.length);
    expect(parsedToFilter(result, catalog)).toBeNull();
  });
});

describe("serialisePill round-trip", () => {
  it("round-trips a simple pill", () => {
    const source = "level:info ";
    const parsed = parseFilterInput(source, source.length);
    const pill = parsed.pills[0];
    if (!pill) throw new Error("missing pill");
    expect(serialisePill(pill)).toBe("level:info");
  });

  it("re-quotes values that need quoting", () => {
    const source = 'message:"foo bar" ';
    const parsed = parseFilterInput(source, source.length);
    const pill = parsed.pills[0];
    if (!pill) throw new Error("missing pill");
    expect(serialisePill(pill)).toBe('message:"foo bar"');
  });

  it("quotes values containing embedded quotes", () => {
    const source = 'message:"a\\"b" ';
    const parsed = parseFilterInput(source, source.length);
    const pill = parsed.pills[0];
    if (!pill) throw new Error("missing pill");
    expect(pill.rawValue).toBe('a"b');
    expect(serialisePill(pill)).toBe('message:"a\\"b"');
  });

  it("serialises valueless pills without adding an empty quoted value", () => {
    const parsed = parseFilterInput("level:exists: ", "level:exists: ".length);
    const pill = parsed.pills[0];
    if (!pill) throw new Error("missing pill");
    expect(serialisePill(pill)).toBe("level:exists:");
  });

  it("serialises quoted list values without wrapping the whole list", () => {
    const parsed = parseFilterInput('level:in:"","warn" ', 'level:in:"","warn" '.length);
    const pill = parsed.pills[0];
    if (!pill) throw new Error("missing pill");
    expect(serialisePill(pill)).toBe('level:in:"","warn"');
  });
});

describe("operator token helpers", () => {
  it("picks `:` as the default for string/enum fields", () => {
    expect(defaultOperatorTokenForKind("string")).toBe(":");
    expect(defaultOperatorTokenForKind("enum")).toBe(":");
  });

  it("picks `=` as the default for numeric fields", () => {
    expect(defaultOperatorTokenForKind("number")).toBe("=");
  });

  it("maps operators back to their preferred shorthand", () => {
    expect(preferredTokenForOperator("eq", false, "string")).toBe(":");
    expect(preferredTokenForOperator("eq", false, "number")).toBe("=");
    expect(preferredTokenForOperator("ne", false, "number")).toBe("!=");
    expect(preferredTokenForOperator("contains", true, "string")).toBe("!~");
    expect(preferredTokenForOperator("in", false, "enum")).toBe(":in:");
    expect(preferredTokenForOperator("notIn", false, "string")).toBe(":notIn:");
    expect(preferredTokenForOperator("matchesRegex", false, "string")).toBe(":re:");
    expect(preferredTokenForOperator("exists", false, "enum")).toBe(":exists:");
    expect(preferredTokenForOperator("notExists", false, "number")).toBe(":notExists:");
  });
});
