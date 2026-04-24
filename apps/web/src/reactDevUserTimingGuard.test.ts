import { afterEach, describe, expect, it, vi } from "vitest";

import { installReactDevUserTimingGuard } from "./reactDevUserTimingGuard";

function createPerformanceStub(measure: Performance["measure"]): Performance {
  return {
    measure,
  } as Performance;
}

describe("installReactDevUserTimingGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("swallows React DevTools structured-clone failures", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new DOMException("Data cannot be cloned, out of memory.", "DataCloneError");
    const performanceStub = createPerformanceStub(
      vi.fn(() => {
        throw error;
      }) as Performance["measure"],
    );

    installReactDevUserTimingGuard(performanceStub);

    expect(() =>
      performanceStub.measure("\u200bLogTable", {
        start: 1,
        end: 2,
        detail: { devtools: { properties: [] } },
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-React structured-clone failures", () => {
    const error = new DOMException("Data cannot be cloned, out of memory.", "DataCloneError");
    const performanceStub = createPerformanceStub(
      vi.fn(() => {
        throw error;
      }) as Performance["measure"],
    );

    installReactDevUserTimingGuard(performanceStub);

    expect(() => performanceStub.measure("app-measure", { start: 1, end: 2 })).toThrow(error);
  });

  it("keeps normal performance measures delegated to the native API", () => {
    const measure = vi.fn(() => ({ name: "app-measure" }) as PerformanceMeasure);
    const performanceStub = createPerformanceStub(measure as Performance["measure"]);

    installReactDevUserTimingGuard(performanceStub);

    expect(performanceStub.measure("app-measure", { start: 1, end: 2 })).toEqual({
      name: "app-measure",
    });
    expect(measure).toHaveBeenCalledWith("app-measure", { start: 1, end: 2 }, undefined);
  });
});
