import { describe, expect, it } from "@effect/vitest";
import { Filter, InvalidFilterError, type FilterNode } from "@lensflare/contracts";

import { compileFilterToSql } from "./filterSqlCompiler.ts";

describe("compileFilterToSql", () => {
  describe("cmp comparison ops", () => {
    it("emits a parameterised equality for a top-level field", () => {
      const ast = Filter.cmp(["level"], "eq", Filter.stringValue("error"));
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toContain("SeverityText");
      expect(result.whereClause).toContain("= $flt_0");
      expect(result.params).toStrictEqual({ flt_0: "error" });
      expect(result.nextIndex).toBe(1);
    });

    it("emits IS NULL for eq against null rather than `= $x`", () => {
      const ast = Filter.cmp(["traceId"], "eq", Filter.nullValue());
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toBe("(NULLIF(TraceId, '') IS NULL)");
      expect(result.params).toStrictEqual({});
    });

    it("emits IS NOT NULL for exists", () => {
      const ast = Filter.cmp(["serviceName"], "exists");
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toBe("(NULLIF(ServiceName, '') IS NOT NULL)");
      expect(result.params).toStrictEqual({});
    });

    it("emits IS NULL for notExists", () => {
      const ast = Filter.cmp(["traceId"], "notExists");
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toBe("(NULLIF(TraceId, '') IS NULL)");
    });

    it("routes numeric comparisons through the numeric column expression", () => {
      const ast = Filter.cmp(["severityNumber"], "gte", Filter.numberValue(17));
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toBe("(SeverityNumber >= $flt_0)");
      expect(result.params).toStrictEqual({ flt_0: 17 });
    });

    it("maps contains to a case-insensitive LIKE with escape", () => {
      const ast = Filter.cmp(["message"], "contains", Filter.stringValue("Timed Out"));
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toContain("LIKE $flt_0 ESCAPE '\\'");
      expect(result.whereClause).toContain("LOWER(Body)");
      expect(result.params).toStrictEqual({ flt_0: "%timed out%" });
    });

    it("escapes LIKE metacharacters in user input", () => {
      const ast = Filter.cmp(["message"], "startsWith", Filter.stringValue("100% sure_"));
      const result = compileFilterToSql(ast);

      expect(result.params).toStrictEqual({ flt_0: "100\\% sure\\_%" });
    });

    it("emits regexp_matches for matchesRegex", () => {
      const ast = Filter.cmp(
        ["message"],
        "matchesRegex",
        Filter.stringValue("^\\[fatal\\]"),
      );
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toContain("regexp_matches");
      expect(result.params).toStrictEqual({ flt_0: "^\\[fatal\\]" });
    });

    it("flattens list values into IN(...) placeholders", () => {
      const ast = Filter.cmp(["level"], "in", Filter.listValue(["error", "fatal"]));
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toContain("SeverityText");
      expect(result.whereClause).toContain("IN ($flt_0, $flt_1)");
      expect(result.params).toStrictEqual({ flt_0: "error", flt_1: "fatal" });
    });

    it("routes IN with numeric values through the numeric column", () => {
      const ast = Filter.cmp(["severityNumber"], "in", Filter.listValue([17, 21]));
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toBe("(SeverityNumber IN ($flt_0, $flt_1))");
    });

    it("emits FALSE for an empty IN list and TRUE for empty notIn", () => {
      const emptyIn = compileFilterToSql(Filter.cmp(["level"], "in", Filter.listValue([])));
      expect(emptyIn.whereClause).toBe("(FALSE)");

      const emptyNotIn = compileFilterToSql(
        Filter.cmp(["level"], "notIn", Filter.listValue([])),
      );
      expect(emptyNotIn.whereClause).toBe("(TRUE)");
    });
  });

  describe("boolean composition", () => {
    it("joins AND children with AND", () => {
      const ast = Filter.and([
        Filter.cmp(["level"], "eq", Filter.stringValue("error")),
        Filter.cmp(["serviceName"], "eq", Filter.stringValue("api")),
      ]);
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toContain("SeverityText");
      expect(result.whereClause).toContain("NULLIF(ServiceName, '') = $flt_1");
      expect(result.nextIndex).toBe(2);
    });

    it("empty AND is TRUE and empty OR is FALSE", () => {
      expect(compileFilterToSql(Filter.and([])).whereClause).toBe("(TRUE)");
      expect(compileFilterToSql(Filter.or([])).whereClause).toBe("(FALSE)");
    });

    it("NOT wraps its child", () => {
      const ast = Filter.not(Filter.cmp(["level"], "eq", Filter.stringValue("info")));
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toContain("NOT");
      expect(result.whereClause).toContain("SeverityText");
    });

    it("nests AND/OR/NOT with fresh placeholder indices", () => {
      const ast = Filter.and([
        Filter.or([
          Filter.cmp(["level"], "eq", Filter.stringValue("error")),
          Filter.cmp(["level"], "eq", Filter.stringValue("fatal")),
        ]),
        Filter.not(
          Filter.cmp(["serviceName"], "eq", Filter.stringValue("debug-client")),
        ),
      ]);
      const result = compileFilterToSql(ast);

      expect(result.nextIndex).toBe(3);
      expect(Object.keys(result.params)).toStrictEqual(["flt_0", "flt_1", "flt_2"]);
    });
  });

  describe("attribute paths", () => {
    it("extracts from the OTEL log attribute map", () => {
      const ast = Filter.cmp(
        ["attributes", "http", "method"],
        "eq",
        Filter.stringValue("POST"),
      );
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toBe(
        "(COALESCE(LogAttributes['http.method'], LogAttributes['method']) = $flt_0)",
      );
      expect(result.params).toStrictEqual({ flt_0: "POST" });
    });

    it("wraps numeric comparisons on attributes with TRY_CAST", () => {
      const ast = Filter.cmp(
        ["attributes", "http", "status_code"],
        "gte",
        Filter.numberValue(500),
      );
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toBe(
        "(TRY_CAST(COALESCE(LogAttributes['http.status_code'], LogAttributes['status_code']) AS DOUBLE) >= $flt_0)",
      );
    });

    it("rejects unsafe path segments", () => {
      expect(() =>
        compileFilterToSql(
          Filter.cmp(
            ["attributes", "bad; DROP TABLE otel_logs;--"],
            "eq",
            Filter.stringValue("x"),
          ),
        ),
      ).toThrow(InvalidFilterError);
    });

    it("rejects empty attribute paths", () => {
      expect(() =>
        compileFilterToSql(Filter.cmp(["attributes"], "exists")),
      ).toThrow(InvalidFilterError);
    });

    it("rejects path segments starting with a digit", () => {
      expect(() =>
        compileFilterToSql(
          Filter.cmp(["attributes", "1stNotAllowed"], "exists"),
        ),
      ).toThrow(InvalidFilterError);
    });

    it("rejects paths with quotes", () => {
      expect(() =>
        compileFilterToSql(
          Filter.cmp(["attributes", "quote'inside"], "exists"),
        ),
      ).toThrow(InvalidFilterError);
    });
  });

  describe("text node", () => {
    it("substring mode compiles to LOWER(...) LIKE across haystacks", () => {
      const ast = Filter.text("timeout");
      const result = compileFilterToSql(ast);

      expect(result.params).toStrictEqual({ flt_0: "%timeout%" });
      expect(result.whereClause).toContain("LIKE $flt_0 ESCAPE '\\'");
      expect(result.whereClause).toContain("LogAttributes");
      expect(result.whereClause).toContain("Body");
    });

    it("empty text becomes a tautology and binds nothing", () => {
      const result = compileFilterToSql(Filter.text("   "));

      expect(result.whereClause).toBe("(TRUE)");
      expect(result.params).toStrictEqual({});
    });

    it("regex mode compiles to regexp_matches over haystacks", () => {
      const ast = Filter.text("oops\\d+", "regex");
      const result = compileFilterToSql(ast);

      expect(result.whereClause).toContain("regexp_matches");
      expect(result.params).toStrictEqual({ flt_0: "oops\\d+" });
    });
  });

  describe("startIndex option", () => {
    it("resumes placeholder numbering from the caller-supplied index", () => {
      const ast = Filter.and([
        Filter.cmp(["level"], "eq", Filter.stringValue("error")),
        Filter.cmp(["serviceName"], "eq", Filter.stringValue("api")),
      ]);
      const result = compileFilterToSql(ast, { startIndex: 10 });

      expect(result.whereClause).toContain("SeverityText");
      expect(result.whereClause).toContain("NULLIF(ServiceName, '') = $flt_11");
      expect(result.params).toStrictEqual({ flt_10: "error", flt_11: "api" });
      expect(result.nextIndex).toBe(12);
    });
  });

  describe("full example", () => {
    it("compiles a representative mixed AST", () => {
      const ast: FilterNode = {
        _tag: "and",
        children: [
          { _tag: "text", query: "http", mode: "substring" },
          {
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
                field: { path: ["attributes", "http", "status_code"] },
                op: "gte",
                value: { _tag: "number", value: 500 },
              },
            ],
          },
        ],
      };

      const result = compileFilterToSql(ast);

      expect(Object.keys(result.params).sort()).toStrictEqual([
        "flt_0",
        "flt_1",
        "flt_2",
        "flt_3",
      ]);
      expect(result.params.flt_0).toBe("%http%");
      expect(result.params.flt_1).toBe("error");
      expect(result.params.flt_2).toBe("fatal");
      expect(result.params.flt_3).toBe(500);
    });
  });
});
