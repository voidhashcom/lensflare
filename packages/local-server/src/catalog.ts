import { SqliteClient } from "@effect/sql-sqlite-node";
import {
  DEFAULT_PROJECT_ICON,
  type Dataset,
  type CreateDatasetInput,
  type CreateProjectInput,
  DatasetNotFound,
  PROJECT_ICONS,
  type Project,
  ProjectNotFound,
  type ProjectIcon,
  type UpdateDatasetInput,
  type UpdateProjectInput,
  ValidationError,
} from "@lensflare/contracts";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlError } from "effect/unstable/sql";

const ProjectRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: Schema.Literals(PROJECT_ICONS),
  created_at: Schema.String,
  updated_at: Schema.String,
});

type ProjectRow = Schema.Schema.Type<typeof ProjectRowSchema>;

const DatasetRowSchema = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  name: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
});

type DatasetRow = Schema.Schema.Type<typeof DatasetRowSchema>;

const decodeProjectRow = Schema.decodeUnknownSync(ProjectRowSchema);
const decodeDatasetRow = Schema.decodeUnknownSync(DatasetRowSchema);

function normalizeRequiredName(field: "projectName" | "datasetName", value: string) {
  return Effect.sync(() => value.trim()).pipe(
    Effect.flatMap((name) =>
      name.length > 0
        ? Effect.succeed(name)
        : Effect.fail(
            new ValidationError({
              field,
              message: "Name must not be empty.",
            }),
          ),
    ),
  );
}

function normalizeOptionalName(
  field: "projectName" | "datasetName",
  value: string | undefined,
) {
  return value === undefined ? Effect.void : normalizeRequiredName(field, value);
}

function datasetFromRow(row: DatasetRow): Dataset {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function projectFromRow(row: ProjectRow, datasets: ReadonlyArray<Dataset>): Project {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    datasets,
  };
}

export class CatalogStore extends Context.Service<
  CatalogStore,
  {
    readonly createDataset: (
      projectId: string,
      input: CreateDatasetInput,
    ) => Effect.Effect<Dataset, ProjectNotFound | ValidationError | SqlError.SqlError>;
    readonly createProject: (
      input: CreateProjectInput,
    ) => Effect.Effect<Project, ValidationError | SqlError.SqlError>;
    readonly deleteDataset: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<void, DatasetNotFound | SqlError.SqlError>;
    readonly deleteProject: (
      projectId: string,
    ) => Effect.Effect<void, ProjectNotFound | SqlError.SqlError>;
    readonly getDataset: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<Dataset, DatasetNotFound | SqlError.SqlError>;
    readonly getProject: (
      projectId: string,
    ) => Effect.Effect<Project, ProjectNotFound | SqlError.SqlError>;
    readonly listProjects: () => Effect.Effect<ReadonlyArray<Project>, SqlError.SqlError>;
    readonly updateDataset: (
      projectId: string,
      datasetId: string,
      input: UpdateDatasetInput,
    ) => Effect.Effect<Dataset, DatasetNotFound | ValidationError | SqlError.SqlError>;
    readonly updateProject: (
      projectId: string,
      input: UpdateProjectInput,
    ) => Effect.Effect<Project, ProjectNotFound | ValidationError | SqlError.SqlError>;
  }
>()("@lensflare/local-server/CatalogStore") {
  static readonly layer = Layer.effect(
    CatalogStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`PRAGMA foreign_keys = ON`;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS datasets (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS datasets_project_id_idx
        ON datasets (project_id)
      `;

      const listProjectRows = Effect.fn("CatalogStore.listProjectRows")(function* () {
        const rows = yield* sql`
          SELECT id, name, icon, created_at, updated_at
          FROM projects
          ORDER BY updated_at DESC, name ASC
        `;
        return rows.map((row) => decodeProjectRow(row));
      });

      const listDatasetRows = Effect.fn("CatalogStore.listDatasetRows")(function* (
        projectId?: string,
      ) {
        const rows =
          projectId === undefined
            ? yield* sql`
                SELECT id, project_id, name, created_at, updated_at
                FROM datasets
                ORDER BY updated_at DESC, name ASC
              `
            : yield* sql`
                SELECT id, project_id, name, created_at, updated_at
                FROM datasets
                WHERE project_id = ${projectId}
                ORDER BY updated_at DESC, name ASC
              `;

        return rows.map((row) => decodeDatasetRow(row));
      });

      const findProjectRow = Effect.fn("CatalogStore.findProjectRow")(function* (projectId: string) {
        const rows = yield* sql`
          SELECT id, name, icon, created_at, updated_at
          FROM projects
          WHERE id = ${projectId}
          LIMIT 1
        `;

        return rows[0] === undefined ? undefined : decodeProjectRow(rows[0]);
      });

      const findDatasetRow = Effect.fn("CatalogStore.findDatasetRow")(function* (
        projectId: string,
        datasetId: string,
      ) {
        const rows = yield* sql`
          SELECT id, project_id, name, created_at, updated_at
          FROM datasets
          WHERE project_id = ${projectId}
            AND id = ${datasetId}
          LIMIT 1
        `;

        return rows[0] === undefined ? undefined : decodeDatasetRow(rows[0]);
      });

      const getProject = Effect.fn("CatalogStore.getProject")(function* (projectId: string) {
        const projectRow = yield* findProjectRow(projectId);
        if (projectRow === undefined) {
          return yield* new ProjectNotFound({ projectId });
        }

        const datasetRows = yield* listDatasetRows(projectId);
        return projectFromRow(
          projectRow,
          datasetRows.map((row) => datasetFromRow(row)),
        );
      });

      const listProjects = Effect.fn("CatalogStore.listProjects")(function* () {
        const [projectRows, datasetRows] = yield* Effect.all([
          listProjectRows(),
          listDatasetRows(),
        ]);

        const datasetsByProjectId = new Map<string, Array<Dataset>>();
        for (const row of datasetRows) {
          const datasets = datasetsByProjectId.get(row.project_id) ?? [];
          datasets.push(datasetFromRow(row));
          datasetsByProjectId.set(row.project_id, datasets);
        }

        return projectRows.map((row) =>
          projectFromRow(row, datasetsByProjectId.get(row.id) ?? []),
        );
      });

      const createProject = Effect.fn("CatalogStore.createProject")(function* (
        input: CreateProjectInput,
      ) {
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const name = yield* normalizeRequiredName("projectName", input.name);
        const icon: ProjectIcon = input.icon ?? DEFAULT_PROJECT_ICON;

        yield* sql`
          INSERT INTO projects ${sql.insert({
            id,
            name,
            icon,
            created_at: now,
            updated_at: now,
          })}
        `;

        return {
          id,
          name,
          icon,
          createdAt: now,
          updatedAt: now,
          datasets: [],
        };
      });

      const updateProject = Effect.fn("CatalogStore.updateProject")(function* (
        projectId: string,
        input: UpdateProjectInput,
      ) {
        const current = yield* getProject(projectId);
        const name = yield* normalizeOptionalName("projectName", input.name);
        const nextName = name ?? current.name;
        const nextIcon = input.icon ?? current.icon;
        const now = new Date().toISOString();

        yield* sql`
          UPDATE projects
          SET name = ${nextName},
              icon = ${nextIcon},
              updated_at = ${now}
          WHERE id = ${projectId}
        `;

        return yield* getProject(projectId);
      });

      const deleteProject = Effect.fn("CatalogStore.deleteProject")(function* (projectId: string) {
        if ((yield* findProjectRow(projectId)) === undefined) {
          return yield* new ProjectNotFound({ projectId });
        }

        yield* sql`
          DELETE FROM projects
          WHERE id = ${projectId}
        `;
      });

      const getDataset = Effect.fn("CatalogStore.getDataset")(function* (
        projectId: string,
        datasetId: string,
      ) {
        const datasetRow = yield* findDatasetRow(projectId, datasetId);
        if (datasetRow === undefined) {
          return yield* new DatasetNotFound({ datasetId, projectId });
        }

        return datasetFromRow(datasetRow);
      });

      const createDataset = Effect.fn("CatalogStore.createDataset")(function* (
        projectId: string,
        input: CreateDatasetInput,
      ) {
        if ((yield* findProjectRow(projectId)) === undefined) {
          return yield* new ProjectNotFound({ projectId });
        }

        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const name = yield* normalizeRequiredName("datasetName", input.name);

        yield* sql`
          INSERT INTO datasets ${sql.insert({
            id,
            project_id: projectId,
            name,
            created_at: now,
            updated_at: now,
          })}
        `;

        return {
          id,
          projectId,
          name,
          createdAt: now,
          updatedAt: now,
        };
      });

      const updateDataset = Effect.fn("CatalogStore.updateDataset")(function* (
        projectId: string,
        datasetId: string,
        input: UpdateDatasetInput,
      ) {
        const current = yield* getDataset(projectId, datasetId);
        const name = yield* normalizeOptionalName("datasetName", input.name);
        const nextName = name ?? current.name;
        const now = new Date().toISOString();

        yield* sql`
          UPDATE datasets
          SET name = ${nextName},
              updated_at = ${now}
          WHERE id = ${datasetId}
            AND project_id = ${projectId}
        `;

        return yield* getDataset(projectId, datasetId);
      });

      const deleteDataset = Effect.fn("CatalogStore.deleteDataset")(function* (
        projectId: string,
        datasetId: string,
      ) {
        if ((yield* findDatasetRow(projectId, datasetId)) === undefined) {
          return yield* new DatasetNotFound({ datasetId, projectId });
        }

        yield* sql`
          DELETE FROM datasets
          WHERE id = ${datasetId}
            AND project_id = ${projectId}
        `;
      });

      return {
        createDataset,
        createProject,
        deleteDataset,
        deleteProject,
        getDataset,
        getProject,
        listProjects,
        updateDataset,
        updateProject,
      };
    }),
  );
}

export function makeCatalogStoreLayer(databaseFile: string) {
  const sqliteLayer = SqliteClient.layer({
    filename: databaseFile,
  });

  return CatalogStore.layer.pipe(Layer.provide(sqliteLayer));
}

export {
  DatasetNotFound,
  ProjectNotFound,
  ValidationError,
};
