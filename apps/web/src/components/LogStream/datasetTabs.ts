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
