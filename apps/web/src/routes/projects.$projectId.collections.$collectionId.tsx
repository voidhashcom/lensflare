import type { Dataset, ProjectEntity } from "@lensflare/contracts";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";

import { datasetsCollection } from "~/collections/datasetsCollection";
import { projectsCollection } from "~/collections/projectsCollection";
import { LogStreamView } from "~/components/LogStream";

export const Route = createFileRoute("/projects/$projectId/collections/$collectionId")({
  component: DatasetLogStreamRoute,
});

/**
 * Dataset detail route. Looks up the selected dataset (and its owning
 * project) from the local TanStack DB collections so we can show the
 * dataset name and forward both slugs into the empty-dataset integration
 * guide without an extra fetch. If either collection hasn't hydrated yet
 * we fall through with `undefined` slugs — `LogStreamView` treats those
 * as "not ready" and leaves the snippets with placeholders rather than
 * rendering a half-resolved URL.
 */
function DatasetLogStreamRoute() {
  const { collectionId, projectId } = Route.useParams();
  const datasetQuery = useLiveQuery(selectDataset(collectionId));
  const projectQuery = useLiveQuery(selectProject(projectId));
  const dataset = (datasetQuery.data?.[0] as Dataset | undefined) ?? undefined;
  const project = (projectQuery.data?.[0] as ProjectEntity | undefined) ?? undefined;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <LogStreamView
        datasetId={collectionId}
        datasetName={dataset?.name ?? "Dataset"}
        datasetSlug={dataset?.slug}
        projectId={projectId}
        projectSlug={project?.slug}
      />
    </div>
  );
}

function selectDataset(datasetId: string) {
  return (q: any) =>
    q.from({ dataset: datasetsCollection }).where(({ dataset }: any) => eq(dataset.id, datasetId));
}

function selectProject(projectId: string) {
  return (q: any) =>
    q.from({ project: projectsCollection }).where(({ project }: any) => eq(project.id, projectId));
}
