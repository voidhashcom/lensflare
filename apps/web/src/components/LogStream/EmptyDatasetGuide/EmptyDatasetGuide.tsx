import { XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { TopTabsItem, TopTabsList, TopTabsTrigger } from "~/components/ui/top-tabs";
import { IconButtonTooltip } from "~/components/ui/tooltip";
import { readBackendTarget } from "~/data/backendTarget";
import { cn } from "~/lib/utils";

import { ConnectTab } from "./ConnectTab";
import { McpTab } from "./McpTab";

export type EmptyDatasetGuideTab = "connect" | "mcp";

interface EmptyDatasetGuideProps {
  projectSlug: string;
  datasetSlug: string;
  serverOrigin: string;
  /**
   * Which tab is selected initially. Defaults to `"connect"` — the user's
   * first job in an empty dataset is to send telemetry.
   */
  defaultTab?: EmptyDatasetGuideTab;
  /**
   * `overlay` renders as the entire dataset surface (replacing the
   * Telemetry tab strip + log table) while the dataset is empty.
   * `sheet` renders inside the right-side `Sheet` opened from the
   * `LogStreamHeader` book icon — used by populated datasets that need
   * to re-show the integration / MCP guides without leaving Telemetry.
   */
  variant?: "overlay" | "sheet";
  className?: string;
  onClose?: () => void;
}

/**
 * The "getting started" surface for a dataset. Shows two top tabs:
 *
 *   • **Connect** — language + library picker that emits the integration
 *     snippet for ingesting telemetry into this specific dataset. Slug
 *     placeholders (`{{projectSlug}}`, `{{datasetSlug}}`, …) are
 *     substituted at render time so the user always copies a snippet
 *     that works for *their* project.
 *   • **MCP** — the same MCP install snippets shown on `/docs/mcp`,
 *     bound to the running desktop server's URL so users can wire
 *     Claude / Cursor / Codex from inside the app.
 *
 * The empty-state overlay variant owns the tab strip — there is no
 * Telemetry tab and no `+` button while the dataset is empty. Once the
 * first telemetry record lands, the parent fades this surface out and
 * swaps in the original `DatasetTabsTitlebar` + `TelemetryTabPanel`
 * combination.
 */
export function EmptyDatasetGuide({
  projectSlug,
  datasetSlug,
  serverOrigin,
  defaultTab = "connect",
  variant = "overlay",
  className,
  onClose,
}: EmptyDatasetGuideProps) {
  const [activeTab, setActiveTab] = useState<EmptyDatasetGuideTab>(defaultTab);
  // The MCP URL is derived from the resolved backend target — same
  // source the public docs page uses, so the snippet always points at
  // wherever this Lensflare instance is actually listening.
  const target = readBackendTarget();

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        variant === "overlay" && "bg-background/95 backdrop-blur-sm",
        className,
      )}
      data-slot="empty-dataset-guide"
      data-variant={variant}
    >
      {variant === "sheet" ? <EmptyDatasetGuideSheetHeader onClose={onClose} /> : null}
      <EmptyDatasetGuideTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 overflow-y-auto">
        {activeTab === "connect" ? (
          <ConnectTab
            datasetSlug={datasetSlug}
            projectSlug={projectSlug}
            serverOrigin={serverOrigin}
          />
        ) : (
          <McpTab mcpUrl={target.mcpUrl} />
        )}
      </div>
    </div>
  );
}

interface EmptyDatasetGuideTabBarProps {
  activeTab: EmptyDatasetGuideTab;
  onTabChange: (tab: EmptyDatasetGuideTab) => void;
}

/**
 * Connect / MCP tab strip used by both the overlay and sheet variants.
 * Visually mirrors `DatasetTabsTitlebar` so the empty-state surface
 * reads as a peer of the populated Telemetry tab strip — there is no
 * `+` button because Telemetry tabs are unavailable until data lands.
 */
function EmptyDatasetGuideTabBar({ activeTab, onTabChange }: EmptyDatasetGuideTabBarProps) {
  return (
    <TopTabsList aria-label="Empty dataset tabs" className="shrink-0 px-3">
      <TopTabsItem active={activeTab === "connect"}>
        <TopTabsTrigger active={activeTab === "connect"} onClick={() => onTabChange("connect")}>
          Connect
        </TopTabsTrigger>
      </TopTabsItem>
      <TopTabsItem active={activeTab === "mcp"}>
        <TopTabsTrigger active={activeTab === "mcp"} onClick={() => onTabChange("mcp")}>
          MCP
        </TopTabsTrigger>
      </TopTabsItem>
    </TopTabsList>
  );
}

function EmptyDatasetGuideSheetHeader({ onClose }: { onClose: (() => void) | undefined }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
      <span className="font-mono text-muted-foreground/80 text-sm">Setup</span>
      {onClose ? (
        <IconButtonTooltip label="Close setup">
          <Button
            aria-label="Close setup"
            className="desktop-no-drag ml-auto shrink-0"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <XIcon className="size-3.5" />
          </Button>
        </IconButtonTooltip>
      ) : null}
    </div>
  );
}
