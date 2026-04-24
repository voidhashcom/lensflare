import { describe, expect, it } from "vite-plus/test";

import type { TelemetryLogField } from "~/data/logApi";

import {
  buildFilterValue,
  describeRow,
  draftToFilter,
  draftToFilterNode,
  LIST_OPERATORS,
  operatorsForField,
  OPERATOR_LABELS,
  parseListLiteral,
  serialiseListLiteral,
  UNARY_OPERATORS,
} from "./filterTypes";

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

const statusField: TelemetryLogField = {
  path: ["attributes", "http", "status_code"],
  label: "http.status_code",
  kind: "number",
};

describe("operatorsForField", () => {
  it("offers regex + contains ops on string fields", () => {
    const ops = operatorsForField("string");
    expect(ops).toContain("matchesRegex");
    expect(ops).toContain("contains");
    expect(ops).not.toContain("gt");
  });

  it("offers ordering ops on numeric fields", () => {
    const ops = operatorsForField("number");
    expect(ops).toContain("gt");
    expect(ops).toContain("lte");
    expect(ops).not.toContain("matchesRegex");
  });

  it("trims enum fields down to equality + membership", () => {
    const ops = operatorsForField("enum");
    expect(ops).toEqual(["eq", "ne", "in", "notIn", "exists", "notExists"]);
  });
});

describe("buildFilterValue", () => {
  it("returns undefined for unary operators", () => {
    for (const op of UNARY_OPERATORS) {
      expect(buildFilterValue(messageField, op, "ignored")).toBeUndefined();
    }
  });

  it("returns undefined when the raw value is blank", () => {
    expect(buildFilterValue(messageField, "eq", "   ")).toBeUndefined();
  });

  it("produces a string value for plain equality on string fields", () => {
    expect(buildFilterValue(messageField, "eq", "  hello  ")).toEqual({
      _tag: "string",
      value: "hello",
    });
  });

  it("produces a numeric value for numeric fields, rejecting NaN", () => {
    expect(buildFilterValue(statusField, "gte", "500")).toEqual({
      _tag: "number",
      value: 500,
    });
    expect(buildFilterValue(statusField, "gte", "not-a-number")).toBeUndefined();
  });

  it("splits list ops on commas, trimming blanks", () => {
    expect(buildFilterValue(levelField, "in", "error , fatal ,, warn ")).toEqual({
      _tag: "list",
      values: ["error", "fatal", "warn"],
    });
  });

  it("supports quoted list segments including explicit empty strings", () => {
    expect(buildFilterValue(levelField, "in", '"", "warn", "needs space"')).toEqual({
      _tag: "list",
      values: ["", "warn", "needs space"],
    });
  });

  it("returns undefined when a list operator ends up empty after trimming", () => {
    expect(buildFilterValue(levelField, "in", " , , ")).toBeUndefined();
  });

  it("filters non-finite numerics out of list values on numeric fields", () => {
    expect(buildFilterValue(statusField, "in", "200, banana, 500")).toEqual({
      _tag: "list",
      values: [200, 500],
    });
  });
});

describe("list literal helpers", () => {
  it("parses quoted values for picker display", () => {
    expect(parseListLiteral('"error","ok","needs space",""')).toEqual([
      "error",
      "ok",
      "needs space",
      "",
    ]);
  });

  it("serialises only values that need quotes", () => {
    expect(serialiseListLiteral(["error", "ok", "needs space", "", 'has"quote'])).toBe(
      'error,ok,"needs space","","has\\"quote"',
    );
  });
});

describe("draftToFilterNode", () => {
  it("returns null when no field is picked", () => {
    expect(
      draftToFilterNode({ id: "r", field: null, operator: "eq", value: "x" }),
    ).toBeNull();
  });

  it("emits a cmp node with value for binary operators", () => {
    const node = draftToFilterNode({
      id: "r",
      field: levelField,
      operator: "eq",
      value: "error",
    });
    expect(node).toEqual({
      _tag: "cmp",
      field: { path: ["level"] },
      op: "eq",
      value: { _tag: "string", value: "error" },
    });
  });

  it("emits a cmp node without value for unary operators", () => {
    const node = draftToFilterNode({
      id: "r",
      field: levelField,
      operator: "exists",
      value: "",
    });
    expect(node).toEqual({
      _tag: "cmp",
      field: { path: ["level"] },
      op: "exists",
    });
  });

  it("returns null when a binary operator has no committable value", () => {
    expect(
      draftToFilterNode({ id: "r", field: messageField, operator: "eq", value: "" }),
    ).toBeNull();
  });
});

describe("draftToFilter", () => {
  it("returns null when there is neither text nor committable rows", () => {
    expect(draftToFilter({ rows: [], text: "" })).toBeNull();
    expect(draftToFilter({ rows: [], text: "   " })).toBeNull();
  });

  it("returns a bare text node when the draft holds only free-text", () => {
    expect(draftToFilter({ rows: [], text: "  boom  " })).toEqual({
      _tag: "text",
      query: "boom",
    });
  });

  it("unwraps a single-row draft to a bare cmp node", () => {
    const filter = draftToFilter({
      rows: [{ id: "r", field: levelField, operator: "eq", value: "error" }],
      text: "",
    });
    expect(filter).toEqual({
      _tag: "cmp",
      field: { path: ["level"] },
      op: "eq",
      value: { _tag: "string", value: "error" },
    });
  });

  it("combines text + rows into a top-level AND", () => {
    const filter = draftToFilter({
      rows: [{ id: "r", field: levelField, operator: "eq", value: "error" }],
      text: "timeout",
    });
    expect(filter).toEqual({
      _tag: "and",
      children: [
        { _tag: "text", query: "timeout" },
        {
          _tag: "cmp",
          field: { path: ["level"] },
          op: "eq",
          value: { _tag: "string", value: "error" },
        },
      ],
    });
  });

  it("skips incomplete rows when serialising", () => {
    const filter = draftToFilter({
      rows: [
        { id: "r1", field: null, operator: "eq", value: "ignored" },
        { id: "r2", field: statusField, operator: "gte", value: "500" },
      ],
      text: "",
    });
    expect(filter).toEqual({
      _tag: "cmp",
      field: { path: ["attributes", "http", "status_code"] },
      op: "gte",
      value: { _tag: "number", value: 500 },
    });
  });
});

describe("describeRow", () => {
  it("returns an empty string when no field is picked", () => {
    expect(describeRow({ id: "r", field: null, operator: "eq", value: "x" })).toBe("");
  });

  it("renders binary rows with the operator label + value", () => {
    expect(
      describeRow({ id: "r", field: levelField, operator: "eq", value: "error" }),
    ).toBe("Level is error");
  });

  it("shows an ellipsis placeholder when the binary value is blank", () => {
    expect(
      describeRow({ id: "r", field: levelField, operator: "eq", value: "" }),
    ).toBe("Level is \u2026");
  });

  it("omits the value segment for unary operators", () => {
    expect(
      describeRow({ id: "r", field: levelField, operator: "exists", value: "" }),
    ).toBe("Level exists");
  });
});

describe("operator label coverage", () => {
  it("has a label for every operator referenced by the editor", () => {
    for (const op of [...UNARY_OPERATORS, ...LIST_OPERATORS]) {
      expect(OPERATOR_LABELS[op]).toBeDefined();
    }
  });
});
