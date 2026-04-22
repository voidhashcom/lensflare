import type { Dataset } from "@lensflare/contracts";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlError } from "effect/unstable/sql";

const DatasetRowSchema = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  name: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
});

export type DatasetRow = Schema.Schema.Type<typeof DatasetRowSchema>;

const decodeDatasetRow = Schema.decodeUnknownSync(DatasetRowSchema);

/**
 * Map a SQL row (snake_case columns) into the API-facing {@link Dataset}
 * (camelCase). Encapsulating this here keeps the wire shape decoupled from
 * the storage shape.
 */
export function datasetFromRow(row: DatasetRow): Dataset {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface InsertDatasetInput {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateDatasetFields {
  readonly name: string;
  readonly updatedAt: string;
}

/**
 * Pure data-access layer for the `datasets` table.
 *
 * Listing accepts an optional `projectId` filter so callers can fetch all
 * datasets at once (used to assemble project aggregates) or just the rows
 * for a single project. Validation, IDs, and timestamps are produced by
 * the dataset service; this repository only translates between domain
 * inputs and SQL.
 */
export class DatasetsRepository extends Context.Service<
  DatasetsRepository,
  {
    readonly findAll: (
      projectId?: string,
    ) => Effect.Effect<ReadonlyArray<DatasetRow>, SqlError.SqlError>;
    readonly findById: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<DatasetRow | undefined, SqlError.SqlError>;
    readonly insert: (input: InsertDatasetInput) => Effect.Effect<void, SqlError.SqlError>;
    readonly update: (
      projectId: string,
      datasetId: string,
      fields: UpdateDatasetFields,
    ) => Effect.Effect<void, SqlError.SqlError>;
    readonly remove: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<void, SqlError.SqlError>;
  }
>()("@lensflare/local-server/DatasetsRepository") {
  static readonly layer = Layer.effect(
    DatasetsRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const findAll = Effect.fn("DatasetsRepository.findAll")(function* (projectId?: string) {
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

      const findById = Effect.fn("DatasetsRepository.findById")(function* (
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

      const insert = Effect.fn("DatasetsRepository.insert")(function* (input: InsertDatasetInput) {
        yield* sql`
          INSERT INTO datasets ${sql.insert({
            id: input.id,
            project_id: input.projectId,
            name: input.name,
            created_at: input.createdAt,
            updated_at: input.updatedAt,
          })}
        `;
      });

      const update = Effect.fn("DatasetsRepository.update")(function* (
        projectId: string,
        datasetId: string,
        fields: UpdateDatasetFields,
      ) {
        yield* sql`
          UPDATE datasets
          SET name = ${fields.name},
              updated_at = ${fields.updatedAt}
          WHERE id = ${datasetId}
            AND project_id = ${projectId}
        `;
      });

      const remove = Effect.fn("DatasetsRepository.remove")(function* (
        projectId: string,
        datasetId: string,
      ) {
        yield* sql`
          DELETE FROM datasets
          WHERE id = ${datasetId}
            AND project_id = ${projectId}
        `;
      });

      return DatasetsRepository.of({
        findAll,
        findById,
        insert,
        update,
        remove,
      });
    }),
  );
}
