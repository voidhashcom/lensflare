import { DuckDBInstance } from "@duckdb/node-api";
import { NodeSocket } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  DatasetRpcGroup,
  DEFAULT_PROJECT_ICON,
  decodeLensflareEnvironmentDescriptor,
  ProjectRpcGroup,
  TelemetryLogRpcGroup,
} from "@lensflare/contracts";
import { Duration, Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { startLocalServer } from "./index.ts";

const CatalogRpcs = ProjectRpcGroup.merge(DatasetRpcGroup).merge(TelemetryLogRpcGroup);
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

async function queryDuckDb(
  duckdbDatabaseFile: string,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const parsed = parse(duckdbDatabaseFile);
  const datasetDirectory = join(parsed.dir, `${parsed.name}.datasets`);
  const datasetFiles = (await readdir(datasetDirectory)).filter((file) => file.endsWith(".duckdb"));
  if (datasetFiles.length !== 1) {
    throw new Error(`Expected one dataset DuckDB file, found ${datasetFiles.length}.`);
  }

  const instance = await DuckDBInstance.create(join(datasetDirectory, datasetFiles[0] ?? ""));
  const connection = await instance.connect();

  try {
    const reader = await connection.runAndReadAll(sql);
    await reader.readAll();
    return reader.getRowObjectsJson();
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("startLocalServer", () => {
  it("serves MCP over the same HTTP server", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-local-server-"));
    const port = await getAvailablePort();

    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile: join(directory, "lensflare.sqlite"),
      duckdbDatabaseFile: join(directory, "lensflare.duckdb"),
      otel: otelDisabled,
    });

    try {
      const initializeResponse = await fetch(`${server.origin}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body:
          '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"lensflare-test","version":"0.1.0"}}}',
      });

      expect(initializeResponse.status).toBe(200);
      const sessionId = initializeResponse.headers.get("mcp-session-id");
      expect(sessionId).toEqual(expect.any(String));

      const toolsResponse = await fetch(`${server.origin}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "mcp-session-id": sessionId ?? "",
        },
        body: '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
      });

      expect(toolsResponse.status).toBe(200);
      const toolsBody = (await toolsResponse.json()) as {
        readonly result?: {
          readonly tools?: ReadonlyArray<{ readonly name: string }>;
        };
      };
      const toolNames = toolsBody.result?.tools?.map((tool) => tool.name) ?? [];
      expect(toolNames).toEqual(["listDatasets", "queryTelemetry", "getTrace"]);
    } finally {
      await Promise.all([
        server.stop(),
        rm(directory, { recursive: true, force: true }),
      ]);
    }
  });

  it("serves catalog operations over Effect RPC websockets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-local-server-"));
    const port = await getAvailablePort();

    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile: join(directory, "lensflare.sqlite"),
      duckdbDatabaseFile: join(directory, "lensflare.duckdb"),
      otel: otelDisabled,
    });

    const clientLayer = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(NodeSocket.layerWebSocket(`${server.origin}/rpc`)),
    );
    const clientRuntime = ManagedRuntime.make(clientLayer, {
      memoMap: Layer.makeMemoMapUnsafe(),
    });

    try {
      const { createdDataset, createdProject, fetchedProject, listedProjects } =
        await clientRuntime.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const client = yield* RpcClient.make(CatalogRpcs);
              const createdProject = yield* client.CreateProject({ name: " Lensflare " });
              const listedProjects = yield* client.ListProjects();
              const createdDataset = createdProject.datasets[0];
              const fetchedProject = yield* client.GetProject({
                projectId: createdProject.id,
              });

              return {
                createdProject,
                listedProjects,
                createdDataset,
                fetchedProject,
              };
            }),
          ),
        );

      expect(createdProject.name).toBe("Lensflare");
      expect(createdProject.icon).toBe(DEFAULT_PROJECT_ICON);

      expect(listedProjects).toHaveLength(1);
      expect(listedProjects[0]?.id).toBe(createdProject.id);

      expect(createdDataset?.projectId).toBe(createdProject.id);
      expect(createdDataset?.name).toBe("Lensflare");

      expect(fetchedProject.datasets).toHaveLength(1);
      expect(fetchedProject.datasets[0]?.id).toBe(createdDataset?.id);
    } finally {
      await Promise.all([
        clientRuntime.dispose(),
        server.stop(),
        rm(directory, { recursive: true, force: true }),
      ]);
    }
  });

  it("streams catalog entity changes over Effect RPC websockets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-local-server-"));
    const port = await getAvailablePort();

    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile: join(directory, "lensflare.sqlite"),
      duckdbDatabaseFile: join(directory, "lensflare.duckdb"),
      otel: otelDisabled,
    });

    const clientLayer = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(NodeSocket.layerWebSocket(`${server.origin}/rpc`)),
    );
    const clientRuntime = ManagedRuntime.make(clientLayer, {
      memoMap: Layer.makeMemoMapUnsafe(),
    });

    try {
      const { projectEvents, datasetEvents } = await clientRuntime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcClient.make(CatalogRpcs);
            const projectEvents: Array<string> = [];
            const datasetEvents: Array<string> = [];

            const projectFiber = yield* client.SubscribeProjectEvents().pipe(
              Stream.take(3),
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  const valueId = "value" in event ? event.value.id : event.id;
                  projectEvents.push(`${event.action}:${valueId}`);
                }),
              ),
              Effect.forkChild,
            );

            const datasetFiber = yield* client.SubscribeDatasetEvents().pipe(
              Stream.take(3),
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  const valueId = "value" in event ? event.value.id : event.id;
                  datasetEvents.push(`${event.action}:${valueId}`);
                }),
              ),
              Effect.forkChild,
            );

            // The RPC streams subscribe to the server-side PubSubs lazily —
            // give the WebSocket round-trip a moment so we don't drop the
            // first publish from racing past the subscribe.
            yield* Effect.sleep(Duration.millis(100));

            const project = yield* client.CreateProject({ name: "Lensflare" });
            yield* client.UpdateProject({
              projectId: project.id,
              input: { name: "Observability", slug: "observability" },
            });
            yield* client.DeleteProject({ projectId: project.id });
            yield* Fiber.join(projectFiber);
            yield* Fiber.join(datasetFiber);

            return { projectEvents, datasetEvents };
          }),
        ),
      );

      expect(projectEvents).toEqual([
        expect.stringMatching(/^upsert:/),
        expect.stringMatching(/^upsert:/),
        expect.stringMatching(/^delete:/),
      ]);

      expect(datasetEvents).toEqual([
        expect.stringMatching(/^upsert:/),
        expect.stringMatching(/^upsert:/),
        expect.stringMatching(/^delete:/),
      ]);
    } finally {
      await Promise.all([
        clientRuntime.dispose(),
        server.stop(),
        rm(directory, { recursive: true, force: true }),
      ]);
    }
  });

  it("streams ingested dataset logs over Effect RPC websockets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-local-server-"));
    const port = await getAvailablePort();

    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile: join(directory, "lensflare.sqlite"),
      duckdbDatabaseFile: join(directory, "lensflare.duckdb"),
      otel: otelDisabled,
    });

    const clientLayer = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(NodeSocket.layerWebSocket(`${server.origin}/rpc`)),
    );
    const clientRuntime = ManagedRuntime.make(clientLayer, {
      memoMap: Layer.makeMemoMapUnsafe(),
    });

    try {
      const event = await clientRuntime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcClient.make(CatalogRpcs);
            const project = yield* client.CreateProject({ name: "Lensflare" });
            const dataset = project.datasets[0];
            const events: Array<unknown> = [];

            const fiber = yield* client
              .SubscribeTelemetryLogEvents({
                projectId: project.id,
                datasetId: dataset?.id ?? "",
              })
              .pipe(
                Stream.take(1),
                Stream.runForEach((event) =>
                  Effect.sync(() => {
                    events.push(event);
                  }),
                ),
                Effect.forkChild,
              );

            yield* Effect.sleep(Duration.millis(100));

            const response = yield* Effect.tryPromise(() =>
              fetch(`${server.origin}/ingest/otlp/v1/logs/lensflare`, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                },
                body:
                  '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"api"}}]},"scopeLogs":[{"scope":{"name":"tests","version":"1.0.0"},"logRecords":[{"timeUnixNano":"1716201600000000000","severityNumber":9,"severityText":"INFO","body":{"stringValue":"hello realtime"}}]}]}]}',
              }),
            );
            expect(response.status).toBe(200);

            yield* Fiber.join(fiber);
            return events[0];
          }),
        ),
      );

      expect(event).toMatchObject({
        sourceName: "api",
        level: "info",
        message: "hello realtime",
      });
      expect(event).toHaveProperty("id", expect.any(String));
    } finally {
      await Promise.all([
        clientRuntime.dispose(),
        server.stop(),
        rm(directory, { recursive: true, force: true }),
      ]);
    }
  });

  it("serves the environment descriptor at /.well-known/lensflare/environment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-local-server-"));
    const port = await getAvailablePort();

    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile: join(directory, "lensflare.sqlite"),
      duckdbDatabaseFile: join(directory, "lensflare.duckdb"),
      otel: otelDisabled,
    });

    try {
      const response = await fetch(new URL("/.well-known/lensflare/environment", server.origin));
      expect(response.ok).toBe(true);

      const descriptor = decodeLensflareEnvironmentDescriptor(await response.json());

      expect(descriptor.httpBaseUrl).toBe(server.httpBaseUrl);
      expect(descriptor.wsBaseUrl).toBe(server.wsBaseUrl);
      expect(new URL(descriptor.wsBaseUrl).host).toBe(new URL(server.httpBaseUrl).host);
      expect(descriptor.serverInstanceId).toBe(server.serverInstanceId);
      expect(descriptor.port).toBe(port);
      expect(descriptor.mode).toBe("server");
    } finally {
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("surfaces serverInstanceId on /api/health", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-local-server-"));
    const port = await getAvailablePort();

    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile: join(directory, "lensflare.sqlite"),
      duckdbDatabaseFile: join(directory, "lensflare.duckdb"),
      otel: otelDisabled,
    });

    try {
      const response = await fetch(new URL("/api/health", server.origin));
      expect(response.ok).toBe(true);

      const body = (await response.json()) as {
        readonly serverInstanceId?: string;
        readonly mode?: string;
      };

      expect(body.serverInstanceId).toBe(server.serverInstanceId);
      expect(body.mode).toBe("server");
    } finally {
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exports local observability spans alongside local logs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-local-server-"));
    const port = await getAvailablePort();
    const duckdbDatabaseFile = join(directory, "lensflare.duckdb");

    const server = await startLocalServer({
      mode: "server",
      host: "127.0.0.1",
      port,
      sqliteDatabaseFile: join(directory, "lensflare.sqlite"),
      duckdbDatabaseFile,
      otel: {
        enabled: true,
        projectSlug: "lensflare",
        datasetSlug: "dev",
      },
      bootstrapOtelCatalog: true,
    });

    try {
      const response = await fetch(new URL("/api/health", server.origin));
      expect(response.ok).toBe(true);

      await delay(2_200);
    } finally {
      await server.stop();
    }

    try {
      const spanRows = await queryDuckDb(
        duckdbDatabaseFile,
        "SELECT COUNT(*) AS count FROM otel_traces",
      );
      const logRows = await queryDuckDb(
        duckdbDatabaseFile,
        "SELECT COUNT(*) AS count FROM otel_logs",
      );

      expect(Number(spanRows[0]?.count ?? 0)).toBeGreaterThan(0);
      expect(Number(logRows[0]?.count ?? 0)).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("routes backend-owned paths to the backend when a devClientUrl is configured", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-local-server-"));
    const port = await getAvailablePort();

    const server = await startLocalServer({
      mode: "desktop",
      host: "127.0.0.1",
      port,
      devClientUrl: "http://127.0.0.1:6789",
      sqliteDatabaseFile: join(directory, "lensflare.sqlite"),
      duckdbDatabaseFile: join(directory, "lensflare.duckdb"),
      otel: otelDisabled,
    });

    try {
      const healthResponse = await fetch(new URL("/api/health", server.origin));
      expect(healthResponse.status).toBe(200);

      const descriptorResponse = await fetch(
        new URL("/.well-known/lensflare/environment", server.origin),
      );
      expect(descriptorResponse.status).toBe(200);

      const unknownStatic = await fetch(new URL("/some/page", server.origin), {
        redirect: "manual",
      });
      expect(unknownStatic.status).toBe(307);
      const redirectLocation = unknownStatic.headers.get("location");
      expect(redirectLocation).not.toBeNull();
      expect(new URL(redirectLocation ?? "").origin).toBe("http://127.0.0.1:6789");
      expect(new URL(redirectLocation ?? "").pathname).toBe("/some/page");
    } finally {
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
