import { DuckDBConnection } from "@duckdb/node-api";

interface TelemetryMigration {
  readonly id: string;
  readonly apply: (connection: DuckDBConnection) => Promise<void>;
}

const migrations: ReadonlyArray<TelemetryMigration> = [
  {
    id: "0001_create_otel_telemetry_tables",
    async apply(connection) {
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
          received_at TIMESTAMP_NS NOT NULL,
          client_addr TEXT
        )
      `);

      await connection.run(`
        CREATE TABLE IF NOT EXISTS otel_logs (
          LensflareRecordId TEXT PRIMARY KEY,
          BatchId TEXT NOT NULL,
          Timestamp TIMESTAMP_NS NOT NULL,
          TraceId TEXT NOT NULL,
          SpanId TEXT NOT NULL,
          TraceFlags UINTEGER NOT NULL,
          SeverityText TEXT NOT NULL,
          SeverityNumber INTEGER NOT NULL,
          ServiceName TEXT NOT NULL,
          Body TEXT NOT NULL,
          ResourceSchemaUrl TEXT NOT NULL,
          ResourceAttributes MAP(VARCHAR, VARCHAR) NOT NULL,
          ScopeSchemaUrl TEXT NOT NULL,
          ScopeName TEXT NOT NULL,
          ScopeVersion TEXT NOT NULL,
          ScopeAttributes MAP(VARCHAR, VARCHAR) NOT NULL,
          LogAttributes MAP(VARCHAR, VARCHAR) NOT NULL
        )
      `);

      await connection.run(`
        CREATE INDEX IF NOT EXISTS otel_logs_time_idx
        ON otel_logs (Timestamp, LensflareRecordId)
      `);
      await connection.run(`
        CREATE INDEX IF NOT EXISTS otel_logs_trace_idx
        ON otel_logs (TraceId)
      `);
      await connection.run(`
        CREATE INDEX IF NOT EXISTS otel_logs_service_idx
        ON otel_logs (ServiceName, SeverityText, Timestamp)
      `);

      await connection.run(`
        CREATE TABLE IF NOT EXISTS otel_traces (
          LensflareRecordId TEXT PRIMARY KEY,
          BatchId TEXT NOT NULL,
          Timestamp TIMESTAMP_NS NOT NULL,
          TraceId TEXT NOT NULL,
          SpanId TEXT NOT NULL,
          ParentSpanId TEXT NOT NULL,
          TraceState TEXT NOT NULL,
          SpanName TEXT NOT NULL,
          SpanKind TEXT NOT NULL,
          ServiceName TEXT NOT NULL,
          ResourceAttributes MAP(VARCHAR, VARCHAR) NOT NULL,
          ScopeName TEXT NOT NULL,
          ScopeVersion TEXT NOT NULL,
          SpanAttributes MAP(VARCHAR, VARCHAR) NOT NULL,
          Duration BIGINT NOT NULL,
          StatusCode TEXT NOT NULL,
          StatusMessage TEXT NOT NULL,
          "Events.Timestamp" TIMESTAMP_NS[] NOT NULL,
          "Events.Name" TEXT[] NOT NULL,
          "Events.Attributes" MAP(VARCHAR, VARCHAR)[] NOT NULL,
          "Links.TraceId" TEXT[] NOT NULL,
          "Links.SpanId" TEXT[] NOT NULL,
          "Links.TraceState" TEXT[] NOT NULL,
          "Links.Attributes" MAP(VARCHAR, VARCHAR)[] NOT NULL
        )
      `);

      await connection.run(`
        CREATE INDEX IF NOT EXISTS otel_traces_time_idx
        ON otel_traces (Timestamp, LensflareRecordId)
      `);
      await connection.run(`
        CREATE INDEX IF NOT EXISTS otel_traces_trace_idx
        ON otel_traces (TraceId, Timestamp)
      `);
      await connection.run(`
        CREATE INDEX IF NOT EXISTS otel_traces_service_idx
        ON otel_traces (ServiceName, SpanName, Timestamp)
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
  const applied = new Set(
    existingReader.getRowObjectsJson().map((row) => (typeof row.id === "string" ? row.id : "")),
  );

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
