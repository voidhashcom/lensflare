import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSqliteDatabaseLayer } from "../db/database.ts";
import { DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { ProjectsRepository } from "../repositories/projectsRepository.ts";
import { TelemetryFilterCatalogRepository } from "../repositories/telemetryFilterCatalogRepository.ts";
import { TelemetryFilterCatalogService } from "./telemetryFilterCatalogService.ts";
import { TelemetryStore } from "./telemetryStore.ts";
import type { IngestWriteRequest } from "./types.ts";

describe("TelemetryFilterCatalogService", () => {
  it.effect("persists catalog entries across fresh runtimes", () =>
    Effect.acquireUseRelease(
      Effect.tryPromise(() => mkdtemp(join(tmpdir(), "lensflare-filter-catalog-"))).pipe(
        Effect.orDie,
      ),
      (directory) =>
        Effect.gen(function* () {
          const databaseFile = join(directory, "catalog.sqlite");
          const runtime1 = ManagedRuntime.make(buildLayer(databaseFile), {
            memoMap: Layer.makeMemoMapUnsafe(),
          });

          try {
            yield* Effect.tryPromise(() =>
              runtime1.runPromise(
                Effect.gen(function* () {
                  const projects = yield* ProjectsRepository;
                  const datasets = yield* DatasetsRepository;
                  const catalog = yield* TelemetryFilterCatalogService;
                  const now = new Date().toISOString();

                  yield* projects.insert({
                    id: "project-1",
                    name: "Project 1",
                    slug: "project-1",
                    icon: "folder",
                    createdAt: now,
                    updatedAt: now,
                  });
                  yield* datasets.insert({
                    id: "dataset-1",
                    projectId: "project-1",
                    name: "Dataset 1",
                    slug: "dataset-1",
                    createdAt: now,
                    updatedAt: now,
                  });

                  yield* catalog.applyLogBatch(logRequest());
                }),
              ),
            );
          } finally {
            yield* Effect.promise(() => runtime1.dispose());
          }

          const runtime2 = ManagedRuntime.make(buildLayer(databaseFile), {
            memoMap: Layer.makeMemoMapUnsafe(),
          });

          try {
            const entries = yield* Effect.tryPromise(() =>
              runtime2.runPromise(
                Effect.gen(function* () {
                  const catalog = yield* TelemetryFilterCatalogService;
                  return yield* catalog.listDatasetCatalog("project-1", "dataset-1");
                }),
              ),
            );

            const byLabel = new Map(entries.map((entry) => [entry.label, entry]));
            expect(byLabel.get("serviceName")?.values).toEqual(["api"]);
            expect(byLabel.get("attributes.http.method")?.values).toEqual(["GET"]);
            expect(byLabel.get("severityNumber")?.frequency).toBe(1);
            expect(byLabel.get("status")?.values).toEqual(["error", "ok", "unset"]);
          } finally {
            yield* Effect.promise(() => runtime2.dispose());
          }
        }),
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    ),
  );
});

function buildLayer(sqliteDatabaseFile: string) {
  const databaseLayer = makeSqliteDatabaseLayer(sqliteDatabaseFile);
  const datasetsLayer = DatasetsRepository.layer.pipe(Layer.provide(databaseLayer));
  const projectsLayer = ProjectsRepository.layer.pipe(Layer.provide(databaseLayer));
  const catalogRepositoryLayer = TelemetryFilterCatalogRepository.layer.pipe(
    Layer.provide(databaseLayer),
  );

  return Layer.mergeAll(
    projectsLayer,
    datasetsLayer,
    catalogRepositoryLayer,
    TelemetryFilterCatalogService.layer.pipe(
      Layer.provide(telemetryStoreTestLayer),
      Layer.provide(catalogRepositoryLayer),
      Layer.provide(datasetsLayer),
    ),
  );
}

const telemetryStoreTestLayer = Layer.succeed(TelemetryStore, {
  execute: () => Effect.succeed(undefined),
  queryRows: () => Effect.succeed([]),
  withTransaction: () => Effect.die("not implemented"),
  getStorageStats: () => Effect.succeed({ datasetId: "dataset-1", bytes: 0 }),
  clearDataset: () => Effect.succeed(undefined),
});

function logRequest(): IngestWriteRequest {
  return {
    providerKind: "otlp_http_logs",
    signal: "logs",
    projectId: "project-1",
    projectSlug: "project-1",
    datasetId: "dataset-1",
    datasetSlug: "dataset-1",
    requestContentType: "application/json",
    requestContentEncoding: null,
    requestBytes: 1,
    clientAddr: null,
    receivedAt: "2026-01-01T00:00:00.000Z",
    records: [
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        observedTimestamp: null,
        traceId: "trace-1",
        spanId: "span-1",
        traceFlags: 1,
        severityNumber: 9,
        severityText: "INFO",
        serviceName: "api",
        body: "hello",
        resourceSchemaUrl: "",
        resourceAttributes: {},
        scopeSchemaUrl: "",
        scopeName: "test",
        scopeVersion: "1.0.0",
        scopeAttributes: {},
        logAttributes: {
          "http.method": "GET",
        },
      },
    ],
  };
}
