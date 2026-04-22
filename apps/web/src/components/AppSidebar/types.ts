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
