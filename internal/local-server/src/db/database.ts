import { SqliteClient, SqliteMigrator } from "./sqliteNode.ts";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { catalogMigrations } from "./migrations/index.ts";

/**
 * Builds a layer that exposes a configured {@link SqlClient.SqlClient}, with
 * the side effect of enabling SQLite foreign-key enforcement and running all
 * registered catalog migrations on startup.
 *
 * The init effect is wired via {@link Layer.provideMerge} so callers depend
 * solely on `SqlClient` while still getting the deterministic init behavior:
 * because the init layer requires `SqlClient`, Effect's layer scheduler runs
 * the SQLite client initialization first, then the PRAGMA + migrations, then
 * exposes the client to downstream services.
 */
export function makeSqliteDatabaseLayer(sqliteDatabaseFile: string) {
  const clientLayer = SqliteClient.layer({
    filename: sqliteDatabaseFile,
  });

  const initLayer = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA foreign_keys = ON`;
      yield* SqliteMigrator.run({ loader: catalogMigrations });
    }),
  );

  return initLayer.pipe(Layer.provideMerge(clientLayer));
}
