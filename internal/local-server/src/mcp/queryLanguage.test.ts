import { describe, expect, it } from "@effect/vitest";
import type { TelemetryFilterCatalogEntry } from "@lensflare/contracts";
import { parseTelemetryQuery, QueryLanguageError } from "./queryLanguage.ts";

const fields: ReadonlyArray<TelemetryFilterCatalogEntry> = [
  {
    id: "level",
    projectId: "project",
    datasetId: "dataset",
    path: ["level"],
    label: "level",
    kind: "enum",
    values: ["info", "warn", "error", "fatal"],
    frequency: 1,
    highCardinality: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "durationUs",
    projectId: "project",
    datasetId: "dataset",
    path: ["durationUs"],
    label: "durationUs",
    kind: "number",
    values: [],
    frequency: 1,
    highCardinality: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "http.status_code",
    projectId: "project",
    datasetId: "dataset",
    path: ["attributes", "http.status_code"],
    label: "http.status_code",
    kind: "number",
    values: [],
    frequency: 1,
    highCardinality: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("parseTelemetryQuery", () => {
  it("parses the error query that replaces findErrors", () => {
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

  it("supports free text, attributes, numbers, and implicit and", () => {
    expect(
      parseTelemetryQuery("timeout attr.http.status_code >= 500 durationUs > 1000", fields),
    ).toEqual({
      _tag: "and",
      children: [
        { _tag: "text", query: "timeout", mode: "substring" },
        {
          _tag: "cmp",
          field: { path: ["attributes", "http.status_code"] },
          op: "gte",
          value: { _tag: "number", value: 500 },
        },
        {
          _tag: "cmp",
          field: { path: ["durationUs"] },
          op: "gt",
          value: { _tag: "number", value: 1000 },
        },
      ],
    });
  });

  it("reports malformed quoted strings", () => {
    expect(() => parseTelemetryQuery('message = "open', fields)).toThrow(QueryLanguageError);
  });
});
