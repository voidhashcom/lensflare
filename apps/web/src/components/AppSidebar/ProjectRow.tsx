import type { Project } from "@lensflare/contracts";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { SidebarMenuButton, SidebarMenuItem } from "~/components/ui/sidebar";

import { getProjectIconComponent } from "./constants";
import { createProjectContextMenuTarget, type SidebarContextMenuTarget } from "./types";

interface ProjectRowProps {
  project: Project;
  activeProjectId: string | undefined;
  onOpenContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    target: SidebarContextMenuTarget,
  ) => void;
}

/**
 * Renders a single project-level row. Project selection routes into the
 * managed dataset automatically, so the sidebar no longer exposes nested
 * dataset children.
 */
export function ProjectRow({ project, activeProjectId, onOpenContextMenu }: ProjectRowProps) {
  const Icon = getProjectIconComponent(project.icon);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="gap-2 px-2 py-1.5 text-left"
        isActive={activeProjectId === project.id}
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
    </SidebarMenuItem>
  );
}
