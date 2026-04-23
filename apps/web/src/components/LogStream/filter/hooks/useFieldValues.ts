import { useEffect, useState } from "react";

import { listDatasetLogFieldValues } from "~/data/logApi";

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
  const [state, setState] = useState<FieldValuesState>({
    values: [],
    isLoading: false,
    error: null,
  });

  // Stable cache-key for the path so the effect only re-runs when the field
  // actually changes, not on every render of the parent row.
  const pathKey = path === null ? null : path.join(".");

  useEffect(() => {
    if (pathKey === null || path === null) {
      setState({ values: [], isLoading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ values: [], isLoading: true, error: null });

    listDatasetLogFieldValues(projectId, datasetId, path)
      .then((values) => {
        if (cancelled) return;
        setState({ values, isLoading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          values: [],
          isLoading: false,
          error: error instanceof Error ? error : new Error("Failed to load values."),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, datasetId, pathKey, path]);

  return state;
}
