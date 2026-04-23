import { describe, expect, it } from "vite-plus/test";

import type { TelemetryLogField } from "~/data/logApi";

import {
  ATTRIBUTE_FIELD_SUGGESTION_LIMIT,
  limitAttributeFieldSuggestions,
} from "./fieldSuggestionLimits";

const staticField: TelemetryLogField = {
  path: ["message"],
  label: "Message",
  kind: "string",
};

function attributeField(index: number): TelemetryLogField {
  return {
    path: ["attributes", `attr_${index}`],
    label: `attributes.attr_${index}`,
    kind: "string",
  };
}

describe("limitAttributeFieldSuggestions", () => {
  it("keeps static fields while capping attribute suggestions", () => {
    const fields = [
      staticField,
      ...Array.from({ length: ATTRIBUTE_FIELD_SUGGESTION_LIMIT + 20 }, (_, index) =>
        attributeField(index),
      ),
    ];

    const limited = limitAttributeFieldSuggestions(fields);

    expect(limited).toHaveLength(ATTRIBUTE_FIELD_SUGGESTION_LIMIT + 1);
    expect(limited[0]).toBe(staticField);
    expect(limited.filter((field) => field.path[0] === "attributes")).toHaveLength(
      ATTRIBUTE_FIELD_SUGGESTION_LIMIT,
    );
  });
});
