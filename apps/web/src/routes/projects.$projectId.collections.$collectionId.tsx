import type { Dataset } from "@lensflare/contracts";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";

import { datasetsCollection } from "~/collections/datasetsCollection";
import { LogStreamView } from "~/components/LogStream";

export const Route = createFileRoute("/projects/$projectId/collections/$collectionId")({
  component: DatasetLogStreamRoute,
});

/**
 * Dataset detail route. Looks up the selected dataset from the local
 * TanStack DB collection so we can show its name in the log stream header
 * without an extra fetch — if the collection hasn't hydrated yet we fall
 * back to "Dataset" rather than rendering nothing.
 */
function DatasetLogStreamRoute() {
  const { collectionId, projectId } = Route.useParams();
  const datasetQuery = useLiveQuery(selectDataset(collectionId));
  const dataset = (datasetQuery.data?.[0] as Dataset | undefined) ?? undefined;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <LogStreamView
        datasetId={collectionId}
        datasetName={dataset?.name ?? "Dataset"}
        projectId={projectId}
      />
    </div>
  );
}

function selectDataset(datasetId: string) {
  return (q: any) =>
    q
      .from({ dataset: datasetsCollection })
      .where(({ dataset }: any) => eq(dataset.id, datasetId));
}
