import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS telemetry_filter_catalog (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      path_json TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      values_json TEXT NOT NULL,
      frequency INTEGER NOT NULL,
      high_cardinality INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS telemetry_filter_catalog_dataset_id_idx
    ON telemetry_filter_catalog (dataset_id)
  `;
});
