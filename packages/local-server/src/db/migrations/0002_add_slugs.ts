import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { makeUniqueSlug, slugify } from "../../domain/slug.ts";

interface LegacyProjectRow {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface LegacyDatasetRow {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectRows = (yield* sql`
    SELECT id, name, icon, created_at, updated_at
    FROM projects
    ORDER BY created_at ASC, id ASC
  `) as unknown as ReadonlyArray<LegacyProjectRow>;
  const datasetRows = (yield* sql`
    SELECT id, project_id, name, created_at, updated_at
    FROM datasets
    ORDER BY created_at ASC, id ASC
  `) as unknown as ReadonlyArray<LegacyDatasetRow>;

  const usedProjectSlugs = new Set<string>();
  const usedDatasetSlugs = new Set<string>();

  const projectValues = projectRows.map((row) => {
    const slug = makeUniqueSlug(slugify(row.name), usedProjectSlugs);
    usedProjectSlugs.add(slug);
    return {
      ...row,
      slug,
    };
  });

  const datasetValues = datasetRows.map((row) => {
    const slug = makeUniqueSlug(slugify(row.name), usedDatasetSlugs);
    usedDatasetSlugs.add(slug);
    return {
      ...row,
      slug,
    };
  });

  yield* sql`PRAGMA foreign_keys = OFF`;

  yield* sql`
    CREATE TABLE projects_v2 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  for (const row of projectValues) {
    yield* sql`
      INSERT INTO projects_v2 ${sql.insert({
        id: row.id,
        name: row.name,
        slug: row.slug,
        icon: row.icon,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })}
    `;
  }

  yield* sql`
    CREATE TABLE datasets_v2 (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  for (const row of datasetValues) {
    yield* sql`
      INSERT INTO datasets_v2 ${sql.insert({
        id: row.id,
        project_id: row.project_id,
        name: row.name,
        slug: row.slug,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })}
    `;
  }

  yield* sql`DROP TABLE datasets`;
  yield* sql`DROP TABLE projects`;
  yield* sql`ALTER TABLE projects_v2 RENAME TO projects`;
  yield* sql`ALTER TABLE datasets_v2 RENAME TO datasets`;
  yield* sql`
    CREATE INDEX IF NOT EXISTS datasets_project_id_idx
    ON datasets (project_id)
  `;
  yield* sql`PRAGMA foreign_keys = ON`;
});
