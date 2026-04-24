import { useParams } from "@tanstack/react-router";
import { TelescopeIcon, XIcon } from "lucide-react";
import { useMemo, type MouseEvent } from "react";

import { LogoSymbol } from "~/components/Logo";
import { TopTabsItem, TopTabsList, TopTabsTrigger } from "~/components/ui/top-tabs";
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
    <TopTabsList
      aria-label="Dataset tabs"
      className="desktop-drag h-full flex-1 items-stretch overflow-x-auto px-3"
    >
      <div className="flex min-w-0 items-stretch">
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
    </TopTabsList>
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
    <TopTabsItem
      active={active}
      className={cn("desktop-no-drag relative h-full min-w-24 max-w-56 text-sm")}
    >
      <TopTabsTrigger
        active={active}
        className="flex h-full flex-1 gap-2 text-left text-xs"
        leading={<DatasetTabIcon tab={tab} />}
        onClick={handleSelectClick}
        onMouseDown={handleSelectMouseDown}
      >
        {tab.title}
      </TopTabsTrigger>
      {tab.closable ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pl-3 opacity-0 group-hover:opacity-100">
          <div className="h-full w-4 bg-linear-to-r from-background/0 to-background" />
          <div className="bg-background pl-2">
            <button
              aria-label={`Close ${tab.title}`}
              className="pointer-events-auto mr-2 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground"
              onClick={() => onClose(tab.id)}
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        </div>
      ) : null}
    </TopTabsItem>
  );
}

function DatasetTabIcon({ tab }: { tab: DatasetTab }) {
  if (tab.icon === "lensflare") {
    return <LogoSymbol aria-hidden className="size-3 shrink-0 text-current" />;
  }

  return <TelescopeIcon aria-hidden className="size-3 shrink-0 text-current" />;
}
