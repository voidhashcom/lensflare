import { describe, expect, it } from "vitest";

import { DEFAULT_LOG_FILTER_PRESETS } from "./logFilterPresets";

describe("DEFAULT_LOG_FILTER_PRESETS", () => {
  it("uses the canonical query language in readonly preset sources", () => {
    expect(DEFAULT_LOG_FILTER_PRESETS.map((preset) => [preset.id, preset.source])).toEqual([
      ["default:logs", 'kind = "log"'],
      ["default:traces", 'kind = "span" parentSpanId missing'],
      ["default:error-spans", 'kind = "span" status = "error"'],
    ]);
  });

  it("does not use removed shorthand operators in readonly preset sources", () => {
    for (const preset of DEFAULT_LOG_FILTER_PRESETS) {
      expect(preset.source).not.toMatch(/(?:^|\s)[A-Za-z][\w.-]*:/);
    }
  });
});
