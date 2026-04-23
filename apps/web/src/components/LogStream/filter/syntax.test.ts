import { describe, expect, it } from "vite-plus/test";

import type { TelemetryLogField } from "~/data/logApi";

import {
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
  });
});
