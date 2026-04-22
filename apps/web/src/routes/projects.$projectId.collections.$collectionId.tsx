import { createFileRoute, notFound } from "@tanstack/react-router";

import { mockProjects } from "~/data/mockProjects";

export const Route = createFileRoute("/projects/$projectId/collections/$collectionId")({
  component: CollectionView,
  loader: ({ params }) => {
    const project = mockProjects.find((candidate) => candidate.id === params.projectId);
    const collection = project?.collections.find(
      (candidate) => candidate.id === params.collectionId,
    );
    if (!project || !collection) {
      throw notFound();
    }
    return { collection, project };
  },
});

function CollectionView() {
  const { collection, project } = Route.useLoaderData();
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {project.name} · Collection
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{collection.name}</h1>
      </header>
      <div className="flex-1 rounded-lg border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
        Telemetry viewer for this collection will live here.
      </div>
    </div>
  );
}
