import type { Dataset, Project } from "@lensflare/contracts";

/** Target of the sidebar's right-click context menu (project row or dataset row). */
export type SidebarContextMenuTarget =
  | { kind: "project"; project: Project }
  | { kind: "dataset"; project: Project; dataset: Dataset };

/** Subject of the delete confirmation dialog. */
export type DeleteTarget =
  | { kind: "project"; projectId: string; name: string }
  | { kind: "dataset"; datasetId: string; name: string; projectId: string };

/**
 * Virtual anchor with a cursor-derived bounding rect, used to position the
 * context menu where the user right-clicked rather than at a DOM node.
 */
export interface CursorAnchor {
  getBoundingClientRect: () => DOMRect;
}

export function createProjectContextMenuTarget(project: Project): SidebarContextMenuTarget {
  return { kind: "project", project };
}

export function createDatasetContextMenuTarget(
  project: Project,
  dataset: Dataset,
): SidebarContextMenuTarget {
  return { dataset, kind: "dataset", project };
}

export function createDeleteProjectTarget(project: Project): DeleteTarget {
  return {
    kind: "project",
    name: project.name,
    projectId: project.id,
  };
}

export function createDeleteDatasetTarget(project: Project, dataset: Dataset): DeleteTarget {
  return {
    datasetId: dataset.id,
    kind: "dataset",
    name: dataset.name,
    projectId: project.id,
  };
}
