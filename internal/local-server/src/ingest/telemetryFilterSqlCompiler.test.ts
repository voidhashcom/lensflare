import { describe, expect, it } from "@effect/vitest";
import { Filter } from "@lensflare/contracts";
import { compileTelemetryFilterToSql } from "./telemetryFilterSqlCompiler.ts";

describe("compileTelemetryFilterToSql", () => {
  it("filters by telemetry kind", () => {
    const result = compileTelemetryFilterToSql(
      Filter.cmp(["kind"], "eq", Filter.stringValue("span")),
    );

    expect(result.whereClause).toBe("(telemetry.kind = $flt_0)");
    expect(result.params).toStrictEqual({ flt_0: "span" });
  });

  it("filters errored spans by status", () => {
    const result = compileTelemetryFilterToSql(
      Filter.and([
        Filter.cmp(["kind"], "eq", Filter.stringValue("span")),
        Filter.cmp(["status"], "eq", Filter.stringValue("error")),
      ]),
    );

    expect(result.whereClause).toContain("telemetry.kind = $flt_0");
    expect(result.whereClause).toContain("telemetry.status = $flt_1");
  });

  it("filters attributes from the unified row projection", () => {
    const result = compileTelemetryFilterToSql(
      Filter.cmp(["attributes", "http", "method"], "eq", Filter.stringValue("POST")),
    );

    expect(result.whereClause).toBe(
      "(COALESCE(telemetry.attributes_json['http.method'], telemetry.attributes_json['method']) = $flt_0)",
    );
  });

  it("filters spans by related span event attributes", () => {
    const result = compileTelemetryFilterToSql(
      Filter.cmp(
        ["relatedEvents", "attributes", "exception.type"],
        "contains",
        Filter.stringValue("TimeoutError"),
      ),
    );

    expect(result.whereClause).toContain("telemetry.kind = 'span'");
    expect(result.whereClause).toContain("EXISTS");
    expect(result.whereClause).toContain('related."Events.Attributes"[event_index.i]');
    expect(result.whereClause).toContain("['exception.type']");
    expect(result.params).toStrictEqual({ flt_0: "%timeouterror%" });
  });
});
