export const LIVE_DATASET_TAB_ID = "live";

export type DatasetTabId = typeof LIVE_DATASET_TAB_ID | `trace:${string}`;
export type DatasetTabIcon = "lensflare" | "trace";

export type DatasetTab =
  | {
      readonly id: typeof LIVE_DATASET_TAB_ID;
      readonly kind: "live";
      readonly icon: "lensflare";
      readonly title: "Live";
      readonly closable: false;
    }
  | {
      readonly id: `trace:${string}`;
      readonly kind: "trace";
      readonly icon: "trace";
      readonly title: string;
      readonly closable: true;
      readonly traceId: string;
      /**
       * Span to select when the explorer first mounts. Typically the span
       * that was highlighted in the log details panel that spawned this tab
       * — carried across so the user doesn't lose their place. Optional
       * because a trace can be opened without a starting focus (e.g. from
       * a hypothetical "recent traces" list).
       */
      readonly initialSpanId?: string;
    };

export interface DatasetTabState {
  readonly activeTabId: DatasetTabId;
  readonly tabs: ReadonlyArray<DatasetTab>;
}

export type DatasetTabsByDataset = Readonly<Record<string, DatasetTabState>>;

export const LIVE_DATASET_TAB: DatasetTab = {
  id: LIVE_DATASET_TAB_ID,
  kind: "live",
  icon: "lensflare",
  title: "Live",
  closable: false,
};

export function getDatasetTabState(
  tabsByDataset: DatasetTabsByDataset,
  datasetId: string,
): DatasetTabState {
  return normalizeDatasetTabState(tabsByDataset[datasetId]);
}

export function setActiveDatasetTab(
  tabsByDataset: DatasetTabsByDataset,
  datasetId: string,
  tabId: DatasetTabId,
): DatasetTabsByDataset {
  const existing = tabsByDataset[datasetId];
  const current = normalizeDatasetTabState(existing);
  const nextActiveTabId = current.tabs.some((tab) => tab.id === tabId)
    ? tabId
    : LIVE_DATASET_TAB_ID;

  if (existing === current && current.activeTabId === nextActiveTabId) {
    return tabsByDataset;
  }

  return {
    ...tabsByDataset,
    [datasetId]: {
      ...current,
      activeTabId: nextActiveTabId,
    },
  };
}

export interface OpenTraceTabInput {
  readonly traceId: string;
  /** Shown in the tab strip. Typically the root span name so it's easy to
   *  distinguish from neighbouring traces; we don't enforce a format. */
  readonly title: string;
  readonly initialSpanId?: string;
}

/**
 * Append a trace tab for the given dataset and make it active. If a tab for
 * the same trace already exists we reactivate it instead of duplicating —
 * users clicking "Explore trace" a second time from a different log should
 * land on the same view, not accumulate tabs.
 */
export function openTraceTab(
  tabsByDataset: DatasetTabsByDataset,
  datasetId: string,
  input: OpenTraceTabInput,
): DatasetTabsByDataset {
  const tabId = `trace:${input.traceId}` as const;
  const current = normalizeDatasetTabState(tabsByDataset[datasetId]);
  const existingIndex = current.tabs.findIndex((tab) => tab.id === tabId);

  if (existingIndex >= 0) {
    const existingTab = current.tabs[existingIndex];
    if (existingTab?.kind !== "trace") {
      return tabsByDataset;
    }

    const nextTab =
      existingTab.initialSpanId === input.initialSpanId
        ? existingTab
        : {
            ...existingTab,
            ...(input.initialSpanId !== undefined ? { initialSpanId: input.initialSpanId } : {}),
          };

    if (current.activeTabId === tabId && nextTab === existingTab) {
      return tabsByDataset;
    }

    const nextTabs =
      nextTab === existingTab
        ? current.tabs
        : current.tabs.map((tab, index) => (index === existingIndex ? nextTab : tab));

    return {
      ...tabsByDataset,
      [datasetId]: {
        activeTabId: tabId,
        tabs: nextTabs,
      },
    };
  }

  const nextTab: DatasetTab = {
    id: tabId,
    kind: "trace",
    icon: "trace",
    title: input.title,
    closable: true,
    traceId: input.traceId,
    ...(input.initialSpanId !== undefined ? { initialSpanId: input.initialSpanId } : {}),
  };

  return {
    ...tabsByDataset,
    [datasetId]: {
      activeTabId: tabId,
      tabs: [...current.tabs, nextTab],
    },
  };
}

export function closeDatasetTab(
  tabsByDataset: DatasetTabsByDataset,
  datasetId: string,
  tabId: DatasetTabId,
): DatasetTabsByDataset {
  const current = normalizeDatasetTabState(tabsByDataset[datasetId]);
  const tab = current.tabs.find((candidate) => candidate.id === tabId);

  if (!tab?.closable) {
    return tabsByDataset;
  }

  const tabs = current.tabs.filter((candidate) => candidate.id !== tabId);
  const activeTabId =
    current.activeTabId === tabId ? (tabs.at(-1)?.id ?? LIVE_DATASET_TAB_ID) : current.activeTabId;

  return {
    ...tabsByDataset,
    [datasetId]: normalizeDatasetTabState({
      activeTabId,
      tabs,
    }),
  };
}

function normalizeDatasetTabState(state: DatasetTabState | undefined): DatasetTabState {
  if (
    state !== undefined &&
    state.tabs.some((tab) => tab.id === LIVE_DATASET_TAB_ID) &&
    state.tabs.some((tab) => tab.id === state.activeTabId)
  ) {
    return state;
  }

  const tabs = state?.tabs.some((tab) => tab.id === LIVE_DATASET_TAB_ID)
    ? state.tabs
    : [LIVE_DATASET_TAB, ...(state?.tabs ?? [])];

  const activeTabId =
    state !== undefined && tabs.some((tab) => tab.id === state.activeTabId)
      ? state.activeTabId
      : LIVE_DATASET_TAB_ID;

  return {
    activeTabId,
    tabs,
  };
}
