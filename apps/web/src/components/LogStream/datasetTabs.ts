export const DEFAULT_TELEMETRY_DATASET_TAB_ID = "telemetry:1";

export type DatasetTelemetryTabId = `telemetry:${number}`;
export type DatasetTabId = DatasetTelemetryTabId | `trace:${string}`;
export type DatasetTabIcon = "lensflare" | "trace";

export type DatasetTab =
  | {
      readonly id: DatasetTelemetryTabId;
      readonly kind: "telemetry";
      readonly icon: "lensflare";
      readonly title: string;
      readonly closable: true;
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
  readonly nextTelemetryOrdinal: number;
}

export type DatasetTabsByDataset = Readonly<Record<string, DatasetTabState>>;

export const DEFAULT_TELEMETRY_DATASET_TAB: DatasetTab = {
  id: DEFAULT_TELEMETRY_DATASET_TAB_ID,
  kind: "telemetry",
  icon: "lensflare",
  title: "Telemetry",
  closable: true,
};

export interface CloseDatasetTabResult {
  readonly tabsByDataset: DatasetTabsByDataset;
  readonly closedLast: boolean;
}

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
    : (current.tabs[0]?.id ?? DEFAULT_TELEMETRY_DATASET_TAB_ID);

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

export function openTelemetryTab(
  tabsByDataset: DatasetTabsByDataset,
  datasetId: string,
): DatasetTabsByDataset {
  const current = normalizeDatasetTabState(tabsByDataset[datasetId]);
  const ordinal = current.nextTelemetryOrdinal;
  const tabId = `telemetry:${ordinal}` as const;
  const nextTab: DatasetTab = {
    id: tabId,
    kind: "telemetry",
    icon: "lensflare",
    title: `Telemetry ${ordinal}`,
    closable: true,
  };

  return {
    ...tabsByDataset,
    [datasetId]: {
      activeTabId: tabId,
      tabs: [...current.tabs, nextTab],
      nextTelemetryOrdinal: ordinal + 1,
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
        nextTelemetryOrdinal: current.nextTelemetryOrdinal,
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
      nextTelemetryOrdinal: current.nextTelemetryOrdinal,
    },
  };
}

export function closeDatasetTab(
  tabsByDataset: DatasetTabsByDataset,
  datasetId: string,
  tabId: DatasetTabId,
): CloseDatasetTabResult {
  const current = normalizeDatasetTabState(tabsByDataset[datasetId]);
  const closedIndex = current.tabs.findIndex((candidate) => candidate.id === tabId);

  if (closedIndex < 0) {
    return { tabsByDataset, closedLast: false };
  }

  const tabs = current.tabs.filter((candidate) => candidate.id !== tabId);
  if (tabs.length === 0) {
    if (tabsByDataset[datasetId] === undefined) {
      return {
        tabsByDataset,
        closedLast: true,
      };
    }

    const { [datasetId]: _closedDataset, ...remainingTabsByDataset } = tabsByDataset;
    return {
      tabsByDataset: remainingTabsByDataset,
      closedLast: true,
    };
  }

  const fallbackTab = tabs[Math.max(0, closedIndex - 1)] ?? tabs[0]!;
  const activeTabId = current.activeTabId === tabId ? fallbackTab.id : current.activeTabId;

  return {
    tabsByDataset: {
      ...tabsByDataset,
      [datasetId]: normalizeDatasetTabState({
        activeTabId,
        tabs,
        nextTelemetryOrdinal: current.nextTelemetryOrdinal,
      }),
    },
    closedLast: false,
  };
}

function normalizeDatasetTabState(state: DatasetTabState | undefined): DatasetTabState {
  if (
    state !== undefined &&
    state.tabs.length > 0 &&
    state.tabs.some((tab) => tab.id === state.activeTabId)
  ) {
    if (state.nextTelemetryOrdinal > maxTelemetryOrdinal(state.tabs)) {
      return state;
    }

    return {
      ...state,
      nextTelemetryOrdinal: maxTelemetryOrdinal(state.tabs) + 1,
    };
  }

  const tabs = state?.tabs.length ? state.tabs : [DEFAULT_TELEMETRY_DATASET_TAB];
  const activeTabId =
    state !== undefined && tabs.some((tab) => tab.id === state.activeTabId)
      ? state.activeTabId
      : (tabs[0]?.id ?? DEFAULT_TELEMETRY_DATASET_TAB_ID);

  return {
    activeTabId,
    tabs,
    nextTelemetryOrdinal: Math.max(state?.nextTelemetryOrdinal ?? 2, maxTelemetryOrdinal(tabs) + 1),
  };
}

function maxTelemetryOrdinal(tabs: ReadonlyArray<DatasetTab>): number {
  let maxOrdinal = 0;
  for (const tab of tabs) {
    if (tab.kind !== "telemetry") {
      continue;
    }
    const ordinal = Number(tab.id.slice("telemetry:".length));
    if (Number.isFinite(ordinal)) {
      maxOrdinal = Math.max(maxOrdinal, ordinal);
    }
  }
  return maxOrdinal;
}
