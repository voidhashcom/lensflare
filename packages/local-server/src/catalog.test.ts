import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_PROJECT_ICON } from "@lensflare/contracts";
import { Effect } from "effect";
import { CatalogStore, makeCatalogStoreLayer } from "./catalog.ts";

function withTestCatalog<A, E>(program: Effect.Effect<A, E, CatalogStore>) {
  return Effect.acquireUseRelease(
    Effect.tryPromise(() => mkdtemp(join(tmpdir(), "lensflare-catalog-"))),
    (directory) =>
      program.pipe(Effect.provide(makeCatalogStoreLayer(join(directory, "catalog.sqlite")))),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  );
}

describe("CatalogStore", () => {
  it.effect("creates, updates, lists, and deletes projects", () =>
    withTestCatalog(
      Effect.gen(function* () {
        const store = yield* CatalogStore;

        const created = yield* store.createProject({ name: "  Lensflare  " });
        expect(created.name).toBe("Lensflare");
        expect(created.icon).toBe(DEFAULT_PROJECT_ICON);
        expect(created.datasets).toEqual([]);

        const listed = yield* store.listProjects();
        expect(listed).toHaveLength(1);
        expect(listed[0]?.id).toBe(created.id);

        const updated = yield* store.updateProject(created.id, {
          icon: "rocket",
          name: "Lensflare API",
        });
        expect(updated.name).toBe("Lensflare API");
        expect(updated.icon).toBe("rocket");

        yield* store.deleteProject(created.id);

        const afterDelete = yield* store.listProjects();
        expect(afterDelete).toEqual([]);
      }),
    ),
  );

  it.effect("creates, updates, and deletes datasets under a project", () =>
    withTestCatalog(
      Effect.gen(function* () {
        const store = yield* CatalogStore;

        const project = yield* store.createProject({ name: "Lensflare" });
        const dataset = yield* store.createDataset(project.id, {
          name: "  traces  ",
        });

        expect(dataset.projectId).toBe(project.id);
        expect(dataset.name).toBe("traces");

        const fetchedProject = yield* store.getProject(project.id);
        expect(fetchedProject.datasets).toHaveLength(1);
        expect(fetchedProject.datasets[0]?.id).toBe(dataset.id);

        const updated = yield* store.updateDataset(project.id, dataset.id, {
          name: "spans",
        });
        expect(updated.name).toBe("spans");

        yield* store.deleteDataset(project.id, dataset.id);

        const afterDelete = yield* store.getProject(project.id);
        expect(afterDelete.datasets).toEqual([]);
      }),
    ),
  );
});
