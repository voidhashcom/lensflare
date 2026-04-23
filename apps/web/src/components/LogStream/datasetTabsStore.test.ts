import { afterEach, describe, expect, it, vi } from "vitest";

import { LIVE_DATASET_TAB_ID, getDatasetTabState } from "./datasetTabs";
import {
  closeDatasetTab,
  getDatasetTabsSnapshot,
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

  it("notifies subscribers when opening a trace tab", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDatasetTabsStore(listener);

    openTraceTab("dataset-a", { traceId: "abc", title: "root" });

    expect(listener).toHaveBeenCalledTimes(1);
    const state = getDatasetTabState(getDatasetTabsSnapshot(), "dataset-a");
    expect(state.activeTabId).toBe("trace:abc");
    unsubscribe();
  });

  it("does not notify when the mutation is a no-op", () => {
    openTraceTab("dataset-a", { traceId: "abc", title: "root" });
    const listener = vi.fn();
    const unsubscribe = subscribeDatasetTabsStore(listener);

    // Reactivating the already-active tab should be a no-op and not emit.
    openTraceTab("dataset-a", { traceId: "abc", title: "root" });

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("closes a trace tab and falls back to the Live tab", () => {
    openTraceTab("dataset-a", { traceId: "abc", title: "root" });
    expect(getDatasetTabState(getDatasetTabsSnapshot(), "dataset-a").activeTabId).toBe(
      "trace:abc",
    );

    closeDatasetTab("dataset-a", "trace:abc");

    const state = getDatasetTabState(getDatasetTabsSnapshot(), "dataset-a");
    expect(state.activeTabId).toBe(LIVE_DATASET_TAB_ID);
    expect(state.tabs.find((tab) => tab.id === "trace:abc")).toBeUndefined();
  });

  it("selects an existing tab by id", () => {
    openTraceTab("dataset-a", { traceId: "abc", title: "root" });

    setActiveDatasetTab("dataset-a", LIVE_DATASET_TAB_ID);

    expect(getDatasetTabState(getDatasetTabsSnapshot(), "dataset-a").activeTabId).toBe(
      LIVE_DATASET_TAB_ID,
    );
  });
});
