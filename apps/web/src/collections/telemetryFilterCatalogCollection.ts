import type { TelemetryFilterCatalogEntry } from "@lensflare/contracts";
import { createCollection } from "@tanstack/db";
import { createEntityCollectionOptions } from "./createEntityCollection";

function toTelemetryFilterCatalogError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error("Failed to sync telemetry filters.");
}

export function createTelemetryFilterCatalogCollection(projectId: string, datasetId: string) {
  const key = `${projectId}:${datasetId}`;
  const existing = collectionsByDataset.get(key);
  if (existing) {
    return existing;
  }

  const collection = createCollection(
    createEntityCollectionOptions<TelemetryFilterCatalogEntry, string>({
      getKey: (entry) => entry.id,
      list: (client) => client.ListTelemetryFilterCatalog({ projectId, datasetId }),
      subscribe: (client) => client.SubscribeTelemetryFilterCatalogEvents({ projectId, datasetId }),
      formatError: toTelemetryFilterCatalogError,
    }),
  );
  collectionsByDataset.set(key, collection);
  return collection;
}

const collectionsByDataset = new Map<string, any>();
