import {
  TelemetryFilterCatalogEntrySchema,
  TelemetryFilterFieldKindSchema,
  type TelemetryFilterCatalogEntry,
} from "@lensflare/contracts";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlError } from "effect/unstable/sql";

const StringArrayFromJson = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeStringArray = Schema.decodeUnknownSync(StringArrayFromJson);
const encodeStringArray = Schema.encodeSync(StringArrayFromJson);

const TelemetryFilterCatalogRowSchema = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  dataset_id: Schema.String,
  path_json: Schema.String,
  label: Schema.String,
  kind: TelemetryFilterFieldKindSchema,
  values_json: Schema.String,
  frequency: Schema.Number,
  high_cardinality: Schema.Number,
  updated_at: Schema.String,
});

type TelemetryFilterCatalogRow = Schema.Schema.Type<typeof TelemetryFilterCatalogRowSchema>;

const decodeTelemetryFilterCatalogRow = Schema.decodeUnknownSync(TelemetryFilterCatalogRowSchema);
const decodeTelemetryFilterCatalogEntry = Schema.decodeUnknownSync(TelemetryFilterCatalogEntrySchema);

function entryFromRow(row: TelemetryFilterCatalogRow): TelemetryFilterCatalogEntry {
  return decodeTelemetryFilterCatalogEntry({
    id: row.id,
    projectId: row.project_id,
    datasetId: row.dataset_id,
    path: decodeStringArray(row.path_json),
    label: row.label,
    kind: row.kind,
    values: decodeStringArray(row.values_json),
    frequency: row.frequency,
    highCardinality: row.high_cardinality !== 0,
    updatedAt: row.updated_at,
  });
}

function rowFromEntry(entry: TelemetryFilterCatalogEntry) {
  return {
    id: entry.id,
    project_id: entry.projectId,
    dataset_id: entry.datasetId,
    path_json: encodeStringArray(entry.path),
    label: entry.label,
    kind: entry.kind,
    values_json: encodeStringArray(entry.values),
    frequency: entry.frequency,
    high_cardinality: entry.highCardinality ? 1 : 0,
    updated_at: entry.updatedAt,
  };
}

function upsertEntrySql(sql: SqlClient.SqlClient, entry: TelemetryFilterCatalogEntry) {
  const row = rowFromEntry(entry);
  return sql`
    INSERT INTO telemetry_filter_catalog ${sql.insert(row)}
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      dataset_id = excluded.dataset_id,
      path_json = excluded.path_json,
      label = excluded.label,
      kind = excluded.kind,
      values_json = excluded.values_json,
      frequency = excluded.frequency,
      high_cardinality = excluded.high_cardinality,
      updated_at = excluded.updated_at
  `;
}

export class TelemetryFilterCatalogRepository extends Context.Service<
  TelemetryFilterCatalogRepository,
  {
    readonly findByDataset: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<ReadonlyArray<TelemetryFilterCatalogEntry>, SqlError.SqlError>;
    readonly upsertMany: (
      entries: ReadonlyArray<TelemetryFilterCatalogEntry>,
    ) => Effect.Effect<void, SqlError.SqlError>;
    readonly replaceDataset: (
      projectId: string,
      datasetId: string,
      entries: ReadonlyArray<TelemetryFilterCatalogEntry>,
    ) => Effect.Effect<void, SqlError.SqlError>;
  }
>()("@lensflare/local-server/TelemetryFilterCatalogRepository") {
  static readonly layer = Layer.effect(
    TelemetryFilterCatalogRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const findByDataset = Effect.fn("TelemetryFilterCatalogRepository.findByDataset")(function* (
        projectId: string,
        datasetId: string,
      ) {
        const rows = yield* sql`
          SELECT
            id,
            project_id,
            dataset_id,
            path_json,
            label,
            kind,
            values_json,
            frequency,
            high_cardinality,
            updated_at
          FROM telemetry_filter_catalog
          WHERE project_id = ${projectId}
            AND dataset_id = ${datasetId}
          ORDER BY label ASC
        `;

        return rows.map((row) => entryFromRow(decodeTelemetryFilterCatalogRow(row)));
      });

      const upsertMany = Effect.fn("TelemetryFilterCatalogRepository.upsertMany")(function* (
        entries: ReadonlyArray<TelemetryFilterCatalogEntry>,
      ) {
        if (entries.length === 0) {
          return;
        }

        yield* Effect.forEach(
          entries,
          (entry) => upsertEntrySql(sql, entry),
          { discard: true },
        ).pipe(sql.withTransaction);
      });

      const replaceDataset = Effect.fn("TelemetryFilterCatalogRepository.replaceDataset")(function* (
        projectId: string,
        datasetId: string,
        entries: ReadonlyArray<TelemetryFilterCatalogEntry>,
      ) {
        yield* Effect.gen(function* () {
          yield* sql`
            DELETE FROM telemetry_filter_catalog
            WHERE project_id = ${projectId}
              AND dataset_id = ${datasetId}
          `;
          yield* Effect.forEach(entries, (entry) => upsertEntrySql(sql, entry), {
            discard: true,
          });
        }).pipe(sql.withTransaction);
      });

      return TelemetryFilterCatalogRepository.of({
        findByDataset,
        upsertMany,
        replaceDataset,
      });
    }),
  );
}
