import type { TelemetryLogField } from "~/data/logApi";

export const ATTRIBUTE_FIELD_SUGGESTION_LIMIT = 100;

export function limitAttributeFieldSuggestions(
  fields: ReadonlyArray<TelemetryLogField>,
): ReadonlyArray<TelemetryLogField> {
  let attributeCount = 0;

  return fields.filter((field) => {
    if (field.path[0] !== "attributes") return true;
    if (attributeCount >= ATTRIBUTE_FIELD_SUGGESTION_LIMIT) return false;

    attributeCount += 1;
    return true;
  });
}
