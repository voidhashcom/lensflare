import type { Dataset } from "@lensflare/contracts";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { datasetsCollection } from "~/collections/datasetsCollection";
import { WorkspaceEmptyState } from "~/components/WorkspaceEmptyState";

export const Route = createFileRoute("/projects/$projectId/")({
  component: ProjectIndexRoute,
});

/**
 * Selecting a project now routes straight into its managed dataset. The
 * dataset record stays separate under the hood, so we resolve it from the
 * catalog collection and redirect once it has hydrated.
 */
function ProjectIndexRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const datasetQuery = useLiveQuery(selectProjectDatasets(projectId));
  const dataset = (datasetQuery.data?.[0] as Dataset | undefined) ?? undefined;

  useEffect(() => {
    if (!dataset) {
      return;
    }

    void navigate({
      params: {
        collectionId: dataset.id,
        projectId,
      },
      replace: true,
      to: "/projects/$projectId/collections/$collectionId",
    });
  }, [dataset, navigate, projectId]);

  if (datasetQuery.isLoading) {
    return <WorkspaceEmptyState />;
  }

  return <WorkspaceEmptyState />;
}

function selectProjectDatasets(projectId: string) {
  return (q: any) =>
    q
      .from({ dataset: datasetsCollection })
      .where(({ dataset }: any) => eq(dataset.projectId, projectId))
      .orderBy(({ dataset }: any) => dataset.updatedAt, "desc")
      .orderBy(({ dataset }: any) => dataset.name)
      .select(({ dataset }: any) => ({
        createdAt: dataset.createdAt,
        id: dataset.id,
        name: dataset.name,
        projectId: dataset.projectId,
        slug: dataset.slug,
        updatedAt: dataset.updatedAt,
      }));
}
