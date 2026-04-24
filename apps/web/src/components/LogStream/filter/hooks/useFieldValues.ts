import type { TelemetryFilterCatalogEntry } from "@lensflare/contracts";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";

import { createTelemetryFilterCatalogCollection } from "~/collections/telemetryFilterCatalogCollection";

interface FieldValuesState {
  readonly values: ReadonlyArray<string>;
  readonly isLoading: boolean;
  readonly error: Error | null;
}

/**
 * Fetches the top-N distinct values observed for a specific field path in a
 * dataset — used to power value-side autocomplete on a `FilterRow`.
 *
 * Passing `null` as the path disables the effect: the combobox for the value
 * is only useful once the user has picked a field, so we avoid making the
 * initial request before then.
 */
export function useFieldValues(
  projectId: string,
  datasetId: string,
  path: ReadonlyArray<string> | null,
): FieldValuesState {
  const pathKey = path === null ? null : path.join(".");
  const collection = useMemo(
    () => createTelemetryFilterCatalogCollection(projectId, datasetId),
    [projectId, datasetId],
  );
  const query = useLiveQuery((q) =>
    q
      .from({ field: collection as any })
      .where(({ field }: any) => eq(field.label, pathKey ?? ""))
      .select(({ field }: any) => field),
  );
  const field = ((query.data ?? []) as unknown as ReadonlyArray<TelemetryFilterCatalogEntry>)[0];

  if (pathKey === null) {
    return { values: [], isLoading: false, error: null };
  }

  return {
    values: field && !field.highCardinality ? field.values : [],
    isLoading: query.isLoading,
    error:
      collection.utils.lastError instanceof Error
        ? collection.utils.lastError
        : null,
  };
}
