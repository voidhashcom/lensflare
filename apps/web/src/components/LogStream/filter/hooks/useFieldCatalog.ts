import type { TelemetryFilterCatalogEntry } from "@lensflare/contracts";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";

import { createTelemetryFilterCatalogCollection } from "~/collections/telemetryFilterCatalogCollection";
import type { TelemetryLogField } from "~/data/logApi";

interface FieldCatalogState {
  readonly fields: ReadonlyArray<TelemetryLogField>;
  readonly isLoading: boolean;
  readonly error: Error | null;
}

/**
 * Fetches the set of filterable fields for the given dataset. Combines the
 * static top-level fields (level, serviceName, …) with the attribute keys
 * harvested from ingested log records so the `FilterRow` field combobox can
 * offer a single flat list to the user.
 *
 * The backend returns a stable shape, so we intentionally avoid TanStack Query
 * here: the catalog is cheap to refetch whenever the dataset changes and its
 * lifecycle is tied 1:1 to the log viewer mount.
 */
export function useFieldCatalog(
  projectId: string,
  datasetId: string,
): FieldCatalogState {
  const collection = useMemo(
    () => createTelemetryFilterCatalogCollection(projectId, datasetId),
    [projectId, datasetId],
  );
  const query = useLiveQuery((q) =>
    q
      .from({ field: collection as any })
      .orderBy(({ field }: any) => field.label)
      .select(({ field }: any) => field),
  );
  const fields = ((query.data ?? []) as unknown as ReadonlyArray<TelemetryFilterCatalogEntry>).map(
    (entry): TelemetryLogField => ({
      path: entry.path,
      label: entry.label,
      kind: entry.kind,
      frequency: entry.frequency,
      ...(entry.highCardinality ? {} : { values: entry.values }),
    }),
  );

  return {
    fields,
    isLoading: query.isLoading,
    error:
      collection.utils.lastError instanceof Error
        ? collection.utils.lastError
        : null,
  };
}
