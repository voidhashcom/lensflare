import type { Dataset, Project } from "@lensflare/contracts";
import { Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import type * as React from "react";

import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "~/components/ui/sidebar";
import { PROJECT_ICON_COMPONENTS } from "./constants";
import type { SidebarContextMenuTarget } from "./types";

/**
 * Renders one project row and its nested datasets. Exposes a hover-revealed
 * "new dataset" button and forwards right-clicks on both the project and any
 * dataset up to the parent orchestrator so it can open the shared context menu.
 */
export component ProjectRow({
  project,
  activeProjectId,
  activeCollectionId,
  onCreateDataset,
  onOpenContextMenu,
}: {
  project: Project;
  activeProjectId: string | undefined;
  activeCollectionId: string | undefined;
  onCreateDataset: (project: Project) => void;
  onOpenContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    target: SidebarContextMenuTarget,
  ) => void;
}) {
  const Icon = PROJECT_ICON_COMPONENTS[project.icon];
  const isProjectActive =
    activeProjectId === project.id && activeCollectionId === undefined;

  <SidebarMenuItem>
    <div class="group/project-header relative">
      <SidebarMenuButton
        class="gap-2 px-2 py-1.5 pr-8 text-left"
        isActive={isProjectActive}
        onContextMenu={(event: React.MouseEvent<HTMLElement>) => {
          onOpenContextMenu(event, { kind: "project", project });
        }}
        render={<tsx><Link params={{ projectId: project.id }} to="/projects/$projectId" /></tsx>}
        size="sm"
      >
        <Icon class="size-3.5 shrink-0 text-muted-foreground/70" />
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <span class="truncate font-medium text-foreground/90 text-xs">
            {project.name}
          </span>
        </span>
      </SidebarMenuButton>

      <button
        aria-label={`New dataset in ${project.name}`}
        class="desktop-no-drag absolute top-1 right-1.5 inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring group-hover/project-header:opacity-100"
        onClick={() => {
          onCreateDataset(project);
        }}
        title="New dataset"
        type="button"
      >
        <PlusIcon class="size-3.5" />
      </button>
    </div>

    if (project.datasets.length > 0) {
      <SidebarMenuSub>
        for (const dataset of project.datasets) {
          <DatasetSubRow
            {dataset}
            isActive={activeProjectId === project.id && activeCollectionId === dataset.id}
            key={dataset.id}
            {onOpenContextMenu}
            {project}
          />
        }
      </SidebarMenuSub>
    }
  </SidebarMenuItem>
}

component DatasetSubRow({
  project,
  dataset,
  isActive,
  onOpenContextMenu,
}: {
  project: Project;
  dataset: Dataset;
  isActive: boolean;
  onOpenContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    target: SidebarContextMenuTarget,
  ) => void;
}) {
  <SidebarMenuSubItem>
    <SidebarMenuSubButton
      class="text-muted-foreground hover:text-foreground data-[active=true]:font-medium data-[active=true]:text-foreground"
      {isActive}
      onContextMenu={(event: React.MouseEvent<HTMLElement>) => {
        onOpenContextMenu(event, { dataset, kind: "dataset", project });
      }}
      render={
        <tsx>
          <Link
            params={{
              collectionId: dataset.id,
              projectId: project.id,
            }}
            to="/projects/$projectId/collections/$collectionId"
          />
        </tsx>
      }
      size="sm"
    >
      <span class="truncate">{dataset.name}</span>
    </SidebarMenuSubButton>
  </SidebarMenuSubItem>
}
