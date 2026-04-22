import { useLiveQuery } from "@tanstack/react-db";
import { useParams } from "@tanstack/react-router";
import { PlusIcon, SettingsIcon } from "lucide-react";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { projectsCollection } from "~/data/catalogApi";
import { cn } from "~/lib/utils";

import { BrandRow } from "./BrandRow.tsrx";
import { DatasetDialog } from "./DatasetDialog.tsrx";
import { DeleteDialog } from "./DeleteDialog.tsrx";
import { ProjectDialog } from "./ProjectDialog.tsrx";
import { ProjectRow } from "./ProjectRow.tsrx";
import { SearchRow } from "./SearchRow.tsrx";
import { SidebarContextMenu } from "./SidebarContextMenu.tsrx";
import { detectMacDesktop } from "./useMacDesktop";
import { useDatasetDialog } from "./useDatasetDialog";
import { useDeleteDialog } from "./useDeleteDialog";
import { useProjectDialog } from "./useProjectDialog";
import { useSidebarContextMenu } from "./useSidebarContextMenu";

/**
 * Top-level sidebar orchestrator. Owns the project list subscription and
 * coordinates the context menu / dialog interactions by delegating each
 * piece of state to its own hook and rendering the corresponding TSRX view.
 */
export component AppSidebar() {
  const isMacDesktop = detectMacDesktop();

  const params = useParams({ strict: false });
  const activeProjectId = params.projectId;
  const activeCollectionId = params.collectionId;

  const projectsQuery = useLiveQuery(projectsCollection);
  const projects = projectsQuery.data ?? [];
  const loading = projectsQuery.isLoading;
  const error =
    !loading && projectsCollection.utils.lastError instanceof Error
      ? projectsCollection.utils.lastError.message
      : null;

  const projectDialog = useProjectDialog();
  const datasetDialog = useDatasetDialog();
  const deleteDialog = useDeleteDialog(activeProjectId, activeCollectionId);
  const contextMenu = useSidebarContextMenu();

  const onContextMenuEdit = () => {
    const target = contextMenu.target;
    if (!target) {
      return;
    }

    contextMenu.close();

    if (target.kind === "project") {
      projectDialog.openEdit(target.project);
      return;
    }

    datasetDialog.openEdit(target.project, target.dataset);
  };

  const onContextMenuCreateDataset = () => {
    const target = contextMenu.target;
    if (!target || target.kind !== "project") {
      return;
    }

    contextMenu.close();
    datasetDialog.openCreate(target.project);
  };

  const onContextMenuDelete = () => {
    const target = contextMenu.target;
    if (!target) {
      return;
    }

    contextMenu.close();

    if (target.kind === "project") {
      deleteDialog.openFor({
        kind: "project",
        name: target.project.name,
        projectId: target.project.id,
      });
      return;
    }

    deleteDialog.openFor({
      datasetId: target.dataset.id,
      kind: "dataset",
      name: target.dataset.name,
      projectId: target.project.id,
    });
  };

  <SidebarHeader
    class={cn(
      "gap-3 px-3 pb-2 sm:gap-2.5 sm:px-4 sm:pb-3",
      isMacDesktop ? "desktop-drag pt-0" : "pt-2 sm:pt-3",
    )}
  >
    <BrandRow {isMacDesktop} />
    <SearchRow />
  </SidebarHeader>

  <SidebarContent>
    <SidebarGroup class="px-2 py-2">
      <div class="mb-1 flex items-center justify-between pl-2 pr-1.5">
        <span class="font-medium text-[10px] text-muted-foreground/60 uppercase tracking-wider">
          {"Projects"}
        </span>
        <button
          aria-label="New project"
          class="desktop-no-drag inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          disabled={projectDialog.submitting}
          onClick={projectDialog.openCreate}
          title="New project"
          type="button"
        >
          <PlusIcon class="size-3.5" />
        </button>
      </div>

      <SidebarMenu>
        if (loading) {
          <SidebarMenuItem>
            <div class="px-2 py-1.5 text-muted-foreground text-xs">
              {"Loading projects…"}
            </div>
          </SidebarMenuItem>
        } else if (error) {
          <SidebarMenuItem>
            <div class="px-2 py-1.5 text-destructive text-xs">{error}</div>
          </SidebarMenuItem>
        } else if (projects.length === 0) {
          <SidebarMenuItem>
            <div class="px-2 py-1.5 text-muted-foreground text-xs">
              {"No projects yet."}
            </div>
          </SidebarMenuItem>
        } else {
          for (const project of projects) {
            <ProjectRow
              {activeCollectionId}
              {activeProjectId}
              key={project.id}
              onCreateDataset={datasetDialog.openCreate}
              onOpenContextMenu={contextMenu.handleRowContextMenu}
              {project}
            />
          }
        }
      </SidebarMenu>
    </SidebarGroup>
  </SidebarContent>

  <SidebarFooter class="p-2">
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          class="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
          size="sm"
        >
          <SettingsIcon class="size-3.5" />
          <span class="text-xs">{"Settings"}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarFooter>

  <ProjectDialog
    error={projectDialog.error}
    mode={projectDialog.mode}
    name={projectDialog.name}
    onNameChange={projectDialog.onNameChange}
    onOpenChange={projectDialog.onOpenChange}
    onSubmit={projectDialog.onSubmit}
    open={projectDialog.open}
    submitting={projectDialog.submitting}
  />

  <DatasetDialog
    error={datasetDialog.error}
    mode={datasetDialog.mode}
    name={datasetDialog.name}
    onNameChange={datasetDialog.onNameChange}
    onOpenChange={datasetDialog.onOpenChange}
    onSubmit={datasetDialog.onSubmit}
    open={datasetDialog.open}
    submitting={datasetDialog.submitting}
  />

  <DeleteDialog
    error={deleteDialog.error}
    onConfirm={deleteDialog.onConfirm}
    onOpenChange={deleteDialog.onOpenChange}
    open={deleteDialog.open}
    submitting={deleteDialog.submitting}
    target={deleteDialog.target}
  />

  <SidebarContextMenu
    anchor={contextMenu.anchor}
    onCreateDataset={onContextMenuCreateDataset}
    onDelete={onContextMenuDelete}
    onEdit={onContextMenuEdit}
    onOpenChange={contextMenu.onOpenChange}
    open={contextMenu.open}
    target={contextMenu.target}
  />
}
