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
  filterSource: string;
  filter: DatasetStreamSnapshot["filter"];
  /**
   * Project slug used to template ingest URLs in the re-entry setup
   * guide. Optional — the parent route reads it from a TanStack DB live
   * query that may not be hydrated on first paint. While undefined we
   * hide the button rather than render a sheet with placeholder slugs.
   */
  projectSlug: string | undefined;
  /** Dataset slug used to template ingest URLs. Same caveat as `projectSlug`. */
  datasetSlug: string | undefined;
  /** Resolved local-server origin (no trailing slash) used in snippets. */
  serverOrigin: string;
}

/**
 * Top action bar for the log stream. Hosts the live-filter `QueryBuilder`
 * and a re-entry book icon that pops the `EmptyDatasetGuide` (the Connect
 * + MCP tabs) in a right-side sheet — useful for populated datasets that
 * already have telemetry but want to wire another agent or copy the
 * ingestion snippet again.
 */
export function LogStreamHeader({
  projectId,
  datasetId,
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
                    <Button aria-label="View setup guide" size="icon" variant="ghost">
                      <BookOpenIcon className="size-3.5" />
                    </Button>
                  }
                />
              }
            />
            <TooltipPopup side="bottom">Setup guide</TooltipPopup>
          </Tooltip>
          <SheetPopup
            className="w-[min(92vw,640px)] max-w-[640px] p-0"
            showCloseButton={false}
            side="right"
          >
            <EmptyDatasetGuide
              datasetSlug={datasetSlug}
              onClose={() => setIsGuideOpen(false)}
              projectSlug={projectSlug}
              serverOrigin={serverOrigin}
              variant="sheet"
            />
          </SheetPopup>
        </Sheet>
      ) : null}
    </div>
  );
}
