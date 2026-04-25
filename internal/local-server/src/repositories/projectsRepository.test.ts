import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { withTempDirectory } from "../_internal/testSupport.ts";
import { makeSqliteDatabaseLayer } from "../db/database.ts";
import { ProjectsRepository } from "./projectsRepository.ts";

const buildLayer = (sqliteDatabaseFile: string) =>
  ProjectsRepository.layer.pipe(Layer.provide(makeSqliteDatabaseLayer(sqliteDatabaseFile)));

describe("ProjectsRepository", () => {
  it.effect("inserts and reads back a project row", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const repo = yield* ProjectsRepository;
        const now = new Date().toISOString();

        yield* repo.insert({
          id: "p1",
          name: "Lensflare",
          slug: "lensflare",
          icon: "rocket",
          createdAt: now,
          updatedAt: now,
        });

        const found = yield* repo.findById("p1");
        expect(found).toEqual({
          id: "p1",
          name: "Lensflare",
          slug: "lensflare",
          icon: "rocket",
          created_at: now,
          updated_at: now,
        });
      }),
    ),
  );

  it.effect("returns undefined for a missing project", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const repo = yield* ProjectsRepository;
        const found = yield* repo.findById("missing");
        expect(found).toBeUndefined();
      }),
    ),
  );

  it.effect("orders findAll by updated_at desc, name asc", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const repo = yield* ProjectsRepository;

        // Insert in a deliberately mixed order to confirm SQL ordering
        // (not insertion order) is what surfaces.
        yield* repo.insert({
          id: "p1",
          name: "Beta",
          slug: "beta",
          icon: "folder",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        });
        yield* repo.insert({
          id: "p2",
          name: "Alpha",
          slug: "alpha",
          icon: "folder",
          createdAt: "2024-01-02T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        });
        yield* repo.insert({
          id: "p3",
          name: "Gamma",
          slug: "gamma",
          icon: "folder",
          createdAt: "2024-01-02T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        });

        const all = yield* repo.findAll();
        expect(all.map((row) => row.id)).toEqual(["p2", "p3", "p1"]);
      }),
    ),
  );

  it.effect("update mutates the row in place", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const repo = yield* ProjectsRepository;
        const now = new Date().toISOString();

        yield* repo.insert({
          id: "p1",
          name: "Lensflare",
          slug: "lensflare",
          icon: "folder",
          createdAt: now,
          updatedAt: now,
        });

        const later = new Date(Date.now() + 1000).toISOString();
        yield* repo.update("p1", {
          name: "Lensflare API",
          slug: "lensflare-api",
          icon: "rocket",
          updatedAt: later,
        });

        const found = yield* repo.findById("p1");
        expect(found?.name).toBe("Lensflare API");
        expect(found?.slug).toBe("lensflare-api");
        expect(found?.icon).toBe("rocket");
        expect(found?.updated_at).toBe(later);
      }),
    ),
  );

  it.effect("remove deletes the row", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const repo = yield* ProjectsRepository;
        const now = new Date().toISOString();

        yield* repo.insert({
          id: "p1",
          name: "Lensflare",
          slug: "lensflare",
          icon: "folder",
          createdAt: now,
          updatedAt: now,
        });

        yield* repo.remove("p1");

        const found = yield* repo.findById("p1");
        expect(found).toBeUndefined();
      }),
    ),
  );
});
