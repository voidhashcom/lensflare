import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";
import duckdb from "@duckdb/node-api";
import { Context, Effect, Exit, Layer, Schema } from "effect";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { runTelemetryMigrations } from "../db/telemetryMigrations.ts";

export class DuckDbError extends Schema.TaggedErrorClass<DuckDbError>()("DuckDbError", {
  message: Schema.String,
}) {}

function toDuckDbError(error: unknown): DuckDbError {
  return new DuckDbError({
    message: error instanceof Error ? error.message : String(error),
  });
}

function safeDatasetFileStem(datasetId: string): string {
  return datasetId.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function datasetDuckDbDatabaseFile(duckdbDatabaseFile: string, datasetId: string): string {
  const parsed = parse(duckdbDatabaseFile);
  return join(parsed.dir, `${parsed.name}.datasets`, `${safeDatasetFileStem(datasetId)}.duckdb`);
}

function datasetDuckDbStorageFiles(
  duckdbDatabaseFile: string,
  datasetId: string,
): ReadonlyArray<string> {
  const databaseFile = datasetDuckDbDatabaseFile(duckdbDatabaseFile, datasetId);
  return [databaseFile, `${databaseFile}.wal`];
}

export class TelemetryStore extends Context.Service<
  TelemetryStore,
  {
    readonly execute: (
      datasetId: string,
      sql: string,
      values?: Record<string, DuckDBValue>,
    ) => Effect.Effect<void, DuckDbError>;
    readonly queryRows: <A extends Record<string, unknown>>(
      datasetId: string,
      sql: string,
      values?: Record<string, DuckDBValue>,
    ) => Effect.Effect<ReadonlyArray<A>, DuckDbError>;
    readonly withTransaction: <A, E>(
      datasetId: string,
      f: (connection: DuckDBConnection) => Effect.Effect<A, E>,
    ) => Effect.Effect<A, E | DuckDbError>;
    readonly getStorageStats: (
      datasetId: string,
    ) => Effect.Effect<{ readonly datasetId: string; readonly bytes: number }, DuckDbError>;
    readonly clearDataset: (datasetId: string) => Effect.Effect<void, DuckDbError>;
  }
>()("@lensflare/local-server/TelemetryStore") {
  static layer(duckdbDatabaseFile: string) {
    return Layer.effect(
      TelemetryStore,
      Effect.gen(function* () {
        const instances = new Map<string, duckdb.DuckDBInstance>();
        const datasetDirectory = dirname(
          datasetDuckDbDatabaseFile(duckdbDatabaseFile, "placeholder"),
        );

        yield* Effect.tryPromise({
          try: () => mkdir(datasetDirectory, { recursive: true }),
          catch: toDuckDbError,
        });

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const instance of instances.values()) {
              instance.closeSync();
            }
            instances.clear();
          }),
        );

        const getInstance = (datasetId: string) =>
          Effect.tryPromise({
            try: async () => {
              const cached = instances.get(datasetId);
              if (cached !== undefined) {
                return cached;
              }

              const datasetDatabaseFile = datasetDuckDbDatabaseFile(duckdbDatabaseFile, datasetId);
              await mkdir(dirname(datasetDatabaseFile), { recursive: true });
              const db = await duckdb.DuckDBInstance.create(datasetDatabaseFile);
              const connection = await db.connect();
              try {
                await runTelemetryMigrations(connection);
                await connection.run("CHECKPOINT");
              } finally {
                connection.closeSync();
              }
              instances.set(datasetId, db);
              return db;
            },
            catch: toDuckDbError,
          });

        const withConnection = <A, E>(
          datasetId: string,
          f: (connection: DuckDBConnection) => Effect.Effect<A, E>,
        ): Effect.Effect<A, E | DuckDbError> =>
          Effect.gen(function* () {
            const instance = yield* getInstance(datasetId);
            return yield* Effect.acquireUseRelease(
              Effect.tryPromise({
                try: () => instance.connect(),
                catch: toDuckDbError,
              }),
              f,
              (connection) =>
                Effect.sync(() => {
                  connection.closeSync();
                }),
            );
          });

        const execute = (datasetId: string, sql: string, values?: Record<string, DuckDBValue>) =>
          withConnection(datasetId, (connection) =>
            Effect.tryPromise({
              try: async () => {
                await connection.run(sql, values);
              },
              catch: toDuckDbError,
            }),
          );

        const queryRows = <A extends Record<string, unknown>>(
          datasetId: string,
          sql: string,
          values?: Record<string, DuckDBValue>,
        ) =>
          withConnection(datasetId, (connection) =>
            Effect.tryPromise({
              try: async () => {
                const reader = await connection.runAndReadAll(sql, values);
                await reader.readAll();
                return reader.getRowObjectsJson() as unknown as ReadonlyArray<A>;
              },
              catch: toDuckDbError,
            }),
          );

        const withTransaction = <A, E>(
          datasetId: string,
          f: (connection: DuckDBConnection) => Effect.Effect<A, E>,
        ) =>
          withConnection(datasetId, (connection) =>
            Effect.gen(function* () {
              yield* Effect.tryPromise({
                try: () => connection.run("BEGIN TRANSACTION"),
                catch: toDuckDbError,
              });

              const exit = yield* Effect.exit(f(connection));
              if (Exit.isSuccess(exit)) {
                yield* Effect.tryPromise({
                  try: () => connection.run("COMMIT"),
                  catch: toDuckDbError,
                });
                return exit.value;
              }

              yield* Effect.tryPromise({
                try: () => connection.run("ROLLBACK"),
                catch: () => toDuckDbError(exit.cause),
              }).pipe(Effect.orDie);

              return yield* Effect.failCause(exit.cause);
            }),
          );

        const getStorageStats = (datasetId: string) =>
          Effect.tryPromise({
            try: async () => {
              const fileSizes = await Promise.all(
                datasetDuckDbStorageFiles(duckdbDatabaseFile, datasetId).map((file) =>
                  stat(file).then(
                    (stats) => stats.size,
                    (error: unknown) => {
                      if (
                        error instanceof Error &&
                        "code" in error &&
                        (error as NodeJS.ErrnoException).code === "ENOENT"
                      ) {
                        return 0;
                      }
                      throw error;
                    },
                  ),
                ),
              );

              return {
                datasetId,
                bytes: fileSizes.reduce((total, size) => total + size, 0),
              };
            },
            catch: toDuckDbError,
          });

        const clearDataset = (datasetId: string) =>
          Effect.tryPromise({
            try: async () => {
              const instance = instances.get(datasetId);
              if (instance !== undefined) {
                instance.closeSync();
                instances.delete(datasetId);
              }

              await Promise.all(
                datasetDuckDbStorageFiles(duckdbDatabaseFile, datasetId).map((file) =>
                  rm(file, { force: true }),
                ),
              );
            },
            catch: toDuckDbError,
          });

        return TelemetryStore.of({
          execute,
          queryRows,
          withTransaction,
          getStorageStats,
          clearDataset,
        });
      }),
    );
  }
}
