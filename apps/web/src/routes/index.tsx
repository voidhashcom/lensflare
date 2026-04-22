import { createFileRoute } from "@tanstack/react-router";

import { WorkspaceEmptyState } from "~/components/WorkspaceEmptyState";

export const Route = createFileRoute("/")({
  component: WorkspaceEmptyState,
});
