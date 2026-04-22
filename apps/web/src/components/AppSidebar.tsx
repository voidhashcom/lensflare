import type { Dataset, Project } from "@lensflare/contracts";
import {
  DEFAULT_PROJECT_ICON,
} from "@lensflare/contracts";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  CompassIcon,
  FolderIcon,
  PlusIcon,
  RocketIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import * as React from "react";

import { Logo } from "~/components/Logo";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import { Label } from "~/components/ui/label";
import { Menu, MenuItem, MenuPopup } from "~/components/ui/menu";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "~/components/ui/sidebar";
import {
  createDataset,
  createProject,
  deleteDataset,
  deleteProject,
  projectsCollection,
  updateDataset,
  updateProject,
} from "~/data/catalogApi";
import { cn } from "~/lib/utils";

const PROJECT_ICON_COMPONENTS = {
  compass: CompassIcon,
  folder: FolderIcon,
  rocket: RocketIcon,
  sparkles: SparklesIcon,
} as const;

type SidebarContextMenuTarget =
  | { kind: "project"; project: Project }
  | { kind: "dataset"; project: Project; dataset: Dataset };

type DeleteTarget =
  | { kind: "project"; projectId: string; name: string }
  | { kind: "dataset"; datasetId: string; name: string; projectId: string };

interface CursorAnchor {
  getBoundingClientRect: () => DOMRect;
}

export function AppSidebar() {
  const isMacDesktop =
    typeof document !== "undefined" &&
    document.documentElement.dataset.runtime === "electron" &&
    document.documentElement.dataset.platform === "macos";

  const navigate = useNavigate();
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

  const [projectDialogOpen, setProjectDialogOpen] = React.useState(false);
  const [projectDialogMode, setProjectDialogMode] = React.useState<"create" | "edit">("create");
  const [projectDialogProjectId, setProjectDialogProjectId] = React.useState<string | null>(null);
  const [projectName, setProjectName] = React.useState("");
  const [projectDialogError, setProjectDialogError] = React.useState<string | null>(null);
  const [projectDialogSubmitting, setProjectDialogSubmitting] = React.useState(false);

  const [datasetDialogOpen, setDatasetDialogOpen] = React.useState(false);
  const [datasetDialogMode, setDatasetDialogMode] = React.useState<"create" | "edit">("create");
  const [datasetDialogProjectId, setDatasetDialogProjectId] = React.useState<string | null>(null);
  const [datasetDialogDatasetId, setDatasetDialogDatasetId] = React.useState<string | null>(null);
  const [datasetName, setDatasetName] = React.useState("");
  const [datasetDialogError, setDatasetDialogError] = React.useState<string | null>(null);
  const [datasetDialogSubmitting, setDatasetDialogSubmitting] = React.useState(false);

  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const [contextMenuOpen, setContextMenuOpen] = React.useState(false);
  const [contextMenuTarget, setContextMenuTarget] =
    React.useState<SidebarContextMenuTarget | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = React.useState<{
    x: number;
    y: number;
  } | null>(null);

  const contextMenuAnchor = React.useMemo<CursorAnchor | null>(() => {
    if (!contextMenuPosition || typeof DOMRect === "undefined") {
      return null;
    }

    return {
      getBoundingClientRect: () =>
        new DOMRect(contextMenuPosition.x, contextMenuPosition.y, 0, 0),
    };
  }, [contextMenuPosition]);

  const resetProjectDialog = React.useCallback(() => {
    setProjectDialogMode("create");
    setProjectDialogProjectId(null);
    setProjectName("");
    setProjectDialogError(null);
    setProjectDialogSubmitting(false);
  }, []);

  const closeProjectDialog = React.useCallback(() => {
    if (projectDialogSubmitting) {
      return;
    }

    setProjectDialogOpen(false);
    resetProjectDialog();
  }, [projectDialogSubmitting, resetProjectDialog]);

  const openCreateProjectDialog = React.useCallback(() => {
    resetProjectDialog();
    setProjectDialogMode("create");
    setProjectDialogOpen(true);
  }, [resetProjectDialog]);

  const openEditProjectDialog = React.useCallback((project: Project) => {
    setProjectDialogMode("edit");
    setProjectDialogProjectId(project.id);
    setProjectName(project.name);
    setProjectDialogError(null);
    setProjectDialogSubmitting(false);
    setProjectDialogOpen(true);
  }, []);

  const resetDatasetDialog = React.useCallback(() => {
    setDatasetDialogMode("create");
    setDatasetDialogProjectId(null);
    setDatasetDialogDatasetId(null);
    setDatasetName("");
    setDatasetDialogError(null);
    setDatasetDialogSubmitting(false);
  }, []);

  const closeDatasetDialog = React.useCallback(() => {
    if (datasetDialogSubmitting) {
      return;
    }

    setDatasetDialogOpen(false);
    resetDatasetDialog();
  }, [datasetDialogSubmitting, resetDatasetDialog]);

  const openCreateDatasetDialog = React.useCallback((project: Project) => {
    setDatasetDialogMode("create");
    setDatasetDialogProjectId(project.id);
    setDatasetDialogDatasetId(null);
    setDatasetName("");
    setDatasetDialogError(null);
    setDatasetDialogSubmitting(false);
    setDatasetDialogOpen(true);
  }, []);

  const openEditDatasetDialog = React.useCallback((project: Project, dataset: Dataset) => {
    setDatasetDialogMode("edit");
    setDatasetDialogProjectId(project.id);
    setDatasetDialogDatasetId(dataset.id);
    setDatasetName(dataset.name);
    setDatasetDialogError(null);
    setDatasetDialogSubmitting(false);
    setDatasetDialogOpen(true);
  }, []);

  const closeContextMenu = React.useCallback(() => {
    setContextMenuOpen(false);
    setContextMenuTarget(null);
    setContextMenuPosition(null);
  }, []);

  const openDeleteDialog = React.useCallback((target: DeleteTarget) => {
    setDeleteTarget(target);
    setDeleteError(null);
    setDeleteSubmitting(false);
  }, []);

  const closeDeleteDialog = React.useCallback(() => {
    if (deleteSubmitting) {
      return;
    }

    setDeleteTarget(null);
    setDeleteError(null);
  }, [deleteSubmitting]);

  const handleProjectSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = projectName.trim();
    if (trimmedName.length === 0) {
      setProjectDialogError("Project name is required.");
      return;
    }

    setProjectDialogSubmitting(true);
    setProjectDialogError(null);

    try {
      if (projectDialogMode === "edit" && projectDialogProjectId) {
        await updateProject(projectDialogProjectId, {
          icon: DEFAULT_PROJECT_ICON,
          name: trimmedName,
        });
      } else {
        const project = await createProject({
          icon: DEFAULT_PROJECT_ICON,
          name: trimmedName,
        });
        await navigate({
          params: { projectId: project.id },
          to: "/projects/$projectId",
        });
      }

      setProjectDialogOpen(false);
      resetProjectDialog();
    } catch (submitError) {
      setProjectDialogError(
        submitError instanceof Error ? submitError.message : "Failed to save project.",
      );
    } finally {
      setProjectDialogSubmitting(false);
    }
  };

  const handleDatasetSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = datasetName.trim();
    if (trimmedName.length === 0) {
      setDatasetDialogError("Dataset name is required.");
      return;
    }

    if (!datasetDialogProjectId) {
      setDatasetDialogError("A project is required.");
      return;
    }

    setDatasetDialogSubmitting(true);
    setDatasetDialogError(null);

    try {
      if (datasetDialogMode === "edit" && datasetDialogDatasetId) {
        await updateDataset(datasetDialogProjectId, datasetDialogDatasetId, {
          name: trimmedName,
        });
      } else {
        const dataset = await createDataset(datasetDialogProjectId, {
          name: trimmedName,
        });
        await navigate({
          params: {
            collectionId: dataset.id,
            projectId: datasetDialogProjectId,
          },
          to: "/projects/$projectId/collections/$collectionId",
        });
      }

      setDatasetDialogOpen(false);
      resetDatasetDialog();
    } catch (submitError) {
      setDatasetDialogError(
        submitError instanceof Error ? submitError.message : "Failed to save dataset.",
      );
    } finally {
      setDatasetDialogSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    setDeleteSubmitting(true);
    setDeleteError(null);

    try {
      if (deleteTarget.kind === "project") {
        await deleteProject(deleteTarget.projectId);
        if (activeProjectId === deleteTarget.projectId) {
          await navigate({ to: "/" });
        }
      } else {
        await deleteDataset(deleteTarget.projectId, deleteTarget.datasetId);
        if (
          activeProjectId === deleteTarget.projectId &&
          activeCollectionId === deleteTarget.datasetId
        ) {
          await navigate({
            params: { projectId: deleteTarget.projectId },
            to: "/projects/$projectId",
          });
        }
      }

      setDeleteTarget(null);
      setDeleteError(null);
    } catch (deleteFailure) {
      setDeleteError(
        deleteFailure instanceof Error ? deleteFailure.message : "Failed to delete item.",
      );
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handleRowContextMenu = (
    event: React.MouseEvent<HTMLElement>,
    target: SidebarContextMenuTarget,
  ) => {
    event.preventDefault();
    setContextMenuTarget(target);
    setContextMenuPosition({
      x: event.clientX,
      y: event.clientY,
    });
    setContextMenuOpen(true);
  };

  const handleContextMenuEdit = () => {
    if (!contextMenuTarget) {
      return;
    }

    closeContextMenu();

    if (contextMenuTarget.kind === "project") {
      openEditProjectDialog(contextMenuTarget.project);
      return;
    }

    openEditDatasetDialog(contextMenuTarget.project, contextMenuTarget.dataset);
  };

  const handleContextMenuCreateDataset = () => {
    if (!contextMenuTarget || contextMenuTarget.kind !== "project") {
      return;
    }

    closeContextMenu();
    openCreateDatasetDialog(contextMenuTarget.project);
  };

  const handleContextMenuDelete = () => {
    if (!contextMenuTarget) {
      return;
    }

    closeContextMenu();

    if (contextMenuTarget.kind === "project") {
      openDeleteDialog({
        kind: "project",
        name: contextMenuTarget.project.name,
        projectId: contextMenuTarget.project.id,
      });
      return;
    }

    openDeleteDialog({
      datasetId: contextMenuTarget.dataset.id,
      kind: "dataset",
      name: contextMenuTarget.dataset.name,
      projectId: contextMenuTarget.project.id,
    });
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
        <SearchRow />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-2 py-2">
          <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
            <span className="font-medium text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              Projects
            </span>
            <button
              aria-label="New project"
              className="desktop-no-drag inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              disabled={projectDialogSubmitting}
              onClick={openCreateProjectDialog}
              title="New project"
              type="button"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>

          <SidebarMenu>
            {loading ? (
              <SidebarMenuItem>
                <div className="px-2 py-1.5 text-muted-foreground text-xs">Loading projects…</div>
              </SidebarMenuItem>
            ) : null}

            {!loading && error ? (
              <SidebarMenuItem>
                <div className="px-2 py-1.5 text-destructive text-xs">{error}</div>
              </SidebarMenuItem>
            ) : null}

            {!loading && !error && projects.length === 0 ? (
              <SidebarMenuItem>
                <div className="px-2 py-1.5 text-muted-foreground text-xs">
                  No projects yet.
                </div>
              </SidebarMenuItem>
            ) : null}

            {projects.map((project) => (
              <ProjectRow
                activeCollectionId={activeCollectionId}
                activeProjectId={activeProjectId}
                key={project.id}
                onCreateDataset={openCreateDatasetDialog}
                onOpenContextMenu={handleRowContextMenu}
                project={project}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
              size="sm"
            >
              <SettingsIcon className="size-3.5" />
              <span className="text-xs">Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <ProjectDialog
        error={projectDialogError}
        mode={projectDialogMode}
        name={projectName}
        onNameChange={setProjectName}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectDialog();
          }
        }}
        onSubmit={handleProjectSubmit}
        open={projectDialogOpen}
        submitting={projectDialogSubmitting}
      />

      <DatasetDialog
        error={datasetDialogError}
        mode={datasetDialogMode}
        name={datasetName}
        onNameChange={setDatasetName}
        onOpenChange={(open) => {
          if (!open) {
            closeDatasetDialog();
          }
        }}
        onSubmit={handleDatasetSubmit}
        open={datasetDialogOpen}
        submitting={datasetDialogSubmitting}
      />

      <DeleteDialog
        error={deleteError}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        onOpenChange={(open) => {
          if (!open) {
            closeDeleteDialog();
          }
        }}
        open={deleteTarget !== null}
        submitting={deleteSubmitting}
        target={deleteTarget}
      />

      <Menu
        onOpenChange={(open) => {
          if (!open) {
            closeContextMenu();
          } else {
            setContextMenuOpen(true);
          }
        }}
        open={contextMenuOpen}
      >
        {contextMenuTarget && contextMenuAnchor ? (
          <MenuPopup
            align="start"
            anchor={() => contextMenuAnchor}
            className="w-48"
            side="bottom"
            sideOffset={6}
          >
            {contextMenuTarget.kind === "project" ? (
              <React.Fragment>
                <MenuItem onClick={handleContextMenuCreateDataset}>
                  <PlusIcon className="size-4" />
                  New dataset
                </MenuItem>
                <MenuItem onClick={handleContextMenuEdit}>
                  <SettingsIcon className="size-4" />
                  Edit project
                </MenuItem>
                <MenuItem onClick={handleContextMenuDelete} variant="destructive">
                  <Trash2Icon className="size-4" />
                  Delete project
                </MenuItem>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <MenuItem onClick={handleContextMenuEdit}>
                  <SettingsIcon className="size-4" />
                  Edit dataset
                </MenuItem>
                <MenuItem onClick={handleContextMenuDelete} variant="destructive">
                  <Trash2Icon className="size-4" />
                  Delete dataset
                </MenuItem>
              </React.Fragment>
            )}
          </MenuPopup>
        ) : null}
      </Menu>
    </>
  );
}

function BrandRow({ isMacDesktop }: { isMacDesktop: boolean }) {
  return (
    <div
      className={cn(
        "grid items-center",
        isMacDesktop
          ? "-ml-3 h-[var(--desktop-titlebar-height)] grid-cols-[var(--desktop-traffic-light-clearance)_minmax(0,1fr)] sm:-ml-4"
          : "grid-cols-[1fr]",
        !isMacDesktop && "min-h-8",
      )}
    >
      {isMacDesktop ? <div aria-hidden className="h-full" /> : null}
      <Logo
        aria-label="Lensflare"
        className={cn(
          "h-4.5 mt-1 w-auto max-w-[11.5rem] text-sidebar-foreground",
          isMacDesktop ? "justify-self-center" : "justify-self-center",
        )}
      />
    </div>
  );
}

function SearchRow() {
  return (
    <div className="desktop-no-drag relative flex h-8 items-center rounded-lg bg-accent/40 pl-2.5 pr-2 ring-ring/24 transition-shadow has-focus-visible:ring-[3px]">
      <SearchIcon className="pointer-events-none size-3.5 shrink-0 text-muted-foreground" />
      <input
        aria-label="Search projects and datasets"
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm leading-8 outline-none placeholder:text-muted-foreground/72"
        placeholder="Search"
        type="search"
      />
      <Kbd>⌘K</Kbd>
    </div>
  );
}

function ProjectRow({
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

  return (
    <SidebarMenuItem>
      <div className="group/project-header relative">
        <SidebarMenuButton
          className="gap-2 px-2 py-1.5 pr-8 text-left"
          isActive={activeProjectId === project.id && activeCollectionId === undefined}
          onContextMenu={(event) => {
            onOpenContextMenu(event, { kind: "project", project });
          }}
          render={<Link params={{ projectId: project.id }} to="/projects/$projectId" />}
          size="sm"
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate font-medium text-foreground/90 text-xs">
              {project.name}
            </span>
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
          {project.datasets.map((dataset) => {
            const isActive =
              activeProjectId === project.id && activeCollectionId === dataset.id;

            return (
              <SidebarMenuSubItem key={dataset.id}>
                <SidebarMenuSubButton
                  className="text-muted-foreground hover:text-foreground data-[active=true]:font-medium data-[active=true]:text-foreground"
                  isActive={isActive}
                  onContextMenu={(event) => {
                    onOpenContextMenu(event, { dataset, kind: "dataset", project });
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
          })}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

function ProjectDialog({
  open,
  mode,
  name,
  error,
  submitting,
  onOpenChange,
  onNameChange,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  name: string;
  error: string | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onNameChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const formId = React.useId();
  const isEditing = mode === "edit";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Project" : "New Project"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the project name."
              : "Create a new project and organize its datasets from the sidebar."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form className="space-y-5" id={formId} onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                autoFocus
                disabled={submitting}
                id="project-name"
                onChange={(event) => {
                  onNameChange(event.target.value);
                }}
                placeholder="Lensflare"
                value={name}
              />
            </div>

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button disabled={submitting} form={formId} type="submit">
            {submitting ? "Saving..." : isEditing ? "Save Project" : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DatasetDialog({
  open,
  mode,
  name,
  error,
  submitting,
  onOpenChange,
  onNameChange,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  name: string;
  error: string | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onNameChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const formId = React.useId();
  const isEditing = mode === "edit";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Dataset" : "New Dataset"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Rename this dataset without leaving the current workspace."
              : "Add a dataset to the selected project."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form className="space-y-4" id={formId} onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="dataset-name">Name</Label>
              <Input
                autoFocus
                disabled={submitting}
                id="dataset-name"
                onChange={(event) => {
                  onNameChange(event.target.value);
                }}
                placeholder="Production telemetry"
                value={name}
              />
            </div>

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button disabled={submitting} form={formId} type="submit">
            {submitting ? "Saving..." : isEditing ? "Save Dataset" : "Create Dataset"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DeleteDialog({
  open,
  target,
  error,
  submitting,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  target: DeleteTarget | null;
  error: string | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target?.kind === "dataset" ? "Delete Dataset" : "Delete Project"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target
              ? `This will permanently delete "${target.name}".`
              : "This will permanently delete the selected item."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? <p className="px-6 text-destructive text-sm">{error}</p> : null}

        <AlertDialogFooter>
          <AlertDialogClose disabled={submitting} render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button disabled={submitting} onClick={onConfirm} variant="destructive">
            {submitting ? "Deleting..." : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
