import type { FilterNode } from "@lensflare/contracts";
import {
  ChevronDownIcon,
  ClockIcon,
  ColumnsIcon,
  LayersIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

import { QueryBuilder } from "./filter/QueryBuilder";
import { SourceBadge } from "./SourceBadge";
import type { DateRangePreset, SourceIconKind } from "./types";

interface LogStreamHeaderProps {
  projectId: string;
  datasetId: string;
  datasetName: string;
  datasetIcon?: SourceIconKind;
  /** Fired when the user commits a filter change (popover Apply or chip remove). */
  onFilterChange: (filter: FilterNode | null) => void;
  dateRange: DateRangePreset;
  onDateRangeClick?: () => void;
  onRunQuery?: () => void;
  onScrollClick?: () => void;
  onPresetsClick?: () => void;
  onDatasetClick?: () => void;
  onSettingsClick?: () => void;
}

/**
 * Top action bar for the log stream. Mirrors the reference mock: presets
 * dropdown, dataset chip, chip-rich filter bar (QueryBuilder), time-range +
 * run, and the trailing scroll / columns / settings controls. The free-text
 * search from the previous iteration was replaced by the `QueryBuilder`
 * component which renders committed filter rows inline as chips alongside
 * the free-text input.
 */
export function LogStreamHeader({
  projectId,
  datasetId,
  datasetName,
  datasetIcon = "js",
  onFilterChange,
  dateRange,
  onDateRangeClick,
  onRunQuery,
  onScrollClick,
  onPresetsClick,
  onDatasetClick,
  onSettingsClick,
}: LogStreamHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border/70 bg-background/60 px-3 py-2">
      <HeaderPill onClick={onPresetsClick}>
        <LayersIcon className="size-3.5 text-muted-foreground/80" />
        <span className="text-xs text-foreground/80">Presets</span>
        <ChevronDownIcon className="size-3 text-muted-foreground/60" />
      </HeaderPill>

      <HeaderPill onClick={onDatasetClick}>
        <SourceBadge flat icon={datasetIcon} name={datasetName} />
        <ChevronDownIcon className="ml-1 size-3 text-muted-foreground/60" />
      </HeaderPill>

      <QueryBuilder
        datasetId={datasetId}
        onFilterChange={onFilterChange}
        projectId={projectId}
      />

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
    </div>
  );
}

interface HeaderPillProps {
  children: React.ReactNode;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * Unified pill button used for the quasi-dropdowns in the header. Keeps the
 * look consistent across Presets / Dataset / Date range / Scroll without
 * having to wire a real `Select` for the visual setup.
 */
function HeaderPill({ children, onClick, className }: HeaderPillProps) {
  return (
    <button
      className={cn(
        "inline-flex h-8 max-w-[15rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background/60 px-2.5 text-foreground/80 hover:bg-accent/50",
        className,
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
