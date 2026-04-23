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

import { getProjectIconComponent } from "./constants";
import {
  createDatasetContextMenuTarget,
  createProjectContextMenuTarget,
  type SidebarContextMenuTarget,
} from "./types";

interface ProjectRowProps {
  project: Project;
  activeProjectId: string | undefined;
  activeCollectionId: string | undefined;
  onCreateDataset: (project: Project) => void;
  onOpenContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    target: SidebarContextMenuTarget,
  ) => void;
}

/**
 * Renders one project row and its nested datasets. Exposes a hover-revealed
 * "new dataset" button and forwards right-clicks on both the project and any
 * dataset up to the parent orchestrator so it can open the shared context menu.
 */
export function ProjectRow({
  project,
  activeProjectId,
  activeCollectionId,
  onCreateDataset,
  onOpenContextMenu,
}: ProjectRowProps) {
  const Icon = getProjectIconComponent(project.icon);
  const isProjectActive = activeProjectId === project.id && activeCollectionId === undefined;

  return (
    <SidebarMenuItem>
      <div className="group/project-header relative">
        <SidebarMenuButton
          className="gap-2 px-2 py-1.5 pr-8 text-left"
          isActive={isProjectActive}
          onContextMenu={(event: React.MouseEvent<HTMLElement>) => {
            onOpenContextMenu(event, createProjectContextMenuTarget(project));
          }}
          render={<Link params={{ projectId: project.id }} to="/projects/$projectId" />}
          size="sm"
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate font-medium text-foreground/90 text-xs">{project.name}</span>
          </span>
        </SidebarMenuButton>

        <button
          aria-label={`New dataset in ${project.name}`}
          className="desktop-no-drag absolute top-1 right-1.5 inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring group-hover/project-header:opacity-100"
          onClick={() => {
            onCreateDataset(project);
          }}
          title="New dataset"
          type="button"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>

      {project.datasets.length > 0 ? (
        <SidebarMenuSub>
          {project.datasets.map((dataset) => (
            <DatasetSubRow
              dataset={dataset}
              isActive={activeProjectId === project.id && activeCollectionId === dataset.id}
              key={dataset.id}
              onOpenContextMenu={onOpenContextMenu}
              project={project}
            />
          ))}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

interface DatasetSubRowProps {
  project: Project;
  dataset: Dataset;
  isActive: boolean;
  onOpenContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    target: SidebarContextMenuTarget,
  ) => void;
}

function DatasetSubRow({ project, dataset, isActive, onOpenContextMenu }: DatasetSubRowProps) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        className="text-muted-foreground hover:text-foreground data-[active=true]:font-medium data-[active=true]:text-foreground"
        isActive={isActive}
        onContextMenu={(event: React.MouseEvent<HTMLElement>) => {
          onOpenContextMenu(event, createDatasetContextMenuTarget(project, dataset));
        }}
        render={
          <Link
            params={{
              collectionId: dataset.id,
              projectId: project.id,
            }}
            to="/projects/$projectId/collections/$collectionId"
          />
        }
        size="sm"
      >
        <span className="truncate">{dataset.name}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
