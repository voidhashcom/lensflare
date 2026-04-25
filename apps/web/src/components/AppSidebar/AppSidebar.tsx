import type { Project } from "@lensflare/contracts";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { PlusIcon, SettingsIcon } from "lucide-react";

import { datasetsCollection } from "~/collections/datasetsCollection";
import { projectsCollection } from "~/collections/projectsCollection";
import { SettingsSidebarNav } from "~/components/settings/SettingsSidebarNav";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { IconButtonTooltip } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { BrandRow } from "./BrandRow";
import { DeleteDialog } from "./DeleteDialog";
import { ProjectDialog } from "./ProjectDialog";
import { ProjectRow } from "./ProjectRow";
import { SidebarUpdatePill } from "./SidebarUpdatePill";
import { SidebarContextMenu } from "./SidebarContextMenu";
import { ROUTE_PARAMS_OPTIONS } from "./constants";
import { selectSidebarProjects } from "./projectsQuery";
import { createDeleteProjectTarget } from "./types";
import { detectMacDesktop } from "./useMacDesktop";
import { useDeleteDialog } from "./useDeleteDialog";
import { useProjectDialog } from "./useProjectDialog";
import { useSidebarContextMenu } from "./useSidebarContextMenu";

/**
 * Top-level sidebar orchestrator. Owns the project list subscription and
 * coordinates the context menu / dialog interactions by delegating each
 * piece of state to its own hook and rendering the corresponding React view.
 */
export function AppSidebar() {
  const isMacDesktop = detectMacDesktop();
  const pathname = useLocation({ select: (location) => location.pathname });
  const isOnSettings = pathname.startsWith("/settings");

  const params = useParams(ROUTE_PARAMS_OPTIONS);
  const activeProjectId = params.projectId;
  const projectsQuery = useLiveQuery(selectSidebarProjects);
  const projects = (projectsQuery.data ?? []) as Project[];
  const loading = projectsQuery.isLoading;
  const error = !loading
    ? projectsCollection.utils.lastError instanceof Error
      ? projectsCollection.utils.lastError.message
      : datasetsCollection.utils.lastError instanceof Error
        ? datasetsCollection.utils.lastError.message
        : null
    : null;

  const projectDialog = useProjectDialog();
  const deleteDialog = useDeleteDialog(activeProjectId);
  const contextMenu = useSidebarContextMenu();

  const onContextMenuEdit = () => {
    const target = contextMenu.target;
    if (!target) {
      return;
    }

    contextMenu.close();
    projectDialog.openEdit(target.project);
  };

  const onContextMenuDelete = () => {
    const target = contextMenu.target;
    if (!target) {
      return;
    }

    contextMenu.close();
    deleteDialog.openFor(createDeleteProjectTarget(target.project));
  };

  return (
    <>
      <SidebarHeader
        className={cn(
          "gap-3 px-3 pb-2 sm:gap-2.5 sm:px-4 sm:pb-3",
          isMacDesktop ? "desktop-drag pt-0" : "pt-2 sm:pt-3",
        )}
      >
        <BrandRow isMacDesktop={isMacDesktop} />
      </SidebarHeader>

      {isOnSettings ? (
        <SettingsSidebarNav pathname={pathname} />
      ) : (
        <>
          <SidebarContent>
            <SidebarGroup className="px-2 py-2">
              <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
                <span className="font-medium text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                  Projects
                </span>
                <IconButtonTooltip label="New project" side="right">
                  <button
                    aria-label="New project"
                    className="desktop-no-drag inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                    disabled={projectDialog.submitting}
                    onClick={() => projectDialog.openCreate()}
                    type="button"
                  >
                    <PlusIcon className="size-3.5" />
                  </button>
                </IconButtonTooltip>
              </div>

              <SidebarMenu>
                {loading ? (
                  <SidebarMenuItem>
                    <div className="px-2 py-1.5 text-muted-foreground text-xs">
                      Loading projects...
                    </div>
                  </SidebarMenuItem>
                ) : error ? (
                  <SidebarMenuItem>
                    <div className="px-2 py-1.5 text-destructive text-xs">{error}</div>
                  </SidebarMenuItem>
                ) : projects.length === 0 ? (
                  <SidebarMenuItem>
                    <div className="px-2 py-1.5 text-muted-foreground text-xs">
                      No projects yet.
                    </div>
                  </SidebarMenuItem>
                ) : (
                  projects.map((project) => (
                    <ProjectRow
                      activeProjectId={activeProjectId}
                      key={project.id}
                      onOpenContextMenu={(event, target) =>
                        contextMenu.handleRowContextMenu(event, target)
                      }
                      project={project}
                    />
                  ))
                )}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="p-2">
            <SidebarUpdatePill />
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  render={<Link to="/settings" />}
                  size="sm"
                >
                  <SettingsIcon className="size-3.5" />
                  <span className="text-xs">Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </>
      )}

      <ProjectDialog
        error={projectDialog.error}
        mode={projectDialog.mode}
        name={projectDialog.name}
        onNameChange={(value) => projectDialog.onNameChange(value)}
        onOpenChange={(open) => projectDialog.onOpenChange(open)}
        onSubmit={(event) => projectDialog.onSubmit(event)}
        open={projectDialog.open}
        submitting={projectDialog.submitting}
      />

      <DeleteDialog
        error={deleteDialog.error}
        onConfirm={() => deleteDialog.onConfirm()}
        onOpenChange={(open) => deleteDialog.onOpenChange(open)}
        open={deleteDialog.open}
        submitting={deleteDialog.submitting}
        target={deleteDialog.target}
      />

      <SidebarContextMenu
        anchor={contextMenu.anchor}
        onDelete={onContextMenuDelete}
        onEdit={onContextMenuEdit}
        onOpenChange={(open) => contextMenu.onOpenChange(open)}
        open={contextMenu.open}
        target={contextMenu.target}
      />
    </>
  );
}
