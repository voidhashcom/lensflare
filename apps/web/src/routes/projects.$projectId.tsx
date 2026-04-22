import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pure layout route: the project itself isn't a destination — collections are.
// Renders <Outlet /> so the nested collection route can mount; visiting
// /projects/$projectId directly shows nothing (sidebar still picks the active
// collection, if any).
export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectLayout,
});

function ProjectLayout() {
  return <Outlet />;
}
