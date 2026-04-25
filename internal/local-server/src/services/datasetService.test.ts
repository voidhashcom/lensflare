import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { dirname, join } from "node:path";
import { withTempDirectory } from "../_internal/testSupport.ts";
import { makeSqliteDatabaseLayer } from "../db/database.ts";
import { TelemetryStore } from "../ingest/telemetryStore.ts";
import { DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { ProjectsRepository } from "../repositories/projectsRepository.ts";
import { DatasetService } from "./datasetService.ts";
import { ProjectService } from "./projectService.ts";

const buildLayer = (sqliteDatabaseFile: string) =>
  ProjectService.layer.pipe(
    Layer.provideMerge(DatasetService.layer),
    Layer.provide(ProjectsRepository.layer),
    Layer.provide(DatasetsRepository.layer),
    Layer.provide(makeSqliteDatabaseLayer(sqliteDatabaseFile)),
    Layer.provide(TelemetryStore.layer(join(dirname(sqliteDatabaseFile), "lensflare.duckdb"))),
  );

describe("DatasetService", () => {
  it.effect("creates the managed dataset with the project slug", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const projectService = yield* ProjectService;

        const project = yield* projectService.createProject({ name: "  Lensflare  " });

        expect(project.datasets).toHaveLength(1);
        expect(project.datasets[0]).toMatchObject({
          name: "Lensflare",
          projectId: project.id,
          slug: "lensflare",
        });
      }),
    ),
  );

  it.effect("returns ProjectNotFound when syncing a dataset for a missing project", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const datasetService = yield* DatasetService;

        const error = yield* Effect.flip(
          datasetService.ensureProjectDataset("nonexistent-project", "Lensflare", "lensflare"),
        );

        expect(error._tag).toBe("ProjectNotFound");
      }),
    ),
  );

  it.effect("keeps the managed dataset aligned with project updates", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const projectService = yield* ProjectService;
        const datasetService = yield* DatasetService;

        const project = yield* projectService.createProject({ name: "Lensflare" });
        const datasetId = project.datasets[0]?.id ?? "";

        const updatedProject = yield* projectService.updateProject(project.id, {
          name: "Observability",
          slug: "observability",
        });
        const updatedDataset = yield* datasetService.getDataset(project.id, datasetId);

        expect(updatedProject.datasets).toHaveLength(1);
        expect(updatedProject.datasets[0]?.slug).toBe("observability");
        expect(updatedDataset.name).toBe("Observability");
        expect(updatedDataset.slug).toBe("observability");
      }),
    ),
  );
});
