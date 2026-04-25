import { SqliteMigrator } from "../sqliteNode.ts";
import migration0001 from "./0001_create_catalog_tables.ts";
import migration0002 from "./0002_add_slugs.ts";
import migration0003 from "./0003_prefix_dataset_slugs.ts";

/**
 * Loader for catalog database migrations.
 *
 * Migrations are registered explicitly here (instead of via filesystem globs)
 * so the loader works identically in development, tests, and bundled builds.
 *
 * Each entry follows the `<id>_<name>` convention required by
 * {@link SqliteMigrator.fromRecord}; the numeric prefix determines the run
 * order, and the suffix is recorded in the `effect_sql_migrations` table.
 */
export const catalogMigrations = SqliteMigrator.fromRecord({
  "0001_create_catalog_tables": migration0001,
  "0002_add_slugs": migration0002,
  "0003_prefix_dataset_slugs": migration0003,
});
