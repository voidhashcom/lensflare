import {
  ChevronDownIcon,
  ClockIcon,
  ColumnsIcon,
  HistoryIcon,
  LayersIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

import { SourceBadge } from "./SourceBadge";
import type { DateRangePreset, SourceIconKind } from "./types";

interface LogStreamHeaderProps {
  datasetName: string;
  datasetIcon?: SourceIconKind;
  searchValue: string;
  onSearchChange: (next: string) => void;
  dateRange: DateRangePreset;
  onDateRangeClick?: () => void;
  onSearchSubmit?: () => void;
  onScrollClick?: () => void;
  onPresetsClick?: () => void;
  onDatasetClick?: () => void;
  onSettingsClick?: () => void;
}

/**
 * Top action bar for the log stream. Mirrors the reference mock: presets
 * dropdown, dataset chip, free-text search, time-range + run, and the
 * trailing scroll / columns / settings controls. All interactions are
 * delegated to callbacks so the parent can wire them up later.
 */
export function LogStreamHeader({
  datasetName,
  datasetIcon = "js",
  searchValue,
  onSearchChange,
  dateRange,
  onDateRangeClick,
  onSearchSubmit,
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

      <div className="relative min-w-0 flex-1">
        <SearchIcon
          aria-hidden
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-3.5 text-muted-foreground/60"
        />
        <input
          className="h-8 w-full rounded-md border border-input bg-background/60 pl-8 pr-9 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/24"
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSearchSubmit?.();
            }
          }}
          placeholder="Search for logs"
          type="search"
          value={searchValue}
        />
        <button
          aria-label="History"
          className="-translate-y-1/2 absolute top-1/2 right-2 inline-flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground"
          onClick={onSearchSubmit}
          type="button"
        >
          <HistoryIcon className="size-3.5" />
        </button>
      </div>

      <HeaderPill onClick={onDateRangeClick}>
        <span className="text-xs text-foreground/80">{dateRange}</span>
        <ChevronDownIcon className="size-3 text-muted-foreground/60" />
      </HeaderPill>

      <button
        aria-label="Run search"
        className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-input bg-background/60 text-foreground hover:bg-accent/50"
        onClick={onSearchSubmit}
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
