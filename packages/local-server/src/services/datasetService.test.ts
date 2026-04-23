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

// Each dataset spec needs a real parent project, so ProjectService is
// provided alongside DatasetService. ProjectService also requires
// DatasetService for its cascade wiring, so DatasetService is
// `provideMerge`-ed underneath ProjectService to resolve the in-layer
// dependency while keeping both services in the merged output.
const buildLayer = (sqliteDatabaseFile: string) =>
  ProjectService.layer.pipe(
    Layer.provideMerge(DatasetService.layer),
    Layer.provide(ProjectsRepository.layer),
    Layer.provide(DatasetsRepository.layer),
    Layer.provide(makeSqliteDatabaseLayer(sqliteDatabaseFile)),
    Layer.provide(TelemetryStore.layer(join(dirname(sqliteDatabaseFile), "lensflare.duckdb"))),
  );

describe("DatasetService", () => {
  it.effect("creates, updates, and deletes datasets under a project", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const projectService = yield* ProjectService;
        const datasetService = yield* DatasetService;

        const project = yield* projectService.createProject({ name: "Lensflare" });
        const dataset = yield* datasetService.createDataset(project.id, {
          name: "  traces  ",
        });

        expect(dataset.projectId).toBe(project.id);
        expect(dataset.name).toBe("traces");
        expect(dataset.slug).toBe("lensflare-traces");

        const fetchedProject = yield* projectService.getProject(project.id);
        expect(fetchedProject.datasets).toHaveLength(1);
        expect(fetchedProject.datasets[0]?.id).toBe(dataset.id);

        const updated = yield* datasetService.updateDataset(project.id, dataset.id, {
          name: "spans",
        });
        expect(updated.name).toBe("spans");
        expect(updated.slug).toBe("lensflare-traces");

        yield* datasetService.deleteDataset(project.id, dataset.id);

        const afterDelete = yield* projectService.getProject(project.id);
        expect(afterDelete.datasets).toEqual([]);
      }),
    ),
  );

  it.effect("returns ProjectNotFound when creating a dataset for a missing project", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const datasetService = yield* DatasetService;

        const error = yield* Effect.flip(
          datasetService.createDataset("nonexistent-project", { name: "traces" }),
        );

        expect(error._tag).toBe("ProjectNotFound");
      }),
    ),
  );

  it.effect("prefixes dataset tags with the owning project slug", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const projectService = yield* ProjectService;
        const datasetService = yield* DatasetService;

        const alpha = yield* projectService.createProject({ name: "Alpha" });
        const beta = yield* projectService.createProject({ name: "Beta" });

        const alphaDataset = yield* datasetService.createDataset(alpha.id, { name: "traces" });
        const betaDataset = yield* datasetService.createDataset(beta.id, { name: "traces" });

        expect(alphaDataset.slug).toBe("alpha-traces");
        expect(betaDataset.slug).toBe("beta-traces");
      }),
    ),
  );

  it.effect("rebases dataset tags when a project slug changes", () =>
    withTempDirectory(
      buildLayer,
      Effect.gen(function* () {
        const projectService = yield* ProjectService;
        const datasetService = yield* DatasetService;

        const project = yield* projectService.createProject({ name: "Lensflare" });
        const dataset = yield* datasetService.createDataset(project.id, { name: "traces" });

        const updatedProject = yield* projectService.updateProject(project.id, {
          slug: "observability",
        });
        const updatedDataset = yield* datasetService.getDataset(project.id, dataset.id);

        expect(updatedProject.datasets[0]?.slug).toBe("observability-traces");
        expect(updatedDataset.slug).toBe("observability-traces");
      }),
    ),
  );
});
