import { describe, expect, it } from "vitest";

import {
  LIVE_DATASET_TAB,
  LIVE_DATASET_TAB_ID,
  closeDatasetTab,
  getDatasetTabState,
  openTraceTab,
  setActiveDatasetTab,
  type DatasetTabsByDataset,
} from "./datasetTabs";

describe("dataset tabs", () => {
  it("creates an unclosable Live tab by default", () => {
    const state = getDatasetTabState({}, "dataset-a");

    expect(state.activeTabId).toBe(LIVE_DATASET_TAB_ID);
    expect(state.tabs).toEqual([LIVE_DATASET_TAB]);
    expect(state.tabs[0]?.closable).toBe(false);
  });

  it("keeps active tabs scoped to their dataset", () => {
    const tabsByDataset: DatasetTabsByDataset = {
      "dataset-a": {
        activeTabId: "trace:abc",
        tabs: [
          LIVE_DATASET_TAB,
          {
            id: "trace:abc",
            kind: "trace",
            icon: "trace",
            title: "abc",
            closable: true,
            traceId: "abc",
          },
        ],
      },
      "dataset-b": {
        activeTabId: LIVE_DATASET_TAB_ID,
        tabs: [LIVE_DATASET_TAB],
      },
    };

    const next = setActiveDatasetTab(tabsByDataset, "dataset-b", "trace:abc");

    expect(getDatasetTabState(next, "dataset-a").activeTabId).toBe("trace:abc");
    expect(getDatasetTabState(next, "dataset-b").activeTabId).toBe(LIVE_DATASET_TAB_ID);
  });

  it("does not close the Live tab", () => {
    const tabsByDataset: DatasetTabsByDataset = {
      "dataset-a": {
        activeTabId: LIVE_DATASET_TAB_ID,
        tabs: [LIVE_DATASET_TAB],
      },
    };

    expect(closeDatasetTab(tabsByDataset, "dataset-a", LIVE_DATASET_TAB_ID)).toBe(tabsByDataset);
  });

  it("opens a trace tab and activates it", () => {
    const next = openTraceTab({}, "dataset-a", {
      traceId: "abc123",
      title: "analytics-janitor.select-backlog",
      initialSpanId: "span-1",
    });

    const state = getDatasetTabState(next, "dataset-a");
    expect(state.activeTabId).toBe("trace:abc123");
    expect(state.tabs).toHaveLength(2);
    const traceTab = state.tabs.find((tab) => tab.id === "trace:abc123");
    expect(traceTab).toMatchObject({
      kind: "trace",
      closable: true,
      traceId: "abc123",
      title: "analytics-janitor.select-backlog",
      initialSpanId: "span-1",
    });
  });

  it("reactivates an existing trace tab instead of duplicating it", () => {
    const first = openTraceTab({}, "dataset-a", {
      traceId: "abc123",
      title: "root",
    });
    const switched = setActiveDatasetTab(first, "dataset-a", LIVE_DATASET_TAB_ID);
    expect(getDatasetTabState(switched, "dataset-a").activeTabId).toBe(LIVE_DATASET_TAB_ID);

    const second = openTraceTab(switched, "dataset-a", {
      traceId: "abc123",
      title: "ignored title on reopen",
    });
    const state = getDatasetTabState(second, "dataset-a");

    // Reactivated, not duplicated.
    expect(state.activeTabId).toBe("trace:abc123");
    expect(state.tabs).toHaveLength(2);
    // Title stays as it was first registered — late re-opens don't overwrite.
    const traceTab = state.tabs.find((tab) => tab.id === "trace:abc123");
    expect(traceTab?.title).toBe("root");
  });

  it("updates the initial span when reopening an existing trace tab", () => {
    const first = openTraceTab({}, "dataset-a", {
      traceId: "abc123",
      title: "root",
      initialSpanId: "span-1",
    });
    const switched = setActiveDatasetTab(first, "dataset-a", LIVE_DATASET_TAB_ID);

    const second = openTraceTab(switched, "dataset-a", {
      traceId: "abc123",
      title: "ignored",
      initialSpanId: "span-2",
    });

    const traceTab = getDatasetTabState(second, "dataset-a").tabs.find(
      (tab) => tab.id === "trace:abc123",
    );
    expect(traceTab).toMatchObject({
      id: "trace:abc123",
      initialSpanId: "span-2",
      title: "root",
    });
  });

  it("returns the same reference when opening an already-active trace tab", () => {
    const withTab = openTraceTab({}, "dataset-a", {
      traceId: "abc123",
      title: "root",
    });

    const next = openTraceTab(withTab, "dataset-a", {
      traceId: "abc123",
      title: "root",
    });

    expect(next).toBe(withTab);
  });
});
