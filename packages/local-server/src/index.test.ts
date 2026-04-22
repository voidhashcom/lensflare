import { NodeSocket } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { CatalogRpcGroup, DEFAULT_PROJECT_ICON } from "@lensflare/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalServer } from "./index.ts";

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
      databaseFile: join(directory, "catalog.sqlite"),
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
            const client = yield* RpcClient.make(CatalogRpcGroup);
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
});
