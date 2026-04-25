import type { FilterNode } from "@lensflare/contracts";

import { setDatasetStreamFilter, type DatasetStreamSnapshot } from "../logStreamStore";
import { FilterQueryInput } from "./FilterQueryInput";
import { useFieldCatalog } from "./hooks/useFieldCatalog";

interface QueryBuilderProps {
  projectId: string;
  datasetId: string;
  viewId: DatasetStreamSnapshot["viewId"];
  appliedSource: string;
}

/**
 * Thin wrapper that owns the field catalog fetch and forwards
 * `onFilterChange` to the {@link FilterQueryInput}. Keeping this
 * indirection lets the outer header import a single component with a
 * stable prop shape regardless of how the underlying editor evolves.
 *
 * The input owns its own `source` string; there is no
 * `initialFilter`/`fromFilterNode` path yet — parent state is driven
 * entirely by the emitted `onFilterChange` events. If round-tripping a
 * committed `FilterNode` back into the editor becomes a requirement,
 * add a `filterNodeToSource` helper in `syntax.ts` and a controlled
 * `source` prop here.
 */
export function QueryBuilder({ projectId, datasetId, viewId, appliedSource }: QueryBuilderProps) {
  const { fields } = useFieldCatalog(projectId, datasetId);

  return (
    <FilterQueryInput
      appliedSource={appliedSource}
      datasetId={datasetId}
      fields={fields}
      onAppliedSourceChange={(source: string, filter: FilterNode | null) => {
        setDatasetStreamFilter({ projectId, datasetId, viewId, source, filter });
      }}
      projectId={projectId}
    />
  );
}
