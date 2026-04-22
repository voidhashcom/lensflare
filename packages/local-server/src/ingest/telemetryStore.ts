import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";
import duckdb from "@duckdb/node-api";
import { Context, Effect, Exit, Layer, Schema } from "effect";
import { runTelemetryMigrations } from "../db/telemetryMigrations.ts";

export class DuckDbError extends Schema.TaggedErrorClass<DuckDbError>()("DuckDbError", {
  message: Schema.String,
}) {}

function toDuckDbError(error: unknown): DuckDbError {
  return new DuckDbError({
    message: error instanceof Error ? error.message : String(error),
  });
}

export class TelemetryStore extends Context.Service<
  TelemetryStore,
  {
    readonly execute: (
      sql: string,
      values?: Record<string, DuckDBValue>,
    ) => Effect.Effect<void, DuckDbError>;
    readonly queryRows: <A extends Record<string, unknown>>(
      sql: string,
      values?: Record<string, DuckDBValue>,
    ) => Effect.Effect<ReadonlyArray<A>, DuckDbError>;
    readonly withTransaction: <A, E>(
      f: (connection: DuckDBConnection) => Effect.Effect<A, E>,
    ) => Effect.Effect<A, E | DuckDbError>;
  }
>()("@lensflare/local-server/TelemetryStore") {
  static layer(duckdbDatabaseFile: string) {
    return Layer.effect(
      TelemetryStore,
      Effect.gen(function* () {
        const instance = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: async () => {
              const db = await duckdb.DuckDBInstance.create(duckdbDatabaseFile);
              const connection = await db.connect();
              try {
                await runTelemetryMigrations(connection);
              } finally {
                connection.closeSync();
              }
              return db;
            },
            catch: toDuckDbError,
          }),
          (db) =>
            Effect.sync(() => {
              db.closeSync();
            }),
        );

        const withConnection = <A, E>(
          f: (connection: DuckDBConnection) => Effect.Effect<A, E>,
        ): Effect.Effect<A, E | DuckDbError> =>
          Effect.acquireUseRelease(
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

        const execute = (sql: string, values?: Record<string, DuckDBValue>) =>
          withConnection((connection) =>
            Effect.tryPromise({
              try: async () => {
                await connection.run(sql, values);
              },
              catch: toDuckDbError,
            }),
          );

        const queryRows = <A extends Record<string, unknown>>(
          sql: string,
          values?: Record<string, DuckDBValue>,
        ) =>
          withConnection((connection) =>
            Effect.tryPromise({
              try: async () => {
                const reader = await connection.runAndReadAll(sql, values);
                await reader.readAll();
                return reader.getRowObjectsJson() as unknown as ReadonlyArray<A>;
              },
              catch: toDuckDbError,
            }),
          );

        const withTransaction = <A, E>(f: (connection: DuckDBConnection) => Effect.Effect<A, E>) =>
          withConnection((connection) =>
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

        return TelemetryStore.of({
          execute,
          queryRows,
          withTransaction,
        });
      }),
    );
  }
}
