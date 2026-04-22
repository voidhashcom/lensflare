import { PROJECT_ICONS, type ProjectEntity, type ProjectIcon } from "@lensflare/contracts";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlError } from "effect/unstable/sql";

const ProjectRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  icon: Schema.Literals(PROJECT_ICONS),
  created_at: Schema.String,
  updated_at: Schema.String,
});

export type ProjectRow = Schema.Schema.Type<typeof ProjectRowSchema>;

const decodeProjectRow = Schema.decodeUnknownSync(ProjectRowSchema);

/**
 * Map a SQL row (snake_case columns) into the API-facing
 * {@link ProjectEntity} (camelCase). Kept here so callers never have to know
 * about the on-disk column layout.
 */
export function projectEntityFromRow(row: ProjectRow): ProjectEntity {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface InsertProjectInput {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly icon: ProjectIcon;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateProjectFields {
  readonly name: string;
  readonly slug: string;
  readonly icon: ProjectIcon;
  readonly updatedAt: string;
}

/**
 * Pure data-access layer for the `projects` table.
 *
 * The repository only knows about rows and SQL: validation, ID generation,
 * timestamps, and event publishing all live in the project service so this
 * service can be reused by any caller that needs CRUD primitives.
 */
export class ProjectsRepository extends Context.Service<
  ProjectsRepository,
  {
    readonly findAll: () => Effect.Effect<ReadonlyArray<ProjectRow>, SqlError.SqlError>;
    readonly findById: (id: string) => Effect.Effect<ProjectRow | undefined, SqlError.SqlError>;
    readonly findBySlug: (slug: string) => Effect.Effect<ProjectRow | undefined, SqlError.SqlError>;
    readonly insert: (input: InsertProjectInput) => Effect.Effect<void, SqlError.SqlError>;
    readonly update: (
      id: string,
      fields: UpdateProjectFields,
    ) => Effect.Effect<void, SqlError.SqlError>;
    readonly remove: (id: string) => Effect.Effect<void, SqlError.SqlError>;
  }
>()("@lensflare/local-server/ProjectsRepository") {
  static readonly layer = Layer.effect(
    ProjectsRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const findAll = Effect.fn("ProjectsRepository.findAll")(function* () {
        const rows = yield* sql`
          SELECT id, name, slug, icon, created_at, updated_at
          FROM projects
          ORDER BY updated_at DESC, name ASC
        `;
        return rows.map((row) => decodeProjectRow(row));
      });

      const findById = Effect.fn("ProjectsRepository.findById")(function* (id: string) {
        const rows = yield* sql`
          SELECT id, name, slug, icon, created_at, updated_at
          FROM projects
          WHERE id = ${id}
          LIMIT 1
        `;
        return rows[0] === undefined ? undefined : decodeProjectRow(rows[0]);
      });

      const findBySlug = Effect.fn("ProjectsRepository.findBySlug")(function* (slug: string) {
        const rows = yield* sql`
          SELECT id, name, slug, icon, created_at, updated_at
          FROM projects
          WHERE slug = ${slug}
          LIMIT 1
        `;
        return rows[0] === undefined ? undefined : decodeProjectRow(rows[0]);
      });

      const insert = Effect.fn("ProjectsRepository.insert")(function* (input: InsertProjectInput) {
        yield* sql`
          INSERT INTO projects ${sql.insert({
            id: input.id,
            name: input.name,
            slug: input.slug,
            icon: input.icon,
            created_at: input.createdAt,
            updated_at: input.updatedAt,
          })}
        `;
      });

      const update = Effect.fn("ProjectsRepository.update")(function* (
        id: string,
        fields: UpdateProjectFields,
      ) {
        yield* sql`
          UPDATE projects
          SET name = ${fields.name},
              slug = ${fields.slug},
              icon = ${fields.icon},
              updated_at = ${fields.updatedAt}
          WHERE id = ${id}
        `;
      });

      const remove = Effect.fn("ProjectsRepository.remove")(function* (id: string) {
        yield* sql`
          DELETE FROM projects
          WHERE id = ${id}
        `;
      });

      return ProjectsRepository.of({
        findAll,
        findById,
        findBySlug,
        insert,
        update,
        remove,
      });
    }),
  );
}
