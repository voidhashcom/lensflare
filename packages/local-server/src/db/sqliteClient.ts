import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import * as Cache from "effect/Cache";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

const ATTR_DB_SYSTEM_NAME = "db.system.name";

const classifyError = (cause: unknown, message: string, operation: string) =>
  classifySqliteError(cause, { message, operation });

export interface SqliteClientConfig {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly prepareCacheSize?: number | undefined;
  readonly prepareCacheTTL?: Duration.Input | undefined;
  readonly disableWAL?: boolean | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly timeout?: number | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
}

interface SqliteConnection extends Connection {
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>;
}

function isReader(statement: StatementSync): boolean {
  return statement.columns().length > 0;
}

function bindParameters(params: ReadonlyArray<unknown>) {
  return params as Array<SQLInputValue>;
}

export const make = (
  options: SqliteClientConfig,
): Effect.Effect<Client.SqlClient, never, Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined;

    const makeConnection = Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const db = new DatabaseSync(options.filename, {
        enableForeignKeyConstraints: true,
        readOnly: options.readonly ?? false,
        timeout: options.timeout ?? 5_000,
      });

      yield* Scope.addFinalizer(scope, Effect.sync(() => db.close()));

      if (options.readonly !== true && options.disableWAL !== true) {
        yield* Effect.orDie(
          Effect.try({
            try: () => db.exec("PRAGMA journal_mode = WAL"),
            catch: (cause) =>
              new SqlError({
                reason: classifyError(cause, "Failed to enable WAL mode", "pragma"),
              }),
          }),
        );
      }

      const prepareCache = yield* Cache.make({
        capacity: options.prepareCacheSize ?? 200,
        timeToLive: options.prepareCacheTTL ?? Duration.minutes(10),
        lookup: (sql: string) =>
          Effect.try({
            try: () => db.prepare(sql),
            catch: (cause) =>
              new SqlError({
                reason: classifyError(cause, "Failed to prepare statement", "prepare"),
              }),
          }),
      });

      const runStatement = (
        statement: StatementSync,
        params: ReadonlyArray<unknown>,
        raw: boolean,
      ) =>
        Effect.withFiber<ReadonlyArray<any> | unknown, SqlError>((fiber) => {
          statement.setReadBigInts(Context.get(fiber.context, Client.SafeIntegers));

          try {
            if (isReader(statement)) {
              return Effect.succeed(statement.all(...bindParameters(params)));
            }

            const result = statement.run(...bindParameters(params));
            return Effect.succeed(raw ? result : []);
          } catch (cause) {
            return Effect.fail(
              new SqlError({
                reason: classifyError(cause, "Failed to execute statement", "execute"),
              }),
            );
          }
        });

      const run = (sql: string, params: ReadonlyArray<unknown>, raw = false) =>
        Effect.flatMap(Cache.get(prepareCache, sql), (statement) => runStatement(statement, params, raw));

      const runValues = (sql: string, params: ReadonlyArray<unknown>) =>
        Effect.acquireUseRelease(
          Cache.get(prepareCache, sql),
          (statement) =>
            Effect.withFiber<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>((fiber) => {
              statement.setReadBigInts(Context.get(fiber.context, Client.SafeIntegers));
              statement.setReturnArrays(true);

              try {
                if (isReader(statement)) {
                  return Effect.succeed(
                    statement.all(...bindParameters(params)) as unknown as ReadonlyArray<
                      ReadonlyArray<unknown>
                    >,
                  );
                }

                statement.run(...bindParameters(params));
                return Effect.succeed([]);
              } catch (cause) {
                return Effect.fail(
                  new SqlError({
                    reason: classifyError(cause, "Failed to execute statement", "execute"),
                  }),
                );
              }
            }),
          (statement) =>
            Effect.sync(() => {
              statement.setReturnArrays(false);
            }),
        );

      return identity<SqliteConnection>({
        execute(sql, params, rowTransform) {
          const effect = run(sql, params, false) as Effect.Effect<ReadonlyArray<any>, SqlError>;
          return rowTransform ? Effect.map(effect, rowTransform) : effect;
        },
        executeRaw(sql, params) {
          return run(sql, params, true);
        },
        executeValues(sql, params) {
          return runValues(sql, params);
        },
        executeUnprepared(sql, params, rowTransform) {
          const effect = runStatement(db.prepare(sql), params ?? [], false) as Effect.Effect<
            ReadonlyArray<any>,
            SqlError
          >;
          return rowTransform ? Effect.map(effect, rowTransform) : effect;
        },
        executeStream(_sql, _params) {
          return Stream.die("executeStream not implemented");
        },
        loadExtension(path: string) {
          return Effect.try({
            try: () => db.loadExtension(path),
            catch: (cause) =>
              new SqlError({
                reason: classifyError(cause, "Failed to load extension", "loadExtension"),
              }),
          });
        },
      });
    });

    const semaphore = yield* Semaphore.make(1);
    const connection = yield* makeConnection;

    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection));
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!;
      const scope = Context.getUnsafe(fiber.context, Scope.Scope);

      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () => Scope.addFinalizer(scope, semaphore.release(1))),
        connection,
      );
    });

    return yield* Client.make({
      acquirer,
      compiler,
      spanAttributes: [
        ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
        [ATTR_DB_SYSTEM_NAME, "sqlite"],
      ],
      transactionAcquirer,
      transformRows,
    });
  });

export const layerConfig = (
  config: Config.Wrap<SqliteClientConfig>,
): Layer.Layer<Client.SqlClient, Config.ConfigError> =>
  Layer.effect(Client.SqlClient)(
    Config.unwrap(config).asEffect().pipe(Effect.flatMap(make)),
  ).pipe(Layer.provide(Reactivity.layer));

export const layer = (config: SqliteClientConfig): Layer.Layer<Client.SqlClient> =>
  Layer.effect(Client.SqlClient)(make(config)).pipe(Layer.provide(Reactivity.layer));
