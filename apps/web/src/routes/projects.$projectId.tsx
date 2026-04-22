import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout route for a selected project. Renders the matching child route
 * (e.g. the dataset log stream or the project-level empty state) via
 * `<Outlet />`. Without this, any child route would be hidden behind the
 * parent's component.
 */
export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectLayout,
});

function ProjectLayout() {
  return <Outlet />;
}
