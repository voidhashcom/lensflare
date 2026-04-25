import { describe, expect, it } from "vite-plus/test";

import {
  ATTRIBUTE_SEGMENT_PATTERN,
  decodeFilterNode,
  evaluateFilter,
  Filter,
  isValidAttributeSegment,
} from "./filter.ts";

// Minimal structural entry the evaluator understands. Mirrors the shape the
// local server emits into the log stream once the wire format is extended,
// without depending on the concrete TelemetryLogEntry schema here.
interface TestEntry {
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

function entry(overrides: Partial<TestEntry> = {}): TestEntry {
  return {
    id: "log-1",
    timestamp: "2026-04-23T10:00:00.000Z",
    sourceName: "api-server",
    level: "info",
    message: "Handled request",
    severityNumber: 9,
    severityText: "INFO",
    serviceName: "api",
    traceId: "trace-1",
    spanId: "span-1",
    attributes: {},
    ...overrides,
  };
}

describe("FilterNodeSchema decoding", () => {
  it("decodes a simple cmp node", () => {
    const decoded = decodeFilterNode({
      _tag: "cmp",
      field: { path: ["level"] },
      op: "eq",
      value: { _tag: "string", value: "error" },
    });
    expect(decoded._tag).toBe("cmp");
  });

  it("decodes a nested and/or/not tree", () => {
    const decoded = decodeFilterNode({
      _tag: "and",
      children: [
        { _tag: "text", query: "oops" },
        {
          _tag: "or",
          children: [
            {
              _tag: "cmp",
              field: { path: ["level"] },
              op: "eq",
              value: { _tag: "string", value: "error" },
            },
            {
              _tag: "not",
              child: {
                _tag: "cmp",
                field: { path: ["serviceName"] },
                op: "exists",
              },
            },
          ],
        },
      ],
    });
    expect(decoded._tag).toBe("and");
  });

  it("rejects unknown operators", () => {
    expect(() =>
      decodeFilterNode({
        _tag: "cmp",
        field: { path: ["level"] },
        op: "definitely-not-a-real-op",
      }),
    ).toThrow();
  });

  it("rejects empty field paths", () => {
    expect(() =>
      decodeFilterNode({
        _tag: "cmp",
        field: { path: [] },
        op: "exists",
      }),
    ).toThrow();
  });
});

describe("evaluateFilter - cmp eq/ne", () => {
  it("matches eq on a top-level field", () => {
    const ast = Filter.cmp(["level"], "eq", Filter.stringValue("info"));
    expect(evaluateFilter(ast, entry())).toBe(true);
    expect(evaluateFilter(ast, entry({ level: "error" }))).toBe(false);
  });

  it("matches ne as the negation of eq", () => {
    const ast = Filter.cmp(["level"], "ne", Filter.stringValue("info"));
    expect(evaluateFilter(ast, entry())).toBe(false);
    expect(evaluateFilter(ast, entry({ level: "error" }))).toBe(true);
  });

  it("treats eq against the null tag as an IS NULL check", () => {
    const ast = Filter.cmp(["traceId"], "eq", Filter.nullValue());
    expect(evaluateFilter(ast, entry({ traceId: null }))).toBe(true);
    expect(evaluateFilter(ast, entry({ traceId: "trace-x" }))).toBe(false);
  });
});

describe("evaluateFilter - numeric comparisons", () => {
  const base = entry({ severityNumber: 17 });

  it("gt / gte / lt / lte on numeric fields", () => {
    expect(evaluateFilter(Filter.cmp(["severityNumber"], "gt", Filter.numberValue(10)), base)).toBe(
      true,
    );
    expect(evaluateFilter(Filter.cmp(["severityNumber"], "gt", Filter.numberValue(17)), base)).toBe(
      false,
    );
    expect(
      evaluateFilter(Filter.cmp(["severityNumber"], "gte", Filter.numberValue(17)), base),
    ).toBe(true);
    expect(evaluateFilter(Filter.cmp(["severityNumber"], "lt", Filter.numberValue(20)), base)).toBe(
      true,
    );
    expect(evaluateFilter(Filter.cmp(["severityNumber"], "lt", Filter.numberValue(17)), base)).toBe(
      false,
    );
    expect(
      evaluateFilter(Filter.cmp(["severityNumber"], "lte", Filter.numberValue(17)), base),
    ).toBe(true);
  });

  it("coerces numeric strings in attributes when ordering", () => {
    const withAttr = entry({ attributes: { "http.status_code": "503" } });
    const ast = Filter.cmp(["attributes", "http.status_code"], "gte", Filter.numberValue(500));
    expect(evaluateFilter(ast, withAttr)).toBe(true);
  });

  it("returns false when the field cannot be coerced to a number", () => {
    const bogus = entry({ attributes: { "http.status_code": "not-a-number" } });
    const ast = Filter.cmp(["attributes", "http.status_code"], "gt", Filter.numberValue(100));
    expect(evaluateFilter(ast, bogus)).toBe(false);
  });
});

describe("evaluateFilter - string operators", () => {
  const base = entry({ message: "Connection TIMED OUT after 30s" });

  it("contains / startsWith / endsWith are case-insensitive", () => {
    expect(
      evaluateFilter(Filter.cmp(["message"], "contains", Filter.stringValue("timed out")), base),
    ).toBe(true);
    expect(
      evaluateFilter(Filter.cmp(["message"], "startsWith", Filter.stringValue("CONNECTION")), base),
    ).toBe(true);
    expect(
      evaluateFilter(Filter.cmp(["message"], "endsWith", Filter.stringValue("30S")), base),
    ).toBe(true);
    expect(
      evaluateFilter(Filter.cmp(["message"], "contains", Filter.stringValue("success")), base),
    ).toBe(false);
  });

  it("matchesRegex evaluates a user-supplied pattern", () => {
    const ok = Filter.cmp(["message"], "matchesRegex", Filter.stringValue("timed\\s+out"));
    expect(evaluateFilter(ok, base)).toBe(true);

    const nope = Filter.cmp(["message"], "matchesRegex", Filter.stringValue("^nope"));
    expect(evaluateFilter(nope, base)).toBe(false);
  });

  it("matchesRegex never throws on a malformed pattern", () => {
    const ast = Filter.cmp(["message"], "matchesRegex", Filter.stringValue("([unclosed"));
    // Even with an invalid pattern, evaluation is required to return false —
    // a bad user regex must not crash the live stream.
    expect(() => evaluateFilter(ast, base)).not.toThrow();
    expect(evaluateFilter(ast, base)).toBe(false);
  });
});

describe("evaluateFilter - membership operators", () => {
  const base = entry({ level: "error" });

  it("in / notIn against a list", () => {
    const inAst = Filter.cmp(["level"], "in", Filter.listValue(["error", "fatal"]));
    expect(evaluateFilter(inAst, base)).toBe(true);
    expect(evaluateFilter(inAst, entry({ level: "info" }))).toBe(false);

    const notInAst = Filter.cmp(["level"], "notIn", Filter.listValue(["error", "fatal"]));
    expect(evaluateFilter(notInAst, base)).toBe(false);
    expect(evaluateFilter(notInAst, entry({ level: "info" }))).toBe(true);
  });
});

describe("evaluateFilter - exists / notExists", () => {
  it("detects present, null, and absent fields", () => {
    const existsTrace = Filter.cmp(["traceId"], "exists");
    expect(evaluateFilter(existsTrace, entry({ traceId: "t" }))).toBe(true);
    expect(evaluateFilter(existsTrace, entry({ traceId: null }))).toBe(false);

    const notExistsTrace = Filter.cmp(["traceId"], "notExists");
    expect(evaluateFilter(notExistsTrace, entry({ traceId: null }))).toBe(true);
    expect(evaluateFilter(notExistsTrace, entry({ traceId: "t" }))).toBe(false);
  });

  it("treats a missing attribute path as not existing", () => {
    const ast = Filter.cmp(["attributes", "http", "status_code"], "exists");
    expect(evaluateFilter(ast, entry({ attributes: {} }))).toBe(false);
    expect(evaluateFilter(ast, entry({ attributes: { http: { status_code: 500 } } }))).toBe(true);
  });

  it("returns false for cmp on an absent path with a non-existence op", () => {
    const ast = Filter.cmp(
      ["attributes", "missing", "deeply"],
      "eq",
      Filter.stringValue("anything"),
    );
    expect(evaluateFilter(ast, entry({ attributes: {} }))).toBe(false);
  });
});

describe("evaluateFilter - attribute path traversal", () => {
  const nested = entry({
    attributes: {
      http: {
        method: "POST",
        status_code: 503,
        headers: { "x-request-id": "abc" },
      },
      tags: ["urgent", "cart"],
    },
  });

  it("walks nested object paths", () => {
    const ast = Filter.cmp(["attributes", "http", "method"], "eq", Filter.stringValue("POST"));
    expect(evaluateFilter(ast, nested)).toBe(true);
  });

  it("walks deeper paths", () => {
    const ast = Filter.cmp(
      ["attributes", "http", "headers", "x-request-id"],
      "eq",
      Filter.stringValue("abc"),
    );
    expect(evaluateFilter(ast, nested)).toBe(true);
  });

  it("returns undefined (and thus false) when a segment misses", () => {
    const ast = Filter.cmp(["attributes", "http", "body", "size"], "gt", Filter.numberValue(0));
    expect(evaluateFilter(ast, nested)).toBe(false);
  });
});

describe("evaluateFilter - text node", () => {
  const withBody = entry({
    message: "database connection refused",
    attributes: { region: "eu-west-1", retries: 3 },
  });

  it("substring search is case-insensitive and scans message + attributes", () => {
    expect(evaluateFilter(Filter.text("REFUSED"), withBody)).toBe(true);
    expect(evaluateFilter(Filter.text("eu-west"), withBody)).toBe(true);
    expect(evaluateFilter(Filter.text("missing"), withBody)).toBe(false);
  });

  it("empty query matches everything", () => {
    expect(evaluateFilter(Filter.text("   "), withBody)).toBe(true);
  });

  it("regex mode against a bad pattern yields false rather than throwing", () => {
    const ast = Filter.text("([bad", "regex");
    expect(() => evaluateFilter(ast, withBody)).not.toThrow();
    expect(evaluateFilter(ast, withBody)).toBe(false);
  });

  it("regex mode matches against message and severity", () => {
    const ast = Filter.text("conn\\w+", "regex");
    expect(evaluateFilter(ast, withBody)).toBe(true);
  });
});

describe("evaluateFilter - boolean composition", () => {
  const base = entry({ level: "error", attributes: { "http.status_code": 503 } });

  it("and short-circuits on first false child", () => {
    const ast = Filter.and([
      Filter.cmp(["level"], "eq", Filter.stringValue("info")),
      Filter.cmp(["message"], "contains", Filter.stringValue("anything")),
    ]);
    expect(evaluateFilter(ast, base)).toBe(false);
  });

  it("and with no children is true (vacuous)", () => {
    expect(evaluateFilter(Filter.and([]), base)).toBe(true);
  });

  it("or with no children is false", () => {
    expect(evaluateFilter(Filter.or([]), base)).toBe(false);
  });

  it("or returns true on first matching child", () => {
    const ast = Filter.or([
      Filter.cmp(["level"], "eq", Filter.stringValue("info")),
      Filter.cmp(["level"], "eq", Filter.stringValue("error")),
    ]);
    expect(evaluateFilter(ast, base)).toBe(true);
  });

  it("not inverts its child", () => {
    const ast = Filter.not(Filter.cmp(["level"], "eq", Filter.stringValue("info")));
    expect(evaluateFilter(ast, base)).toBe(true);
  });

  it("composes deeply nested trees", () => {
    const ast = Filter.and([
      Filter.text("http"),
      Filter.or([
        Filter.cmp(["level"], "in", Filter.listValue(["error", "fatal"])),
        Filter.cmp(["attributes", "http.status_code"], "gte", Filter.numberValue(500)),
      ]),
      Filter.not(Filter.cmp(["traceId"], "notExists")),
    ]);
    expect(
      evaluateFilter(
        ast,
        entry({
          level: "error",
          message: "http 503 returned",
          traceId: "trace-1",
          attributes: { "http.status_code": 503 },
        }),
      ),
    ).toBe(true);

    expect(
      evaluateFilter(
        ast,
        entry({
          level: "info",
          message: "http 200 ok",
          traceId: null,
          attributes: { "http.status_code": 200 },
        }),
      ),
    ).toBe(false);
  });
});

describe("attribute segment safety", () => {
  it("allows typical OTel-style segments", () => {
    expect(isValidAttributeSegment("http")).toBe(true);
    expect(isValidAttributeSegment("http.status_code")).toBe(true);
    expect(isValidAttributeSegment("x-request-id")).toBe(true);
    expect(isValidAttributeSegment("_legacy")).toBe(true);
  });

  it("rejects segments that would break a DuckDB JSON path literal", () => {
    expect(isValidAttributeSegment("")).toBe(false);
    expect(isValidAttributeSegment("$dangerous")).toBe(false);
    expect(isValidAttributeSegment("with space")).toBe(false);
    expect(isValidAttributeSegment("with'quote")).toBe(false);
    expect(isValidAttributeSegment("with;semi")).toBe(false);
    expect(isValidAttributeSegment("1leadingDigit")).toBe(false);
  });

  it("exposes the regex for re-use", () => {
    expect(ATTRIBUTE_SEGMENT_PATTERN.test("ok_name")).toBe(true);
    expect(ATTRIBUTE_SEGMENT_PATTERN.test("bad name")).toBe(false);
  });
});
