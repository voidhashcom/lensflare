import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_PROJECT_ICON } from "@lensflare/contracts";
import { Effect, Layer } from "effect";
import { dirname, join } from "node:path";
import { withTempDirectory } from "../_internal/testSupport.ts";
import { makeSqliteDatabaseLayer } from "../db/database.ts";
import { TelemetryStore } from "../ingest/telemetryStore.ts";
import { DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { ProjectsRepository } from "../repositories/projectsRepository.ts";
import { DatasetService } from "./datasetService.ts";
import { ProjectService } from "./projectService.ts";

// ProjectService depends on DatasetService for cascade-delete event
// fan-out, so DatasetService is `provideMerge`-ed underneath it — that
// resolves the in-layer dependency while keeping both services in the
// merged output. Repositories, event buses, and the database are sealed
// below the pair.
const buildLayer = (sqliteDatabaseFile: string) =>
  ProjectService.layer.pipe(
    Layer.provideMerge(DatasetService.layer),
    Layer.provide(ProjectsRepository.layer),
    Layer.provide(DatasetsRepository.layer),
    Layer.provide(makeSqliteDatabaseLayer(sqliteDatabaseFile)),
    Layer.provide(TelemetryStore.layer(join(dirname(sqliteDatabaseFile), "lensflare.duckdb"))),
  );

describe("ProjectService", () => {
  it.effect("creates, updates, lists, and deletes projects", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const service = yield* ProjectService;

        const created = yield* service.createProject({ name: "  Lensflare  " });
        expect(created.name).toBe("Lensflare");
        expect(created.slug).toBe("lensflare");
        expect(created.icon).toBe(DEFAULT_PROJECT_ICON);
        expect(created.datasets).toEqual([]);

        const listed = yield* service.listProjects();
        expect(listed).toHaveLength(1);
        expect(listed[0]?.id).toBe(created.id);

        const updated = yield* service.updateProject(created.id, {
          icon: "rocket",
          name: "Lensflare API",
        });
        expect(updated.name).toBe("Lensflare API");
        expect(updated.slug).toBe("lensflare");
        expect(updated.icon).toBe("rocket");

        yield* service.deleteProject(created.id);

        const afterDelete = yield* service.listProjects();
        expect(afterDelete).toEqual([]);
      }),
    ),
  );

  it.effect("rejects empty project names with a ValidationError", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const service = yield* ProjectService;

        const error = yield* Effect.flip(service.createProject({ name: "   " }));

        expect(error._tag).toBe("ValidationError");
      }),
    ),
  );

  it.effect("cascades dataset deletes when a project is deleted", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const projectService = yield* ProjectService;
        const datasetService = yield* DatasetService;

        const project = yield* projectService.createProject({ name: "Lensflare" });
        const dataset = yield* datasetService.createDataset(project.id, {
          name: "traces",
        });

        yield* projectService.deleteProject(project.id);

        const remaining = yield* datasetService.listDatasets();
        expect(remaining.find((row) => row.id === dataset.id)).toBeUndefined();
      }),
    ),
  );
});
