import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TELEMETRY_DATASET_TAB_ID, getDatasetTabState } from "./datasetTabs";
import {
  closeDatasetTab,
  getDatasetTabsSnapshot,
  openTelemetryTab,
  openTraceTab,
  resetDatasetTabsStoreForTests,
  setActiveDatasetTab,
  subscribeDatasetTabsStore,
} from "./datasetTabsStore";

afterEach(() => {
  resetDatasetTabsStoreForTests();
});

describe("datasetTabsStore", () => {
  it("starts with an empty snapshot", () => {
    expect(getDatasetTabsSnapshot()).toEqual({});
  });

  it("notifies subscribers when opening a telemetry tab", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDatasetTabsStore(listener);

    openTelemetryTab("dataset-a");

    expect(listener).toHaveBeenCalledTimes(1);
    const state = getDatasetTabState(getDatasetTabsSnapshot(), "dataset-a");
    expect(state.activeTabId).toBe("telemetry:2");
    expect(state.tabs.map((tab) => tab.id)).toEqual(["telemetry:1", "telemetry:2"]);
    unsubscribe();
  });

  it("does not notify when the mutation is a no-op", () => {
    openTraceTab("dataset-a", { traceId: "abc", title: "root" });
    const listener = vi.fn();
    const unsubscribe = subscribeDatasetTabsStore(listener);

    openTraceTab("dataset-a", { traceId: "abc", title: "root" });

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("closes a trace tab and falls back to the previous tab", () => {
    openTraceTab("dataset-a", { traceId: "abc", title: "root" });
    expect(getDatasetTabState(getDatasetTabsSnapshot(), "dataset-a").activeTabId).toBe("trace:abc");

    const result = closeDatasetTab("dataset-a", "trace:abc");

    const state = getDatasetTabState(getDatasetTabsSnapshot(), "dataset-a");
    expect(result).toEqual({ closedLast: false });
    expect(state.activeTabId).toBe(DEFAULT_TELEMETRY_DATASET_TAB_ID);
    expect(state.tabs.find((tab) => tab.id === "trace:abc")).toBeUndefined();
  });

  it("returns closedLast when closing the final tab", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDatasetTabsStore(listener);

    const result = closeDatasetTab("dataset-a", DEFAULT_TELEMETRY_DATASET_TAB_ID);

    expect(result).toEqual({ closedLast: true });
    expect(listener).not.toHaveBeenCalled();
    expect(getDatasetTabsSnapshot()).toEqual({});
    unsubscribe();
  });

  it("returns closedLast false and does not emit for an unknown tab", () => {
    openTelemetryTab("dataset-a");
    const listener = vi.fn();
    const unsubscribe = subscribeDatasetTabsStore(listener);

    const result = closeDatasetTab("dataset-a", "trace:missing");

    expect(result).toEqual({ closedLast: false });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("selects an existing tab by id", () => {
    openTraceTab("dataset-a", { traceId: "abc", title: "root" });

    setActiveDatasetTab("dataset-a", DEFAULT_TELEMETRY_DATASET_TAB_ID);

    expect(getDatasetTabState(getDatasetTabsSnapshot(), "dataset-a").activeTabId).toBe(
      DEFAULT_TELEMETRY_DATASET_TAB_ID,
    );
  });
});
