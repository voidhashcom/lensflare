import type { FilterNode } from "@lensflare/contracts";

import { QueryBuilder } from "./filter/QueryBuilder";

interface LogStreamHeaderProps {
  projectId: string;
  datasetId: string;
  /** Fired when the user commits a filter change (popover Apply or chip remove). */
  onFilterChange: (filter: FilterNode | null) => void;
}

/**
 * Top action bar for the log stream. For now only the filter input is live.
 * The previous mock controls are left in a JSX comment below so they can be
 * restored once they have real behavior.
 */
export function LogStreamHeader({
  projectId,
  datasetId,
  onFilterChange,
}: LogStreamHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border/70 bg-background/60 px-3 py-2">
      <QueryBuilder
        datasetId={datasetId}
        onFilterChange={onFilterChange}
        projectId={projectId}
      />
      {/*
        Reference stub for later:

        <HeaderPill onClick={onPresetsClick}>
          <LayersIcon className="size-3.5 text-muted-foreground/80" />
          <span className="text-xs text-foreground/80">Presets</span>
          <ChevronDownIcon className="size-3 text-muted-foreground/60" />
        </HeaderPill>

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
