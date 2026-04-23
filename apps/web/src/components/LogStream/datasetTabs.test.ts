import { describe, expect, it } from "vitest";

import {
  LIVE_DATASET_TAB,
  LIVE_DATASET_TAB_ID,
  closeDatasetTab,
  getDatasetTabState,
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
});
