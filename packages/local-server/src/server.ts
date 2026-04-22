import { NodeHttpServer } from "@effect/platform-node";
import { DatasetRpcGroup, ProjectRpcGroup, type ServerSnapshot } from "@lensflare/contracts";
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_HOST,
  DEFAULT_SERVER_PORT,
  resolveServerOrigin,
} from "@lensflare/shared";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatasetsRepository } from "./repositories/datasetsRepository.ts";
import { ProjectsRepository } from "./repositories/projectsRepository.ts";
import { datasetRpcLayer } from "./rpc/datasetRpc.ts";
import { projectRpcLayer } from "./rpc/projectRpc.ts";
import { makeDatabaseLayer } from "./db/database.ts";
import { makeHttpRoutesLayer } from "./http/routes.ts";
import { DatasetService } from "./services/datasetService.ts";
import { ProjectService } from "./services/projectService.ts";

export interface StartLocalServerOptions {
  readonly mode: "desktop" | "server";
  readonly host?: string;
  readonly port?: number;
  readonly staticDir?: string;
  readonly staticAssetMode?: ServerSnapshot["staticAssetMode"];
  readonly databaseFile?: string;
}

export interface LocalServerHandle {
  readonly origin: string;
  readonly stop: () => Promise<void>;
}

const DEFAULT_DATABASE_FILE = join(homedir(), ".lensflare", "lensflare.sqlite");

/**
 * Boot the local Lensflare server.
 *
 * Layer composition:
 *
 *   Infrastructure (shared singletons, memoized via the runtime's MemoMap):
 *     • {@link makeDatabaseLayer} – SqliteClient + foreign-key PRAGMA + migrations
 *     • {@link ProjectService.layer} + {@link DatasetService.layer} – business
 *       logic, including the shared project / dataset change streams, with
 *       the repositories bundled underneath
 *     • {@link HttpRouter.layer}, {@link RpcSerialization.layerJson},
 *       {@link NodeHttpServer.layer} – HTTP plumbing
 *
 *   Routes (consume infrastructure):
 *     • {@link makeHttpRoutesLayer} – health, meta, static assets
 *     • {@link RpcServer.layerHttp} – mounts the merged project + dataset
 *       handlers at a single `/rpc` endpoint. The contract groups stay
 *       cleanly separated; merging happens only at the transport seam
 *       so the two groups of handlers can coexist on one socket.
 *
 * `databaseLayer` is created once and shared by reference so the runtime's
 * MemoMap collapses every reference to the same SQLite connection (and runs
 * migrations exactly once). After the runtime is built we touch
 * {@link ProjectService.listProjects} so the database materializes (and
 * migrations run) up-front instead of lazily on the first RPC call.
 */
export async function startLocalServer(
  options: StartLocalServerOptions,
): Promise<LocalServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_SERVER_PORT;
  const origin = resolveServerOrigin({ host, serverPort: port });
  const startedAt = new Date();
  const databaseFile = options.databaseFile ?? DEFAULT_DATABASE_FILE;

  await mkdir(dirname(databaseFile), { recursive: true });

  const snapshot = (): ServerSnapshot => ({
    name: APP_NAME,
    version: APP_VERSION,
    mode: options.mode,
    platform: process.platform,
    hostname: host,
    port,
    origin,
    startedAt: startedAt.toISOString(),
    uptimeMs: Date.now() - startedAt.getTime(),
    staticAssetMode: options.staticAssetMode ?? (options.staticDir ? "filesystem" : "none"),
  });

  // Captured once so every consumer (the services, the eager warmup, and
  // — implicitly — the RPC handlers) shares the same Layer reference, which
  // the runtime's MemoMap collapses to a single SQLite connection.
  const databaseLayer = makeDatabaseLayer(databaseFile);

  // ProjectService depends on DatasetService for cascade-delete event
  // fan-out, so DatasetService is `provideMerge`-ed underneath it — that
  // resolves the in-layer dependency while keeping both services in the
  // merged output. Everything else (repositories, event buses, database)
  // is sealed below the pair.
  const catalogServicesLayer = ProjectService.layer.pipe(
    Layer.provideMerge(DatasetService.layer),
    Layer.provide(ProjectsRepository.layer),
    Layer.provide(DatasetsRepository.layer),
    Layer.provide(databaseLayer),
  );

  const rpcGroup = ProjectRpcGroup.merge(DatasetRpcGroup);
  const rpcHandlersLayer = Layer.merge(projectRpcLayer, datasetRpcLayer);

  const routesLayer = Layer.mergeAll(
    makeHttpRoutesLayer({
      origin,
      snapshot,
      staticDir: options.staticDir,
      mode: options.mode,
      databaseFile,
    }),
    RpcServer.layerHttp({
      group: rpcGroup,
      path: "/rpc",
      protocol: "websocket",
    }).pipe(Layer.provide(rpcHandlersLayer)),
  );

  const infrastructureLayer = Layer.mergeAll(
    catalogServicesLayer,
    HttpRouter.layer,
    RpcSerialization.layerJson,
    NodeHttpServer.layer(createServer, { host, port }),
  );

  const runtimeLayer = Layer.merge(
    infrastructureLayer,
    HttpRouter.serve(routesLayer).pipe(Layer.provide(infrastructureLayer)),
  );

  const runtime = ManagedRuntime.make(runtimeLayer, {
    memoMap: Layer.makeMemoMapUnsafe(),
  });

  await runtime.runPromise(
    Effect.gen(function* () {
      const service = yield* ProjectService;
      yield* service.listProjects();
    }),
  );

  console.log(`[lensflare] ${options.mode} server listening on ${origin}`);

  return {
    origin,
    stop() {
      return runtime.dispose();
    },
  };
}
