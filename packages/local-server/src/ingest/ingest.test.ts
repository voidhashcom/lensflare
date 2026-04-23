import { DuckDBInstance } from "@duckdb/node-api";
import { describe, expect, it } from "@effect/vitest";
import { decodeTelemetryLogEntries } from "@lensflare/contracts";
import { Effect, Layer } from "effect";
import { gzipSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalServer } from "../index.ts";
import { makeSqliteDatabaseLayer } from "../db/database.ts";
import { encodeOtlpRequestForTest } from "./providers/otlp/testSupport.ts";
import { DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { ProjectsRepository } from "../repositories/projectsRepository.ts";
import { DatasetService } from "../services/datasetService.ts";
import { ProjectService } from "../services/projectService.ts";

const otelDisabled = {
  enabled: false,
  projectName: "Disabled",
  projectSlug: "disabled",
  datasetName: "Disabled",
  datasetSlug: "disabled",
} as const;

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate test port.")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

const sqliteLayerFor = (sqliteDatabaseFile: string) =>
  ProjectService.layer.pipe(
    Layer.provideMerge(DatasetService.layer),
    Layer.provide(ProjectsRepository.layer),
    Layer.provide(DatasetsRepository.layer),
    Layer.provide(makeSqliteDatabaseLayer(sqliteDatabaseFile)),
  );

async function seedProjectAndDataset(sqliteDatabaseFile: string) {
  return seedNamedProjectAndDataset(sqliteDatabaseFile, {
    projectName: "Lensflare",
    datasetName: "traces",
  });
}

async function seedNamedProjectAndDataset(
  sqliteDatabaseFile: string,
  args: {
    readonly projectName: string;
    readonly datasetName: string;
  },
) {
  return Effect.gen(function* () {
    const projects = yield* ProjectService;
    const datasets = yield* DatasetService;

    const project = yield* projects.createProject({ name: args.projectName });
    const dataset = yield* datasets.createDataset(project.id, { name: args.datasetName });

    return { project, dataset };
  }).pipe(Effect.provide(sqliteLayerFor(sqliteDatabaseFile)), Effect.runPromise);
}

async function listProjectsAndDatasets(sqliteDatabaseFile: string) {
  return Effect.gen(function* () {
    const projects = yield* ProjectService;
    const datasets = yield* DatasetService;

    return {
      projects: yield* projects.listProjects(),
      datasets: yield* datasets.listDatasets(),
    };
  }).pipe(Effect.provide(sqliteLayerFor(sqliteDatabaseFile)), Effect.runPromise);
}

async function queryDuckDb(
  duckdbDatabaseFile: string,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const instance = await DuckDBInstance.create(duckdbDatabaseFile);
  const connection = await instance.connect();

  try {
    const reader = await connection.runAndReadAll(sql);
    await reader.readAll();
    return reader
      .getRowObjectsJson()
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value,
          ]),
        ),
      );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

describe("HTTP ingest", () => {
  it("ingests OTLP JSON logs into DuckDB", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-ingest-"));
    const sqliteDatabaseFile = join(directory, "lensflare.sqlite");
    const duckdbDatabaseFile = join(directory, "lensflare.duckdb");
    const port = await getAvailablePort();

    const { project, dataset } = await seedProjectAndDataset(sqliteDatabaseFile);
    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile,
      duckdbDatabaseFile,
      otel: otelDisabled,
    });

    try {
      const response = await fetch(`${server.origin}/ingest/otlp/v1/logs/lensflare/traces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          resourceLogs: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: "api" },
                  },
                ],
              },
              scopeLogs: [
                {
                  scope: { name: "tests", version: "1.0.0" },
                  logRecords: [
                    {
                      timeUnixNano: "1716201600000000000",
                      severityNumber: 9,
                      severityText: "INFO",
                      body: { stringValue: "hello from otlp json" },
                      attributes: [
                        {
                          key: "env",
                          value: { stringValue: "dev" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");

      const batches = await queryDuckDb(
        duckdbDatabaseFile,
        "SELECT accepted_records, project_slug, dataset_slug FROM ingest_batches",
      );
      expect(batches).toEqual([
        {
          accepted_records: 1,
          project_slug: "lensflare",
          dataset_slug: "traces",
        },
      ]);

      const records = await queryDuckDb(
        duckdbDatabaseFile,
        "SELECT body_text, service_name, severity_number FROM log_records",
      );
      expect(records).toEqual([
        {
          body_text: "hello from otlp json",
          service_name: "api",
          severity_number: 9,
        },
      ]);

      const logResponse = await fetch(
        `${server.origin}/api/projects/${project.id}/datasets/${dataset.id}/logs`,
      );

      expect(logResponse.status).toBe(200);
      expect(logResponse.headers.get("content-type")).toContain("application/json");

      const logEntries = decodeTelemetryLogEntries(await logResponse.json());
      expect(logEntries).toEqual([
        expect.objectContaining({
          sourceName: "api",
          level: "info",
          message: "hello from otlp json",
        }),
      ]);
    } finally {
      await Promise.all([server.stop(), rm(directory, { recursive: true, force: true })]);
    }
  });

  it("ingests gzipped OTLP protobuf logs and matches the protobuf response type", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-ingest-"));
    const sqliteDatabaseFile = join(directory, "lensflare.sqlite");
    const duckdbDatabaseFile = join(directory, "lensflare.duckdb");
    const port = await getAvailablePort();

    await seedProjectAndDataset(sqliteDatabaseFile);
    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile,
      duckdbDatabaseFile,
      otel: otelDisabled,
    });

    try {
      const payload = gzipSync(
        encodeOtlpRequestForTest({
          resourceLogs: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: "api" },
                  },
                ],
              },
              scopeLogs: [
                {
                  scope: { name: "tests", version: "1.0.0" },
                  logRecords: [
                    {
                      timeUnixNano: "1716201600000000000",
                      severityNumber: 9,
                      severityText: "INFO",
                      body: { stringValue: "hello from protobuf" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );

      const response = await fetch(`${server.origin}/ingest/otlp/v1/logs/lensflare/traces`, {
        method: "POST",
        headers: {
          "content-type": "application/x-protobuf",
          "content-encoding": "gzip",
        },
        body: payload,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-protobuf");

      const counts = await queryDuckDb(
        duckdbDatabaseFile,
        "SELECT COUNT(*) AS batches, (SELECT COUNT(*) FROM log_records) AS records FROM ingest_batches",
      );
      expect(counts).toEqual([
        {
          batches: 1,
          records: 1,
        },
      ]);
    } finally {
      await Promise.all([server.stop(), rm(directory, { recursive: true, force: true })]);
    }
  });

  it("ignores Lensflare self-telemetry posted back into lensflare/dev without dropping normal dev logs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-ingest-"));
    const sqliteDatabaseFile = join(directory, "lensflare.sqlite");
    const duckdbDatabaseFile = join(directory, "lensflare.duckdb");
    const port = await getAvailablePort();

    await seedNamedProjectAndDataset(sqliteDatabaseFile, {
      projectName: "Lensflare",
      datasetName: "dev",
    });
    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile,
      duckdbDatabaseFile,
      otel: otelDisabled,
    });

    try {
      const selfResponse = await fetch(`${server.origin}/ingest/otlp/v1/logs/lensflare/dev`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          resourceLogs: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: "lensflare-server" },
                  },
                ],
              },
              scopeLogs: [
                {
                  scope: { name: "tests", version: "1.0.0" },
                  logRecords: [
                    {
                      timeUnixNano: "1716201600000000000",
                      severityNumber: 9,
                      severityText: "INFO",
                      body: { stringValue: "loop me back" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      });

      expect(selfResponse.status).toBe(200);
      expect(await selfResponse.json()).toEqual({
        partialSuccess: {
          rejectedLogRecords: 1,
          errorMessage:
            "Ignored 1 Lensflare self-telemetry record(s) sent to lensflare/dev to prevent an ingest loop.",
        },
      });

      const normalResponse = await fetch(`${server.origin}/ingest/otlp/v1/logs/lensflare/dev`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          resourceLogs: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: "api" },
                  },
                ],
              },
              scopeLogs: [
                {
                  scope: { name: "tests", version: "1.0.0" },
                  logRecords: [
                    {
                      timeUnixNano: "1716201600000000000",
                      severityNumber: 9,
                      severityText: "INFO",
                      body: { stringValue: "hello from dev" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      });

      expect(normalResponse.status).toBe(200);
      expect(await normalResponse.json()).toEqual({});

      // Querying the DuckDB file from a second process mid-test can hide
      // subsequent writes from the server's long-lived instance. Assert the
      // final persisted state instead of probing between the two requests.
      const finalCounts = await queryDuckDb(
        duckdbDatabaseFile,
        "SELECT COUNT(*) AS batches, (SELECT COUNT(*) FROM log_records) AS records FROM ingest_batches",
      );
      expect(finalCounts).toEqual([
        {
          batches: 1,
          records: 1,
        },
      ]);

      const records = await queryDuckDb(
        duckdbDatabaseFile,
        "SELECT body_text, service_name, dataset_slug FROM log_records",
      );
      expect(records).toEqual([
        {
          body_text: "hello from dev",
          service_name: "api",
          dataset_slug: "dev",
        },
      ]);
    } finally {
      await Promise.all([server.stop(), rm(directory, { recursive: true, force: true })]);
    }
  });

  it("ingests Axiom native JSON and logs failures without persisting rejected requests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-ingest-"));
    const sqliteDatabaseFile = join(directory, "lensflare.sqlite");
    const duckdbDatabaseFile = join(directory, "lensflare.duckdb");
    const port = await getAvailablePort();

    await seedProjectAndDataset(sqliteDatabaseFile);
    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile,
      duckdbDatabaseFile,
      otel: otelDisabled,
    });

    const errors: Array<string> = [];
    const originalError = console.error;
    console.error = (message?: unknown, ...args: Array<unknown>) => {
      errors.push([message, ...args].map((part) => String(part)).join(" "));
    };

    try {
      const success = await fetch(`${server.origin}/ingest/axiom/v1/ingest/traces`, {
        method: "POST",
        headers: {
          authorization: "Bearer lensflare",
          "content-type": "application/json",
        },
        body: JSON.stringify([
          {
            time: "2026-04-22T16:00:00.000Z",
            data: { message: "hello from axiom" },
            labels: { service: "api" },
            level: "info",
          },
        ]),
      });

      expect(success.status).toBe(200);
      expect(await success.json()).toMatchObject({
        ingested: 1,
        failed: 0,
        blocksCreated: 0,
      });

      const failure = await fetch(`${server.origin}/ingest/axiom/v1/ingest/unknown`, {
        method: "POST",
        headers: {
          authorization: "Bearer lensflare",
          "content-type": "application/json",
        },
        body: JSON.stringify([{ message: "bad dataset" }]),
      });

      expect(failure.status).toBe(404);

      const counts = await queryDuckDb(
        duckdbDatabaseFile,
        "SELECT COUNT(*) AS batches, (SELECT COUNT(*) FROM log_records) AS records FROM ingest_batches",
      );
      expect(counts).toEqual([
        {
          batches: 1,
          records: 1,
        },
      ]);

      expect(errors).toHaveLength(1);
      expect(JSON.parse(errors[0] ?? "{}")).toMatchObject({
        source: "lensflare.ingest",
        provider: "axiom_native",
        datasetSlug: "unknown",
        errorCategory: "UnknownDatasetSlug",
      });
    } finally {
      console.error = originalError;
      await Promise.all([server.stop(), rm(directory, { recursive: true, force: true })]);
    }
  });

  it("bootstraps the internal telemetry dataset and exports startup and HTTP logs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-ingest-"));
    const sqliteDatabaseFile = join(directory, "lensflare.sqlite");
    const duckdbDatabaseFile = join(directory, "lensflare.duckdb");
    const port = await getAvailablePort();

    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile,
      duckdbDatabaseFile,
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 1_250));
      const healthResponse = await fetch(`${server.origin}/api/health`);
      expect(healthResponse.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 1_250));

      const { projects, datasets } = await listProjectsAndDatasets(sqliteDatabaseFile);
      const telemetryProject = projects.find((project) => project.slug === "lensflare-internal");
      const telemetryDataset = datasets.find((dataset) => dataset.slug === "runtime-logs");

      expect(telemetryProject).toBeDefined();
      expect(telemetryDataset).toBeDefined();
      expect(telemetryDataset?.projectId).toBe(telemetryProject?.id);

      const records = await queryDuckDb(
        duckdbDatabaseFile,
        `
          SELECT body_text, service_name, dataset_slug, attributes_json
          FROM log_records
          WHERE dataset_slug = 'runtime-logs'
          ORDER BY ingested_at ASC, id ASC
        `,
      );

      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            service_name: "lensflare-server",
            dataset_slug: "runtime-logs",
          }),
        ]),
      );
      expect(
        records.some((record) =>
          String(record.body_text ?? "").includes("lensflare server listening"),
        ),
      ).toBe(true);
      expect(
        records.some((record) => {
          if (record.body_text !== "Sent HTTP response") {
            return false;
          }

          const attributes =
            typeof record.attributes_json === "string"
              ? JSON.parse(record.attributes_json)
              : record.attributes_json;

          return attributes?.["http.url"] === "/api/health" && attributes?.["http.status"] === 200;
        }),
      ).toBe(true);
    } finally {
      await Promise.all([server.stop(), rm(directory, { recursive: true, force: true })]);
    }
  });
});
