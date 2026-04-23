import { useParams } from "@tanstack/react-router";
import { GitBranchIcon, TelescopeIcon, XIcon } from "lucide-react";
import { useMemo, type MouseEvent } from "react";

import { LogoSymbol } from "~/components/Logo";
import { cn } from "~/lib/utils";

import { getDatasetTabState, type DatasetTab, type DatasetTabId } from "./datasetTabs";
import { closeDatasetTab, setActiveDatasetTab, useDatasetTabsSnapshot } from "./datasetTabsStore";

const ROUTE_PARAMS_OPTIONS = { strict: false } as const;

/**
 * Dataset-scoped tab strip rendered in the desktop titlebar. For now every
 * dataset starts with a single unclosable Live tab; the state shape already
 * keeps room for trace-detail tabs once that view exists.
 */
export function DatasetTabsTitlebar() {
  const params = useParams(ROUTE_PARAMS_OPTIONS);
  const datasetId = params.collectionId;
  const tabsByDataset = useDatasetTabsSnapshot();

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
    setActiveDatasetTab(datasetId, tabId);
  };

  const closeTab = (tabId: DatasetTabId) => {
    closeDatasetTab(datasetId, tabId);
  };

  return (
    <div
      aria-label="Dataset tabs"
      className="desktop-drag flex min-w-0 flex-1 items-stretch overflow-x-auto px-3"
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
  const handleSelectMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    onSelect(tab.id);
  };

  const handleSelectClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) {
      onSelect(tab.id);
    }
  };

  return (
    <div
      className={cn(
        "desktop-no-drag group -mb-px inline-flex min-w-24 max-w-56 items-center border-b-2 text-sm group relative",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      role="presentation"
    >
      <button
        aria-selected={active}
        className="flex min-w-0 flex-1 cursor-pointer text-xs items-center gap-2 px-4 py-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={handleSelectClick}
        onMouseDown={handleSelectMouseDown}
        role="tab"
        type="button"
      >
        <DatasetTabIcon tab={tab} />
        <span className="min-w-0 truncate">{tab.title}</span>
      </button>
      {tab.closable ? (
        <div className="absolute right-0 top-0 bottom-0 h-full flex items-center  pl-3 opacity-0 group-hover:opacity-100">
          <div className="w-4 h-full bg-linear-to-r from-background/0 to-background" />
          <div className="bg-background pl-2">
            <button
              aria-label={`Close ${tab.title}`}
              className="mr-2 size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground inline-flex"
              onClick={() => onClose(tab.id)}
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DatasetTabIcon({ tab }: { tab: DatasetTab }) {
  if (tab.icon === "lensflare") {
    return <LogoSymbol aria-hidden className="size-3 shrink-0 text-current" />;
  }

  return <TelescopeIcon aria-hidden className="size-3 shrink-0 text-current" />;
}
