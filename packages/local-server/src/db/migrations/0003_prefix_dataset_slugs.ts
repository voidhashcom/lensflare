import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  getDatasetLocalSlug,
  makeDatasetTag,
  makeUniqueSlug,
} from "../../domain/slug.ts";

interface DatasetSlugRow {
  readonly id: string;
  readonly project_id: string;
  readonly project_slug: string;
  readonly dataset_slug: string;
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = (yield* sql`
    SELECT
      datasets.id,
      datasets.project_id,
      projects.slug AS project_slug,
      datasets.slug AS dataset_slug
    FROM datasets
    INNER JOIN projects ON projects.id = datasets.project_id
    ORDER BY datasets.created_at ASC, datasets.id ASC
  `) as unknown as ReadonlyArray<DatasetSlugRow>;

  const usedSlugs = new Set(rows.map((row) => row.dataset_slug));

  for (const row of rows) {
    usedSlugs.delete(row.dataset_slug);

    const localSlug = getDatasetLocalSlug(row.project_slug, row.dataset_slug);
    const baseTag = makeDatasetTag(row.project_slug, localSlug);
    const nextSlug = makeUniqueSlug(baseTag, usedSlugs);
    usedSlugs.add(nextSlug);

    if (nextSlug === row.dataset_slug) {
      continue;
    }

    yield* sql`
      UPDATE datasets
      SET slug = ${nextSlug}
      WHERE id = ${row.id}
        AND project_id = ${row.project_id}
    `;
  }
});
