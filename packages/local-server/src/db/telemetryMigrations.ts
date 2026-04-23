import { DuckDBConnection } from "@duckdb/node-api";

interface TelemetryMigration {
  readonly id: string;
  readonly apply: (connection: DuckDBConnection) => Promise<void>;
}

const migrations: ReadonlyArray<TelemetryMigration> = [
  {
    id: "0001_create_telemetry_tables",
    async apply(connection) {
      await connection.run(`
        CREATE TABLE IF NOT EXISTS telemetry_migrations (
          id TEXT PRIMARY KEY,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await connection.run(`
        CREATE TABLE IF NOT EXISTS ingest_batches (
          id TEXT PRIMARY KEY,
          provider_kind TEXT NOT NULL,
          signal TEXT NOT NULL,
          project_id TEXT NOT NULL,
          project_slug TEXT NOT NULL,
          dataset_id TEXT NOT NULL,
          dataset_slug TEXT NOT NULL,
          request_content_type TEXT NOT NULL,
          request_content_encoding TEXT,
          request_bytes BIGINT NOT NULL,
          accepted_records BIGINT NOT NULL,
          received_at TIMESTAMP NOT NULL,
          client_addr TEXT
        )
      `);

      await connection.run(`
        CREATE TABLE IF NOT EXISTS log_records (
          id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          project_slug TEXT NOT NULL,
          dataset_id TEXT NOT NULL,
          dataset_slug TEXT NOT NULL,
          provider_kind TEXT NOT NULL,
          ingested_at TIMESTAMP NOT NULL,
          timestamp TIMESTAMP,
          observed_timestamp TIMESTAMP,
          trace_id TEXT,
          span_id TEXT,
          trace_flags TEXT,
          severity_number INTEGER,
          severity_text TEXT,
          service_name TEXT,
          resource_schema_url TEXT,
          scope_name TEXT,
          scope_version TEXT,
          scope_schema_url TEXT,
          body_text TEXT,
          body_json JSON,
          resource_json JSON,
          scope_json JSON,
          attributes_json JSON,
          dropped_attributes_count INTEGER,
          raw_record_json JSON
        )
      `);

      await connection.run(`
        CREATE INDEX IF NOT EXISTS log_records_dataset_slug_idx
        ON log_records (dataset_slug, ingested_at)
      `);
      await connection.run(`
        CREATE INDEX IF NOT EXISTS log_records_batch_id_idx
        ON log_records (batch_id)
      `);
    },
  },
];

export async function runTelemetryMigrations(connection: DuckDBConnection): Promise<void> {
  await connection.run(`
    CREATE TABLE IF NOT EXISTS telemetry_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const existingReader = await connection.runAndReadAll(`
    SELECT id
    FROM telemetry_migrations
    ORDER BY id ASC
  `);
  await existingReader.readAll();
  const applied = new Set(existingReader.getRowObjectsJson().map((row) => String(row.id)));

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    await connection.run("BEGIN TRANSACTION");
    try {
      await migration.apply(connection);
      await connection.run("INSERT INTO telemetry_migrations (id) VALUES ($id)", {
        id: migration.id,
      });
      await connection.run("COMMIT");
    } catch (error) {
      try {
        await connection.run("ROLLBACK");
      } catch {
        // Ignore rollback failures and preserve the original error.
      }
      throw error;
    }
  }
}
