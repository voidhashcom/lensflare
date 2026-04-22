import { formatDatasetError, type Dataset } from "@lensflare/contracts";
import { createCollection } from "@tanstack/db";
import { createEntityCollectionOptions } from "./createEntityCollection";

/**
 * TanStack DB collection backed by the dataset RPC snapshot +
 * {@link SubscribeDatasetEvents} stream. Mutations are NOT routed through
 * this collection — they live in `~/data/datasetApi` — so this file
 * intentionally only exposes the collection instance and the error
 * formatter it needs for its sync helper.
 */
function toDatasetError(error: unknown): Error {
  return new Error(formatDatasetError(error));
}

export const datasetsCollection = createCollection(
  createEntityCollectionOptions<Dataset, string>({
    getKey: (dataset) => dataset.id,
    list: (client) => client.ListDatasets(),
    subscribe: (client) => client.SubscribeDatasetEvents(),
    formatError: toDatasetError,
  }),
);
