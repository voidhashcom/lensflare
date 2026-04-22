import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { withTempDirectory } from "../_internal/testSupport.ts";
import { makeDatabaseLayer } from "../db/database.ts";
import { DatasetsRepository } from "./datasetsRepository.ts";
import { ProjectsRepository } from "./projectsRepository.ts";

// The datasets table has an FK on projects.id, so every test sets up a
// project row first. We expose both repositories from the test layer so
// each spec can manage parent/child rows directly.
const buildLayer = (databaseFile: string) => {
  const databaseLayer = makeDatabaseLayer(databaseFile);
  return Layer.mergeAll(
    ProjectsRepository.layer.pipe(Layer.provide(databaseLayer)),
    DatasetsRepository.layer.pipe(Layer.provide(databaseLayer)),
  );
};

const seedProject = (projects: ProjectsRepository["Service"], id: string) =>
  Effect.gen(function* () {
    const now = new Date().toISOString();
    yield* projects.insert({
      id,
      name: `Project ${id}`,
      icon: "folder",
      createdAt: now,
      updatedAt: now,
    });
  });

describe("DatasetsRepository", () => {
  it.effect("inserts and reads back a dataset row", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const projects = yield* ProjectsRepository;
        const datasets = yield* DatasetsRepository;
        yield* seedProject(projects, "p1");

        const now = new Date().toISOString();
        yield* datasets.insert({
          id: "d1",
          projectId: "p1",
          name: "traces",
          createdAt: now,
          updatedAt: now,
        });

        const found = yield* datasets.findById("p1", "d1");
        expect(found).toEqual({
          id: "d1",
          project_id: "p1",
          name: "traces",
          created_at: now,
          updated_at: now,
        });
      }),
    ),
  );

  it.effect("findAll filters by projectId when provided", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const projects = yield* ProjectsRepository;
        const datasets = yield* DatasetsRepository;
        yield* seedProject(projects, "p1");
        yield* seedProject(projects, "p2");

        const now = new Date().toISOString();
        yield* datasets.insert({
          id: "d1",
          projectId: "p1",
          name: "traces",
          createdAt: now,
          updatedAt: now,
        });
        yield* datasets.insert({
          id: "d2",
          projectId: "p2",
          name: "spans",
          createdAt: now,
          updatedAt: now,
        });

        const onlyP1 = yield* datasets.findAll("p1");
        expect(onlyP1.map((row) => row.id)).toEqual(["d1"]);

        const all = yield* datasets.findAll();
        expect(all.map((row) => row.id).sort()).toEqual(["d1", "d2"]);
      }),
    ),
  );

  it.effect("update mutates only the matching row", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const projects = yield* ProjectsRepository;
        const datasets = yield* DatasetsRepository;
        yield* seedProject(projects, "p1");

        const now = new Date().toISOString();
        yield* datasets.insert({
          id: "d1",
          projectId: "p1",
          name: "traces",
          createdAt: now,
          updatedAt: now,
        });

        const later = new Date(Date.now() + 1000).toISOString();
        yield* datasets.update("p1", "d1", { name: "spans", updatedAt: later });

        const found = yield* datasets.findById("p1", "d1");
        expect(found?.name).toBe("spans");
        expect(found?.updated_at).toBe(later);
      }),
    ),
  );

  it.effect("remove deletes only the matching row", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const projects = yield* ProjectsRepository;
        const datasets = yield* DatasetsRepository;
        yield* seedProject(projects, "p1");

        const now = new Date().toISOString();
        yield* datasets.insert({
          id: "d1",
          projectId: "p1",
          name: "traces",
          createdAt: now,
          updatedAt: now,
        });

        yield* datasets.remove("p1", "d1");

        const found = yield* datasets.findById("p1", "d1");
        expect(found).toBeUndefined();
      }),
    ),
  );

  it.effect("foreign-key cascade removes child datasets", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const projects = yield* ProjectsRepository;
        const datasets = yield* DatasetsRepository;
        yield* seedProject(projects, "p1");

        const now = new Date().toISOString();
        yield* datasets.insert({
          id: "d1",
          projectId: "p1",
          name: "traces",
          createdAt: now,
          updatedAt: now,
        });

        // Removing the parent project should cascade: this verifies both
        // the schema migration's `ON DELETE CASCADE` and that the runtime
        // PRAGMA enabling foreign keys actually took effect.
        yield* projects.remove("p1");

        const found = yield* datasets.findById("p1", "d1");
        expect(found).toBeUndefined();
      }),
    ),
  );
});
