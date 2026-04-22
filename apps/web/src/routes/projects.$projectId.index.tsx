import { createFileRoute } from "@tanstack/react-router";

import { WorkspaceEmptyState } from "~/components/WorkspaceEmptyState";

/**
 * Index child of `/projects/$projectId` — shown when a project is selected
 * but no dataset has been picked yet. Dataset-specific UI lives in the
 * sibling `collections.$collectionId` route.
 */
export const Route = createFileRoute("/projects/$projectId/")({
  component: WorkspaceEmptyState,
});
