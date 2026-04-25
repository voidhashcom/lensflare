import type { Project } from "@lensflare/contracts";

/** Target of the sidebar's right-click context menu. */
export type SidebarContextMenuTarget = { kind: "project"; project: Project };

/** Subject of the delete confirmation dialog. */
export type DeleteTarget = { kind: "project"; projectId: string; name: string };

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

export function createDeleteProjectTarget(project: Project): DeleteTarget {
  return {
    kind: "project",
    name: project.name,
    projectId: project.id,
  };
}
