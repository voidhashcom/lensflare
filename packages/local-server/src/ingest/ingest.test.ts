import { DuckDBInstance } from "@duckdb/node-api";
import { describe, expect, it } from "@effect/vitest";
import {
  decodeTelemetryLogPage,
  decodeTelemetryRecordPage,
  decodeTelemetryTraceContext,
  Filter,
} from "@lensflare/contracts";
import { Effect, Layer } from "effect";
import { gzipSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startLocalServer } from "../index.ts";
import { makeSqliteDatabaseLayer } from "../db/database.ts";
import { datasetDuckDbDatabaseFile, TelemetryStore } from "./telemetryStore.ts";
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
    Layer.provide(TelemetryStore.layer(join(dirname(sqliteDatabaseFile), "lensflare.duckdb"))),
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

async function queryDuckDb(
  duckdbDatabaseFile: string,
  datasetId: string,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const instance = await DuckDBInstance.create(
    datasetDuckDbDatabaseFile(duckdbDatabaseFile, datasetId),
  );
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
        dataset.id,
        "SELECT accepted_records, project_slug, dataset_slug FROM ingest_batches",
      );
      expect(batches).toEqual([
        {
          accepted_records: 1,
          project_slug: "lensflare",
          dataset_slug: "lensflare-traces",
        },
      ]);

      const records = await queryDuckDb(
        duckdbDatabaseFile,
        dataset.id,
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

      const logPage = decodeTelemetryLogPage(await logResponse.json());
      expect(logPage.entries).toEqual([
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

  it("ingests OTLP JSON spans and returns trace context for traced logs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-ingest-"));
    const sqliteDatabaseFile = join(directory, "lensflare.sqlite");
    const duckdbDatabaseFile = join(directory, "lensflare.duckdb");
    const port = await getAvailablePort();
    const traceId = "0af7651916cd43dd8448eb211c80319c";
    const rootSpanId = "b7ad6b7169203331";
    const childSpanId = "1111111111111111";
    const grandchildSpanId = "2222222222222222";
    const siblingSpanId = "3333333333333333";

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
      const traceResponse = await fetch(`${server.origin}/ingest/otlp/v1/traces/lensflare/traces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          resourceSpans: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: "api" },
                  },
                ],
              },
              scopeSpans: [
                {
                  scope: { name: "tests", version: "1.0.0" },
                  spans: [
                    {
                      traceId,
                      spanId: rootSpanId,
                      name: "GET /checkout",
                      kind: "SPAN_KIND_SERVER",
                      startTimeUnixNano: "1716201600000000000",
                      endTimeUnixNano: "1716201600200000000",
                      status: { code: "STATUS_CODE_OK" },
                    },
                    {
                      traceId,
                      spanId: childSpanId,
                      parentSpanId: rootSpanId,
                      name: "SELECT orders",
                      kind: "SPAN_KIND_CLIENT",
                      startTimeUnixNano: "1716201600010000000",
                      endTimeUnixNano: "1716201600085000000",
                      status: { code: "STATUS_CODE_ERROR", message: "timeout" },
                      events: [
                        {
                          timeUnixNano: "1716201600070000000",
                          name: "exception",
                          attributes: [
                            {
                              key: "exception.type",
                              value: { stringValue: "TimeoutError" },
                            },
                            {
                              key: "exception.message",
                              value: { stringValue: "query timed out" },
                            },
                          ],
                        },
                      ],
                    },
                    {
                      traceId,
                      spanId: grandchildSpanId,
                      parentSpanId: childSpanId,
                      name: "decode rows",
                      kind: "SPAN_KIND_INTERNAL",
                      startTimeUnixNano: "1716201600030000000",
                      endTimeUnixNano: "1716201600040000000",
                      status: { code: "STATUS_CODE_OK" },
                    },
                    {
                      traceId,
                      spanId: siblingSpanId,
                      parentSpanId: rootSpanId,
                      name: "publish response",
                      kind: "SPAN_KIND_INTERNAL",
                      startTimeUnixNano: "1716201600020000000",
                      endTimeUnixNano: "1716201600035000000",
                      status: { code: "STATUS_CODE_OK" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      });
      expect(traceResponse.status).toBe(200);

      const logResponse = await fetch(`${server.origin}/ingest/otlp/v1/logs/lensflare/traces`, {
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
                      timeUnixNano: "1716201600060000000",
                      traceId,
                      spanId: childSpanId,
                      severityNumber: 17,
                      severityText: "ERROR",
                      body: { stringValue: "query failed" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      });
      expect(logResponse.status).toBe(200);

      const pageResponse = await fetch(
        `${server.origin}/api/projects/${project.id}/datasets/${dataset.id}/logs`,
      );
      expect(pageResponse.status).toBe(200);

      const logPage = decodeTelemetryLogPage(await pageResponse.json());
      expect(logPage.entries).toEqual([
        expect.objectContaining({
          traceId,
          spanId: childSpanId,
          level: "error",
          message: "query failed",
        }),
      ]);

      const traceContextResponse = await fetch(
        `${server.origin}/api/projects/${project.id}/datasets/${dataset.id}/traces/${traceId}?spanId=${childSpanId}`,
      );
      expect(traceContextResponse.status).toBe(200);

      const traceContext = decodeTelemetryTraceContext(await traceContextResponse.json());
      expect(traceContext).toMatchObject({
        traceId,
        currentSpanId: childSpanId,
        totalDurationUs: 200_000,
        spans: [
          expect.objectContaining({
            id: rootSpanId,
            parentSpanId: null,
            name: "GET /checkout",
            serviceName: "api",
            status: "ok",
          }),
          expect.objectContaining({
            id: childSpanId,
            parentSpanId: rootSpanId,
            name: "SELECT orders",
            serviceName: "api",
            startOffsetUs: 10_000,
            durationUs: 75_000,
            status: "error",
          }),
          expect.objectContaining({
            id: grandchildSpanId,
            parentSpanId: childSpanId,
            name: "decode rows",
            serviceName: "api",
            startOffsetUs: 30_000,
            durationUs: 10_000,
            status: "ok",
          }),
          expect.objectContaining({
            id: siblingSpanId,
            parentSpanId: rootSpanId,
            name: "publish response",
            serviceName: "api",
            startOffsetUs: 20_000,
            durationUs: 15_000,
            status: "ok",
          }),
        ],
      });
      expect(traceContext?.spans.map((span) => span.id)).toEqual([
        rootSpanId,
        childSpanId,
        grandchildSpanId,
        siblingSpanId,
      ]);
      expect(traceContext?.spans.find((span) => span.id === childSpanId)?.events).toEqual([
        expect.objectContaining({
          name: "exception",
          attributes: expect.objectContaining({
            "exception.type": "TimeoutError",
          }),
        }),
      ]);

      const eventRecords = await queryDuckDb(
        duckdbDatabaseFile,
        dataset.id,
        "SELECT name, trace_id, span_id FROM span_event_records",
      );
      expect(eventRecords).toEqual([
        {
          name: "exception",
          trace_id: traceId,
          span_id: Number(childSpanId),
        },
      ]);

      const telemetryFilter = encodeURIComponent(
        JSON.stringify(
          Filter.and([
            Filter.cmp(["kind"], "eq", Filter.stringValue("span")),
            Filter.cmp(["status"], "eq", Filter.stringValue("error")),
            Filter.cmp(
              ["relatedEvents", "attributes", "exception.type"],
              "contains",
              Filter.stringValue("TimeoutError"),
            ),
          ]),
        ),
      );
      const telemetryResponse = await fetch(
        `${server.origin}/api/projects/${project.id}/datasets/${dataset.id}/telemetry?filter=${telemetryFilter}`,
      );
      expect(telemetryResponse.status).toBe(200);

      const telemetryPage = decodeTelemetryRecordPage(await telemetryResponse.json());
      expect(telemetryPage.entries).toEqual([
        expect.objectContaining({
          kind: "span",
          spanId: childSpanId,
          status: "error",
          events: [
            expect.objectContaining({
              name: "exception",
            }),
          ],
        }),
      ]);
    } finally {
      await Promise.all([server.stop(), rm(directory, { recursive: true, force: true })]);
    }
  });

  it("paginates dataset logs with stable cursors", async () => {
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
                  logRecords: Array.from({ length: 5 }, (_, index) => ({
                    timeUnixNano: String(
                      1_716_201_600_000_000_000n + BigInt(index) * 1_000_000_000n,
                    ),
                    severityNumber: 9,
                    severityText: "INFO",
                    body: { stringValue: `log-${index}` },
                  })),
                },
              ],
            },
          ],
        }),
      });

      expect(response.status).toBe(200);

      const latestResponse = await fetch(
        `${server.origin}/api/projects/${project.id}/datasets/${dataset.id}/logs?limit=2`,
      );
      expect(latestResponse.status).toBe(200);

      const latestPage = decodeTelemetryLogPage(await latestResponse.json());
      expect(latestPage.entries.map((entry) => entry.message)).toEqual(["log-3", "log-4"]);
      expect(latestPage.pageInfo.hasPreviousPage).toBe(true);
      expect(latestPage.pageInfo.startCursor).toEqual(expect.any(String));
      expect(latestPage.pageInfo.endCursor).toEqual(expect.any(String));

      const olderResponse = await fetch(
        `${server.origin}/api/projects/${project.id}/datasets/${dataset.id}/logs?limit=2&direction=older&cursor=${encodeURIComponent(latestPage.pageInfo.startCursor ?? "")}`,
      );
      expect(olderResponse.status).toBe(200);

      const olderPage = decodeTelemetryLogPage(await olderResponse.json());
      expect(olderPage.entries.map((entry) => entry.message)).toEqual(["log-1", "log-2"]);
      expect(olderPage.pageInfo.hasPreviousPage).toBe(true);

      const oldestResponse = await fetch(
        `${server.origin}/api/projects/${project.id}/datasets/${dataset.id}/logs?limit=2&direction=older&cursor=${encodeURIComponent(olderPage.pageInfo.startCursor ?? "")}`,
      );
      expect(oldestResponse.status).toBe(200);

      const oldestPage = decodeTelemetryLogPage(await oldestResponse.json());
      expect(oldestPage.entries.map((entry) => entry.message)).toEqual(["log-0"]);
      expect(oldestPage.pageInfo.hasPreviousPage).toBe(false);
    } finally {
      await Promise.all([server.stop(), rm(directory, { recursive: true, force: true })]);
    }
  });

  it("ingests gzipped OTLP protobuf logs and matches the protobuf response type", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-ingest-"));
    const sqliteDatabaseFile = join(directory, "lensflare.sqlite");
    const duckdbDatabaseFile = join(directory, "lensflare.duckdb");
    const port = await getAvailablePort();

    const { dataset } = await seedProjectAndDataset(sqliteDatabaseFile);
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
        dataset.id,
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

  it("ingests Lensflare self-telemetry posted back into lensflare/dev", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-ingest-"));
    const sqliteDatabaseFile = join(directory, "lensflare.sqlite");
    const duckdbDatabaseFile = join(directory, "lensflare.duckdb");
    const port = await getAvailablePort();

    const { dataset } = await seedNamedProjectAndDataset(sqliteDatabaseFile, {
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
      expect(await selfResponse.json()).toEqual({});

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
        dataset.id,
        "SELECT COUNT(*) AS batches, (SELECT COUNT(*) FROM log_records) AS records FROM ingest_batches",
      );
      expect(finalCounts).toEqual([
        {
          batches: 2,
          records: 2,
        },
      ]);

      const records = await queryDuckDb(
        duckdbDatabaseFile,
        dataset.id,
        "SELECT body_text, service_name, dataset_slug FROM log_records ORDER BY body_text",
      );
      expect(records).toEqual([
        {
          body_text: "hello from dev",
          service_name: "api",
          dataset_slug: "lensflare-dev",
        },
        {
          body_text: "loop me back",
          service_name: "lensflare-server",
          dataset_slug: "lensflare-dev",
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

    const { dataset } = await seedProjectAndDataset(sqliteDatabaseFile);
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
        dataset.id,
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
});
