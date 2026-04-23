import { DatasetRpcGroup } from "@lensflare/contracts";
import { Effect } from "effect";
import { DatasetService } from "../services/datasetService.ts";

/**
 * RPC handlers for the dataset group.
 *
 * Each handler is a thin pass-through to {@link DatasetService}, with one
 * cross-cutting concern: turning {@link SqlError} into a defect via
 * {@link Effect.die}. The contract schemas only declare typed errors
 * (`ProjectNotFound`, `DatasetNotFound`, `ValidationError`), so SQL/IO
 * failures must NOT escape onto the wire — letting them die surfaces them
 * as a 500-style fault on the client and keeps the success/error union
 * exact.
 *
 * The event subscription handler is wired to read directly from
 * {@link DatasetService.stream}.
 */
export const datasetRpcLayer = DatasetRpcGroup.toLayer(
  Effect.gen(function* () {
    const service = yield* DatasetService;

    return DatasetRpcGroup.of({
      ListDatasets: () => service.listDatasets().pipe(Effect.catchTag("SqlError", Effect.die)),
      GetDataset: ({ projectId, datasetId }) =>
        service.getDataset(projectId, datasetId).pipe(Effect.catchTag("SqlError", Effect.die)),
      CreateDataset: ({ projectId, input }) =>
        service.createDataset(projectId, input).pipe(Effect.catchTag("SqlError", Effect.die)),
      UpdateDataset: ({ projectId, datasetId, input }) =>
        service
          .updateDataset(projectId, datasetId, input)
          .pipe(Effect.catchTag("SqlError", Effect.die)),
      DeleteDataset: ({ projectId, datasetId }) =>
        service
          .deleteDataset(projectId, datasetId)
          .pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("DuckDbError", Effect.die)),
      ListDatasetStorageStats: () =>
        service
          .listDatasetStorageStats()
          .pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("DuckDbError", Effect.die)),
      ClearDatasetData: ({ projectId, datasetId }) =>
        service
          .clearDatasetData(projectId, datasetId)
          .pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("DuckDbError", Effect.die)),
      SubscribeDatasetEvents: () => service.stream,
    });
  }),
);
