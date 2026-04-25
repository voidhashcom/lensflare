import { BookOpenIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Sheet, SheetPopup, SheetTrigger } from "~/components/ui/sheet";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { EmptyDatasetGuide } from "./EmptyDatasetGuide";
import { QueryBuilder } from "./filter/QueryBuilder";
import { LogPresetDropdown } from "./LogPresetDropdown";
import type { DatasetStreamSnapshot } from "./logStreamStore";

interface LogStreamHeaderProps {
  projectId: string;
  datasetId: string;
  viewId: DatasetStreamSnapshot["viewId"];
  datasetName: string;
  filterSource: string;
  filter: DatasetStreamSnapshot["filter"];
  /**
   * Project slug used to template ingest URLs in the re-entry setup guide.
   * Optional — the parent route reads it from a TanStack DB live query that
   * may not be hydrated on first paint. While undefined we hide the button
   * rather than render a sheet with placeholder slugs.
   */
  projectSlug: string | undefined;
  /** Dataset slug used to template ingest URLs. Same caveat as `projectSlug`. */
  datasetSlug: string | undefined;
  /** Resolved local-server origin (no trailing slash) used in snippets. */
  serverOrigin: string;
}

/**
 * Top action bar for the log stream. Hosts the live-filter `QueryBuilder`
 * and the "View setup guide" affordance: clicking the trailing icon button
 * opens the `EmptyDatasetGuide` in a right-side `Sheet`, so users with
 * data already flowing can still jump back to the integration snippets.
 *
 * The button is hidden while `projectSlug` or `datasetSlug` are still
 * hydrating — the guide needs both to produce usable URLs, and a flash of
 * enabled → disabled feels worse than letting the button appear a tick
 * later when the collections resolve.
 */
export function LogStreamHeader({
  projectId,
  datasetId,
  datasetName,
  datasetSlug,
  filter,
  filterSource,
  projectSlug,
  serverOrigin,
  viewId,
}: LogStreamHeaderProps) {
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const canOpenGuide = projectSlug !== undefined && datasetSlug !== undefined;

  return (
    <div className="flex items-center gap-2 border-b border-border/70 bg-background/60 px-3 py-2">
      <LogPresetDropdown
        datasetId={datasetId}
        filter={filter}
        filterSource={filterSource}
        projectId={projectId}
        viewId={viewId}
      />
      <QueryBuilder
        appliedSource={filterSource}
        datasetId={datasetId}
        projectId={projectId}
        viewId={viewId}
      />
      {canOpenGuide ? (
        <Sheet onOpenChange={setIsGuideOpen} open={isGuideOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <SheetTrigger
                  render={
                    <Button
                      aria-label="View setup guide"
                      size="icon"
                      variant="ghost"
                    >
                      <BookOpenIcon className="size-3.5" />
                    </Button>
                  }
                />
              }
            />
            <TooltipPopup side="bottom">Setup guide</TooltipPopup>
          </Tooltip>
          <SheetPopup className="w-[min(92vw,640px)] max-w-[640px] p-0" side="right">
            <EmptyDatasetGuide
              datasetName={datasetName}
              datasetSlug={datasetSlug}
              projectSlug={projectSlug}
              serverOrigin={serverOrigin}
              variant="sheet"
            />
          </SheetPopup>
        </Sheet>
      ) : null}
      {/*
        Reference stub for later:

        <HeaderPill onClick={onDatasetClick}>
          <SourceBadge flat icon={datasetIcon} name={datasetName} />
          <ChevronDownIcon className="ml-1 size-3 text-muted-foreground/60" />
        </HeaderPill>

        <HeaderPill onClick={onDateRangeClick}>
          <span className="text-xs text-foreground/80">{dateRange}</span>
          <ChevronDownIcon className="size-3 text-muted-foreground/60" />
        </HeaderPill>

        <button
          aria-label="Run search"
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-input bg-background/60 text-foreground hover:bg-accent/50"
          onClick={onRunQuery}
          type="button"
        >
          <SearchIcon className="size-3.5" />
        </button>

        <HeaderPill onClick={onScrollClick}>
          <ClockIcon className="size-3.5 text-muted-foreground/80" />
          <span className="text-xs text-foreground/80">Scroll to</span>
          <ChevronDownIcon className="size-3 text-muted-foreground/60" />
        </HeaderPill>

        <button
          aria-label="Column layout"
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-input bg-background/60 text-muted-foreground/80 hover:bg-accent/50 hover:text-foreground"
          type="button"
        >
          <ColumnsIcon className="size-3.5" />
        </button>

        <button
          aria-label="Settings"
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground/80 hover:bg-accent/50 hover:text-foreground"
          onClick={onSettingsClick}
          type="button"
        >
          <SettingsIcon className="size-3.5" />
        </button>
      */}
    </div>
  );
}
