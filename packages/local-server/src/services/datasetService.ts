import {
  type CreateDatasetInput,
  type Dataset,
  type DatasetChangeEvent,
  DatasetNotFound,
  ProjectNotFound,
  type UpdateDatasetInput,
  type ValidationError,
} from "@lensflare/contracts";
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import { SqlError } from "effect/unstable/sql";
import { datasetFromRow, DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { ProjectsRepository } from "../repositories/projectsRepository.ts";
import { normalizeOptionalName, normalizeRequiredName } from "./validation.ts";

/**
 * Domain-level façade over the datasets repository.
 *
 * Responsibilities that belong here (and intentionally NOT in the
 * repository):
 *   - input validation ({@link ValidationError}) and not-found checks
 *     ({@link DatasetNotFound} / {@link ProjectNotFound})
 *   - generating identifiers and timestamps for new rows
 *   - owning the dataset change stream consumed by RPC subscribers,
 *     while keeping event publication private to the service
 *
 * `SqlError` is left in the error channel: the RPC layer is the single
 * place that decides how to surface infrastructure failures to clients.
 *
 * {@link notifyCascadeDeletedDatasets} is a service-internal hook used by
 * {@link ProjectService} when a project delete cascades the child rows
 * through the SQL FK — the dataset SQL rows are already gone at that
 * point, we only need to fan out the corresponding dataset change events.
 * Keeping this here preserves the invariant that dataset change events
 * are only ever published from the dataset service.
 */
export class DatasetService extends Context.Service<
  DatasetService,
  {
    readonly listDatasets: (
      projectId?: string,
    ) => Effect.Effect<ReadonlyArray<Dataset>, SqlError.SqlError>;
    readonly getDataset: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<Dataset, DatasetNotFound | SqlError.SqlError>;
    readonly createDataset: (
      projectId: string,
      input: CreateDatasetInput,
    ) => Effect.Effect<Dataset, ProjectNotFound | ValidationError | SqlError.SqlError>;
    readonly updateDataset: (
      projectId: string,
      datasetId: string,
      input: UpdateDatasetInput,
    ) => Effect.Effect<Dataset, DatasetNotFound | ValidationError | SqlError.SqlError>;
    readonly deleteDataset: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<void, DatasetNotFound | SqlError.SqlError>;
    readonly notifyCascadeDeletedDatasets: (
      datasetIds: ReadonlyArray<string>,
    ) => Effect.Effect<void>;
    readonly stream: Stream.Stream<DatasetChangeEvent>;
  }
>()("@lensflare/local-server/DatasetService") {
  static readonly layer = Layer.effect(
    DatasetService,
    Effect.gen(function* () {
      const projects = yield* ProjectsRepository;
      const datasets = yield* DatasetsRepository;
      const pubsub = yield* PubSub.unbounded<DatasetChangeEvent>();
      const stream = Stream.fromPubSub(pubsub);

      const publish = Effect.fn("DatasetService.publish")(function* (event: DatasetChangeEvent) {
        yield* PubSub.publish(pubsub, event);
      });

      const requireProjectRow = Effect.fn("DatasetService.requireProjectRow")(function* (
        projectId: string,
      ) {
        const row = yield* projects.findById(projectId);
        if (row === undefined) {
          return yield* new ProjectNotFound({ projectId });
        }
        return row;
      });

      const requireDatasetRow = Effect.fn("DatasetService.requireDatasetRow")(function* (
        projectId: string,
        datasetId: string,
      ) {
        const row = yield* datasets.findById(projectId, datasetId);
        if (row === undefined) {
          return yield* new DatasetNotFound({ datasetId, projectId });
        }
        return row;
      });

      const listDatasets = Effect.fn("DatasetService.listDatasets")(function* (projectId?: string) {
        const rows = yield* datasets.findAll(projectId);
        return rows.map((row) => datasetFromRow(row));
      });

      const getDataset = Effect.fn("DatasetService.getDataset")(function* (
        projectId: string,
        datasetId: string,
      ) {
        const row = yield* requireDatasetRow(projectId, datasetId);
        return datasetFromRow(row);
      });

      const createDataset = Effect.fn("DatasetService.createDataset")(function* (
        projectId: string,
        input: CreateDatasetInput,
      ) {
        // Validate the parent exists ourselves rather than relying on the
        // SQL FK error so we can return a typed `ProjectNotFound`.
        yield* requireProjectRow(projectId);

        const name = yield* normalizeRequiredName("datasetName", input.name);
        const now = new Date().toISOString();
        const id = crypto.randomUUID();

        yield* datasets.insert({
          id,
          projectId,
          name,
          createdAt: now,
          updatedAt: now,
        });

        const dataset: Dataset = {
          id,
          projectId,
          name,
          createdAt: now,
          updatedAt: now,
        };

        yield* publish({
          action: "upsert",
          value: dataset,
        });

        return dataset;
      });

      const updateDataset = Effect.fn("DatasetService.updateDataset")(function* (
        projectId: string,
        datasetId: string,
        input: UpdateDatasetInput,
      ) {
        const current = yield* requireDatasetRow(projectId, datasetId);
        const trimmed = yield* normalizeOptionalName("datasetName", input.name);
        const nextName = trimmed ?? current.name;
        const now = new Date().toISOString();

        yield* datasets.update(projectId, datasetId, {
          name: nextName,
          updatedAt: now,
        });

        const dataset = datasetFromRow({
          ...current,
          name: nextName,
          updated_at: now,
        });

        yield* publish({
          action: "upsert",
          value: dataset,
        });

        return dataset;
      });

      const deleteDataset = Effect.fn("DatasetService.deleteDataset")(function* (
        projectId: string,
        datasetId: string,
      ) {
        yield* requireDatasetRow(projectId, datasetId);

        yield* datasets.remove(projectId, datasetId);

        yield* publish({
          action: "delete",
          id: datasetId,
        });
      });

      const notifyCascadeDeletedDatasets = Effect.fn("DatasetService.notifyCascadeDeletedDatasets")(
        function* (datasetIds: ReadonlyArray<string>) {
          yield* Effect.forEach(datasetIds, (id) => publish({ action: "delete", id }), {
            discard: true,
          });
        },
      );

      return DatasetService.of({
        listDatasets,
        getDataset,
        createDataset,
        updateDataset,
        deleteDataset,
        notifyCascadeDeletedDatasets,
        stream,
      });
    }),
  );
}
