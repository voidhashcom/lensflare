import { useNavigate, useParams } from "@tanstack/react-router";
import { PlusIcon, TelescopeIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, type MouseEvent } from "react";

import { LogoSymbol } from "~/components/Logo";
import { TopTabsItem, TopTabsList, TopTabsTrigger } from "~/components/ui/top-tabs";
import { IconButtonTooltip } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { getDatasetTabState, type DatasetTab, type DatasetTabId } from "./datasetTabs";
import {
  closeDatasetTab,
  openTelemetryTab,
  setActiveDatasetTab,
  useDatasetTabsSnapshot,
} from "./datasetTabsStore";

const ROUTE_PARAMS_OPTIONS = { strict: false } as const;

/**
 * Dataset-scoped tab strip rendered in the desktop titlebar.
 */
export function DatasetTabsTitlebar() {
  const params = useParams(ROUTE_PARAMS_OPTIONS);
  const navigate = useNavigate();
  const projectId = params.projectId;
  const datasetId = params.collectionId;
  const tabsByDataset = useDatasetTabsSnapshot();

  const tabState = useMemo(() => {
    if (!datasetId) {
      return null;
    }

    return getDatasetTabState(tabsByDataset, datasetId);
  }, [datasetId, tabsByDataset]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key.toLowerCase() !== "t") return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (!datasetId) return;

      event.preventDefault();
      event.stopPropagation();
      openTelemetryTab(datasetId);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [datasetId]);

  if (!datasetId || tabState === null) {
    return null;
  }

  const selectTab = (tabId: DatasetTabId) => {
    setActiveDatasetTab(datasetId, tabId);
  };

  const closeTab = (tabId: DatasetTabId) => {
    const result = closeDatasetTab(datasetId, tabId);
    if (result.closedLast && projectId) {
      void navigate({
        to: "/projects/$projectId",
        params: { projectId },
        replace: true,
      });
    }
  };

  const openTab = () => {
    openTelemetryTab(datasetId);
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
        <IconButtonTooltip label="New Telemetry tab">
          <button
            aria-label="New Telemetry tab"
            className="desktop-no-drag inline-flex h-full w-9 shrink-0 cursor-pointer items-center justify-center text-muted-foreground/70 outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onClick={openTab}
            type="button"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </IconButtonTooltip>
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
            <IconButtonTooltip label={`Close ${tab.title}`}>
              <button
                aria-label={`Close ${tab.title}`}
                className="pointer-events-auto mr-2 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground"
                onClick={() => onClose(tab.id)}
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            </IconButtonTooltip>
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
