import {
  type CreateDatasetInput,
  type Dataset,
  type DatasetChangeEvent,
  type DatasetStorageStats,
  DatasetNotFound,
  ProjectNotFound,
  type UpdateDatasetInput,
  ValidationError,
} from "@lensflare/contracts";
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import { SqlError } from "effect/unstable/sql";
import {
  getDatasetLocalSlug,
  makeDatasetTag,
  makeUniqueSlug,
  slugify,
} from "../domain/slug.ts";
import { DuckDbError, TelemetryStore } from "../ingest/telemetryStore.ts";
import {
  type DatasetRow,
  datasetFromRow,
  DatasetsRepository,
} from "../repositories/datasetsRepository.ts";
import { ProjectsRepository } from "../repositories/projectsRepository.ts";
import {
  normalizeOptionalName,
  normalizeOptionalSlug,
  normalizeRequiredName,
} from "./validation.ts";

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
    ) => Effect.Effect<void, DatasetNotFound | SqlError.SqlError | DuckDbError>;
    readonly listDatasetStorageStats: () => Effect.Effect<
      ReadonlyArray<DatasetStorageStats>,
      SqlError.SqlError | DuckDbError
    >;
    readonly clearDatasetData: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<void, DatasetNotFound | SqlError.SqlError | DuckDbError>;
    readonly rebaseProjectDatasetTags: (
      projectId: string,
      oldProjectSlug: string,
      newProjectSlug: string,
      updatedAt: string,
    ) => Effect.Effect<ReadonlyArray<Dataset>, SqlError.SqlError>;
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

      const getDataset = Effect.fn("DatasetService.getDataset")(function* (
        projectId: string,
        datasetId: string,
      ) {
        const row = yield* requireDatasetRow(projectId, datasetId);
        return datasetFromRow(row);
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

      const resolveDatasetSlug = Effect.fn("DatasetService.resolveDatasetSlug")(function* (
        projectSlug: string,
        name: string,
        explicitSlug: string | undefined,
        currentDatasetId?: string,
      ) {
        const normalizedExplicit = yield* normalizeOptionalSlug("datasetSlug", explicitSlug);
        if (normalizedExplicit !== undefined) {
          return yield* ensureDatasetSlug(
            makeDatasetTag(projectSlug, normalizedExplicit),
            currentDatasetId,
          );
        }

        const existing = yield* datasets.findAll();
        const usedSlugs = new Set(
          existing.filter((row) => row.id !== currentDatasetId).map((row) => row.slug),
        );
        return makeUniqueSlug(makeDatasetTag(projectSlug, slugify(name)), usedSlugs);
      });

      const createDataset = Effect.fn("DatasetService.createDataset")(function* (
        projectId: string,
        input: CreateDatasetInput,
      ) {
        // Validate the parent exists ourselves rather than relying on the
        // SQL FK error so we can return a typed `ProjectNotFound`.
        const project = yield* requireProjectRow(projectId);

        const name = yield* normalizeRequiredName("datasetName", input.name);
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const slug = yield* resolveDatasetSlug(project.slug, name, input.slug);

        yield* datasets.insert({
          id,
          projectId,
          name,
          slug,
          createdAt: now,
          updatedAt: now,
        });

        const dataset: Dataset = {
          id,
          projectId,
          name,
          slug,
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
        const nextSlug =
          input.slug === undefined
            ? current.slug
            : yield* Effect.gen(function* () {
                const project = yield* projects.findById(projectId);
                if (project === undefined) {
                  return yield* new DatasetNotFound({ datasetId, projectId });
                }
                return yield* resolveDatasetSlug(project.slug, nextName, input.slug, datasetId);
              });
        const now = new Date().toISOString();

        yield* datasets.update(projectId, datasetId, {
          name: nextName,
          slug: nextSlug,
          updatedAt: now,
        });

        const dataset = datasetFromRow({
          ...current,
          name: nextName,
          slug: nextSlug,
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
        yield* telemetry.clearDataset(datasetId);

        yield* publish({
          action: "delete",
          id: datasetId,
        });
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

      const rebaseProjectDatasetTags = Effect.fn("DatasetService.rebaseProjectDatasetTags")(
        function* (
          projectId: string,
          oldProjectSlug: string,
          newProjectSlug: string,
          updatedAt: string,
        ) {
          const projectDatasetRows = yield* datasets.findAll(projectId);
          if (oldProjectSlug === newProjectSlug) {
            return projectDatasetRows.map((row) => datasetFromRow(row));
          }

          const allRows = yield* datasets.findAll();
          const usedSlugs = new Set(
            allRows.filter((row) => row.project_id !== projectId).map((row) => row.slug),
          );
          const updatedRows: Array<DatasetRow> = [];

          for (const row of projectDatasetRows) {
            const localSlug = getDatasetLocalSlug(oldProjectSlug, row.slug);
            const slug = makeUniqueSlug(makeDatasetTag(newProjectSlug, localSlug), usedSlugs);
            usedSlugs.add(slug);

            yield* datasets.update(projectId, row.id, {
              name: row.name,
              slug,
              updatedAt,
            });

            const updatedRow = {
              ...row,
              slug,
              updated_at: updatedAt,
            };
            updatedRows.push(updatedRow);

            yield* publish({
              action: "upsert",
              value: datasetFromRow(updatedRow),
            });
          }

          return updatedRows.map((row) => datasetFromRow(row));
        },
      );

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
        createDataset,
        updateDataset,
        deleteDataset,
        listDatasetStorageStats,
        clearDatasetData,
        rebaseProjectDatasetTags,
        notifyCascadeDeletedDatasets,
        stream,
      });
    }),
  );
}
