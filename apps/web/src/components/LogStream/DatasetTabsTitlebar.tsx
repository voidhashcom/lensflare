import { useParams } from "@tanstack/react-router";
import { GitBranchIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { LogoSymbol } from "~/components/Logo";
import { cn } from "~/lib/utils";

import {
  closeDatasetTab,
  getDatasetTabState,
  setActiveDatasetTab,
  type DatasetTab,
  type DatasetTabId,
  type DatasetTabsByDataset,
} from "./datasetTabs";

const ROUTE_PARAMS_OPTIONS = { strict: false } as const;

/**
 * Dataset-scoped tab strip rendered in the desktop titlebar. For now every
 * dataset starts with a single unclosable Live tab; the state shape already
 * keeps room for trace-detail tabs once that view exists.
 */
export function DatasetTabsTitlebar() {
  const params = useParams(ROUTE_PARAMS_OPTIONS);
  const datasetId = params.collectionId;
  const [tabsByDataset, setTabsByDataset] = useState<DatasetTabsByDataset>({});

  const tabState = useMemo(() => {
    if (!datasetId) {
      return null;
    }

    return getDatasetTabState(tabsByDataset, datasetId);
  }, [datasetId, tabsByDataset]);

  if (!datasetId || tabState === null) {
    return null;
  }

  const selectTab = (tabId: DatasetTabId) => {
    setTabsByDataset((current) => setActiveDatasetTab(current, datasetId, tabId));
  };

  const closeTab = (tabId: DatasetTabId) => {
    setTabsByDataset((current) => closeDatasetTab(current, datasetId, tabId));
  };

  return (
    <div
      aria-label="Dataset tabs"
      className="desktop-no-drag flex min-w-0 flex-1 items-stretch overflow-x-auto px-3"
      role="tablist"
    >
      <div className="flex min-w-0 items-center">
        {tabState.tabs.map((tab) => (
          <DatasetTabButton
            active={tab.id === tabState.activeTabId}
            key={tab.id}
            onClose={closeTab}
            onSelect={selectTab}
            tab={tab}
          />
        ))}
      </div>
    </div>
  );
}

interface DatasetTabButtonProps {
  active: boolean;
  tab: DatasetTab;
  onSelect: (tabId: DatasetTabId) => void;
  onClose: (tabId: DatasetTabId) => void;
}

function DatasetTabButton({ active, tab, onSelect, onClose }: DatasetTabButtonProps) {
  return (
    <div
      className={cn(
        "group -mb-px relative inline-flex min-w-24 max-w-56 items-center border-b-2 text-sm transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      role="presentation"
    >
      <button
        aria-selected={active}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-4 py-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => onSelect(tab.id)}
        role="tab"
        type="button"
      >
        <DatasetTabIcon tab={tab} />
        <span className="min-w-0 truncate">{tab.title}</span>
      </button>
      {tab.closable ? (
        <button
          aria-label={`Close ${tab.title}`}
          className="mr-2 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-70 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
          onClick={() => onClose(tab.id)}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function DatasetTabIcon({ tab }: { tab: DatasetTab }) {
  if (tab.icon === "lensflare") {
    return (
      <LogoSymbol
        aria-hidden
        className="size-3.5 shrink-0 text-current"
      />
    );
  }

  return <GitBranchIcon aria-hidden className="size-3.5 shrink-0 text-current" />;
}
