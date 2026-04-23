import { useEffect, useState } from "react";

import { listDatasetTelemetryFields, type TelemetryLogField } from "~/data/logApi";

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
  const [state, setState] = useState<FieldCatalogState>({
    fields: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    setState({ fields: [], isLoading: true, error: null });

    listDatasetTelemetryFields(projectId, datasetId)
      .then((fields) => {
        if (cancelled) return;
        setState({ fields, isLoading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          fields: [],
          isLoading: false,
          error: error instanceof Error ? error : new Error("Failed to load fields."),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, datasetId]);

  return state;
}
