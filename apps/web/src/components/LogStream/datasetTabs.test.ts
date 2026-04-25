import { describe, expect, it } from "vitest";

import {
  DEFAULT_TELEMETRY_DATASET_TAB,
  DEFAULT_TELEMETRY_DATASET_TAB_ID,
  closeDatasetTab,
  getDatasetTabState,
  openTelemetryTab,
  openTraceTab,
  setActiveDatasetTab,
  type DatasetTabsByDataset,
} from "./datasetTabs";

describe("dataset tabs", () => {
  it("creates a closable Telemetry tab by default", () => {
    const state = getDatasetTabState({}, "dataset-a");

    expect(state.activeTabId).toBe(DEFAULT_TELEMETRY_DATASET_TAB_ID);
    expect(state.tabs).toEqual([DEFAULT_TELEMETRY_DATASET_TAB]);
    expect(state.tabs[0]?.closable).toBe(true);
  });

  it("opens multiple telemetry tabs and activates the newest one", () => {
    const second = openTelemetryTab({}, "dataset-a");
    const third = openTelemetryTab(second, "dataset-a");
    const state = getDatasetTabState(third, "dataset-a");

    expect(state.activeTabId).toBe("telemetry:3");
    expect(state.tabs.map((tab) => [tab.id, tab.title])).toEqual([
      ["telemetry:1", "Telemetry"],
      ["telemetry:2", "Telemetry 2"],
      ["telemetry:3", "Telemetry 3"],
    ]);
  });

  it("keeps telemetry ordinals monotonic while dataset tab state exists", () => {
    const withThreeTabs = openTelemetryTab(openTelemetryTab({}, "dataset-a"), "dataset-a");
    const closedHighest = closeDatasetTab(withThreeTabs, "dataset-a", "telemetry:3").tabsByDataset;
    const reopened = openTelemetryTab(closedHighest, "dataset-a");

    const state = getDatasetTabState(reopened, "dataset-a");
    expect(state.tabs.map((tab) => tab.id)).toEqual(["telemetry:1", "telemetry:2", "telemetry:4"]);
    expect(state.activeTabId).toBe("telemetry:4");
  });

  it("keeps active tabs scoped to their dataset", () => {
    const tabsByDataset: DatasetTabsByDataset = {
      "dataset-a": {
        activeTabId: "trace:abc",
        nextTelemetryOrdinal: 2,
        tabs: [
          DEFAULT_TELEMETRY_DATASET_TAB,
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
        activeTabId: DEFAULT_TELEMETRY_DATASET_TAB_ID,
        nextTelemetryOrdinal: 2,
        tabs: [DEFAULT_TELEMETRY_DATASET_TAB],
      },
    };

    const next = setActiveDatasetTab(tabsByDataset, "dataset-b", "trace:abc");

    expect(getDatasetTabState(next, "dataset-a").activeTabId).toBe("trace:abc");
    expect(getDatasetTabState(next, "dataset-b").activeTabId).toBe(
      DEFAULT_TELEMETRY_DATASET_TAB_ID,
    );
  });

  it("closes an active non-last tab and activates the previous tab", () => {
    const withThreeTabs = openTelemetryTab(openTelemetryTab({}, "dataset-a"), "dataset-a");
    const result = closeDatasetTab(withThreeTabs, "dataset-a", "telemetry:3");

    expect(result.closedLast).toBe(false);
    const state = getDatasetTabState(result.tabsByDataset, "dataset-a");
    expect(state.activeTabId).toBe("telemetry:2");
    expect(state.tabs.map((tab) => tab.id)).toEqual(["telemetry:1", "telemetry:2"]);
  });

  it("closes the last tab and removes the dataset tab state", () => {
    const tabsByDataset: DatasetTabsByDataset = {
      "dataset-a": {
        activeTabId: DEFAULT_TELEMETRY_DATASET_TAB_ID,
        nextTelemetryOrdinal: 2,
        tabs: [DEFAULT_TELEMETRY_DATASET_TAB],
      },
    };

    const result = closeDatasetTab(
      tabsByDataset,
      "dataset-a",
      DEFAULT_TELEMETRY_DATASET_TAB_ID,
    );

    expect(result.closedLast).toBe(true);
    expect(result.tabsByDataset).toEqual({});
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
    const switched = setActiveDatasetTab(first, "dataset-a", DEFAULT_TELEMETRY_DATASET_TAB_ID);
    expect(getDatasetTabState(switched, "dataset-a").activeTabId).toBe(
      DEFAULT_TELEMETRY_DATASET_TAB_ID,
    );

    const second = openTraceTab(switched, "dataset-a", {
      traceId: "abc123",
      title: "ignored title on reopen",
    });
    const state = getDatasetTabState(second, "dataset-a");

    expect(state.activeTabId).toBe("trace:abc123");
    expect(state.tabs).toHaveLength(2);
    const traceTab = state.tabs.find((tab) => tab.id === "trace:abc123");
    expect(traceTab?.title).toBe("root");
  });

  it("updates the initial span when reopening an existing trace tab", () => {
    const first = openTraceTab({}, "dataset-a", {
      traceId: "abc123",
      title: "root",
      initialSpanId: "span-1",
    });
    const switched = setActiveDatasetTab(first, "dataset-a", DEFAULT_TELEMETRY_DATASET_TAB_ID);

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

  it("keeps trace tabs and telemetry tabs together in one dataset", () => {
    const withTrace = openTraceTab({}, "dataset-a", { traceId: "abc123", title: "root" });
    const withTelemetry = openTelemetryTab(withTrace, "dataset-a");
    const state = getDatasetTabState(withTelemetry, "dataset-a");

    expect(state.activeTabId).toBe("telemetry:2");
    expect(state.tabs.map((tab) => tab.id)).toEqual([
      "telemetry:1",
      "trace:abc123",
      "telemetry:2",
    ]);
  });
});
