import {
  type Dataset,
  type DatasetChangeEvent,
  type DatasetStorageStats,
  DatasetNotFound,
  ProjectNotFound,
  ValidationError,
} from "@lensflare/contracts";
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import { SqlError } from "effect/unstable/sql";
import { DuckDbError, TelemetryStore } from "../ingest/telemetryStore.ts";
import { datasetFromRow, DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { ProjectsRepository } from "../repositories/projectsRepository.ts";

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
    readonly ensureProjectDataset: (
      projectId: string,
      datasetName: string,
      datasetSlug: string,
      updatedAt?: string,
    ) => Effect.Effect<Dataset, ProjectNotFound | ValidationError | SqlError.SqlError>;
    readonly syncProjectDataset: (
      projectId: string,
      datasetName: string,
      datasetSlug: string,
      updatedAt: string,
    ) => Effect.Effect<ReadonlyArray<Dataset>, ProjectNotFound | ValidationError | SqlError.SqlError>;
    readonly listDatasetStorageStats: () => Effect.Effect<
      ReadonlyArray<DatasetStorageStats>,
      SqlError.SqlError | DuckDbError
    >;
    readonly clearDatasetData: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<void, DatasetNotFound | SqlError.SqlError | DuckDbError>;
    readonly notifyCascadeDeletedDatasets: (
      datasetIds: ReadonlyArray<string>,
    ) => Effect.Effect<void, DuckDbError>;
    readonly stream: Stream.Stream<DatasetChangeEvent>;
  }
>()("@lensflare/local-server/DatasetService") {
  static readonly layer = Layer.effect(
    DatasetService,
    Effect.gen(function* () {
      const projects = yield* ProjectsRepository;
      const datasets = yield* DatasetsRepository;
      const telemetry = yield* TelemetryStore;
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

      const ensureDatasetSlug = Effect.fn("DatasetService.ensureDatasetSlug")(function* (
        slug: string,
        currentDatasetId?: string,
      ) {
        const existing = yield* datasets.findBySlug(slug);
        if (existing !== undefined && existing.id !== currentDatasetId) {
          return yield* new ValidationError({
            field: "datasetSlug",
            message: "Slug is already in use.",
          });
        }

        return slug;
      });

      const getDataset = Effect.fn("DatasetService.getDataset")(function* (
        projectId: string,
        datasetId: string,
      ) {
        const row = yield* requireDatasetRow(projectId, datasetId);
        return datasetFromRow(row);
      });

      const insertProjectDataset = Effect.fn("DatasetService.insertProjectDataset")(function* (
        projectId: string,
        datasetName: string,
        datasetSlug: string,
        createdAt: string,
      ) {
        const id = crypto.randomUUID();
        const slug = yield* ensureDatasetSlug(datasetSlug);

        yield* datasets.insert({
          id,
          projectId,
          name: datasetName,
          slug,
          createdAt,
          updatedAt: createdAt,
        });

        const dataset: Dataset = {
          id,
          projectId,
          name: datasetName,
          slug,
          createdAt,
          updatedAt: createdAt,
        };

        yield* publish({
          action: "upsert",
          value: dataset,
        });

        return dataset;
      });

      const ensureProjectDataset = Effect.fn("DatasetService.ensureProjectDataset")(function* (
        projectId: string,
        datasetName: string,
        datasetSlug: string,
        updatedAt = new Date().toISOString(),
      ) {
        yield* requireProjectRow(projectId);
        const managedDataset = (yield* datasets.findAll(projectId))[0];
        if (managedDataset === undefined) {
          return yield* insertProjectDataset(projectId, datasetName, datasetSlug, updatedAt);
        }

        const slug = yield* ensureDatasetSlug(datasetSlug, managedDataset.id);
        if (managedDataset.name === datasetName && managedDataset.slug === slug) {
          return datasetFromRow(managedDataset);
        }

        yield* datasets.update(projectId, managedDataset.id, {
          name: datasetName,
          slug,
          updatedAt,
        });

        const dataset = datasetFromRow({
          ...managedDataset,
          name: datasetName,
          slug,
          updated_at: updatedAt,
        });

        yield* publish({
          action: "upsert",
          value: dataset,
        });

        return dataset;
      });

      const syncProjectDataset = Effect.fn("DatasetService.syncProjectDataset")(function* (
        projectId: string,
        datasetName: string,
        datasetSlug: string,
        updatedAt: string,
      ) {
        yield* ensureProjectDataset(projectId, datasetName, datasetSlug, updatedAt);
        const rows = yield* datasets.findAll(projectId);
        return rows.map((row) => datasetFromRow(row));
      });

      const listDatasetStorageStats = Effect.fn(
        "DatasetService.listDatasetStorageStats",
      )(function* () {
        const rows = yield* datasets.findAll();
        return yield* Effect.forEach(rows, (row) => telemetry.getStorageStats(row.id), {
          concurrency: 8,
        });
      });

      const clearDatasetData = Effect.fn("DatasetService.clearDatasetData")(function* (
        projectId: string,
        datasetId: string,
      ) {
        yield* requireDatasetRow(projectId, datasetId);
        yield* telemetry.clearDataset(datasetId);
      });

      const notifyCascadeDeletedDatasets = Effect.fn("DatasetService.notifyCascadeDeletedDatasets")(
        function* (datasetIds: ReadonlyArray<string>) {
          yield* Effect.forEach(datasetIds, (id) => telemetry.clearDataset(id), {
            concurrency: 8,
            discard: true,
          });
          yield* Effect.forEach(datasetIds, (id) => publish({ action: "delete", id }), {
            discard: true,
          });
        },
      );

      return DatasetService.of({
        listDatasets,
        getDataset,
        ensureProjectDataset,
        syncProjectDataset,
        listDatasetStorageStats,
        clearDatasetData,
        notifyCascadeDeletedDatasets,
        stream,
      });
    }),
  );
}
