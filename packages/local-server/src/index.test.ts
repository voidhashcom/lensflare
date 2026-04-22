import { NodeSocket } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  DatasetRpcGroup,
  DEFAULT_PROJECT_ICON,
  ProjectRpcGroup,
} from "@lensflare/contracts";
import { Duration, Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalServer } from "./index.ts";

const CatalogRpcs = ProjectRpcGroup.merge(DatasetRpcGroup);
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

describe("startLocalServer", () => {
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
      const {
        createdDataset,
        createdProject,
        fetchedProject,
        listedProjects,
      } = await clientRuntime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcClient.make(CatalogRpcs);
            const createdProject = yield* client.CreateProject({ name: " Lensflare " });
            const listedProjects = yield* client.ListProjects();
            const createdDataset = yield* client.CreateDataset({
              projectId: createdProject.id,
              input: { name: " traces " },
            });
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

      expect(createdDataset.projectId).toBe(createdProject.id);
      expect(createdDataset.name).toBe("traces");

      expect(fetchedProject.datasets).toHaveLength(1);
      expect(fetchedProject.datasets[0]?.id).toBe(createdDataset.id);
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
              Stream.take(2),
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  const valueId = "value" in event ? event.value.id : event.id;
                  projectEvents.push(`${event.action}:${valueId}`);
                })
              ),
              Effect.forkChild,
            );

            const datasetFiber = yield* client.SubscribeDatasetEvents().pipe(
              Stream.take(3),
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  const valueId = "value" in event ? event.value.id : event.id;
                  datasetEvents.push(`${event.action}:${valueId}`);
                })
              ),
              Effect.forkChild,
            );

            // The RPC streams subscribe to the server-side PubSubs lazily —
            // give the WebSocket round-trip a moment so we don't drop the
            // first publish from racing past the subscribe.
            yield* Effect.sleep(Duration.millis(100));

            const project = yield* client.CreateProject({ name: "Lensflare" });
            const dataset = yield* client.CreateDataset({
              projectId: project.id,
              input: { name: "traces" },
            });

            yield* client.UpdateDataset({
              projectId: project.id,
              datasetId: dataset.id,
              input: { name: "spans" },
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
});
