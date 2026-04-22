import { NodeHttpServer } from "@effect/platform-node";
import { DatasetRpcGroup, ProjectRpcGroup, type ServerSnapshot } from "@lensflare/contracts";
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_HOST,
  DEFAULT_SERVER_PORT,
  resolveDataPaths,
  resolveServerOrigin,
} from "@lensflare/shared";
import { Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/unstable/http";
import { OtlpLogger, OtlpSerialization } from "effect/unstable/observability";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { makeSqliteDatabaseLayer } from "./db/database.ts";
import { AxiomNativeDecoder } from "./ingest/providers/axiom/decoder.ts";
import { axiomRouteLayer } from "./ingest/providers/axiom/route.ts";
import { LogIngestService } from "./ingest/logIngestService.ts";
import { OtlpLogsDecoder } from "./ingest/providers/otlp/decoder.ts";
import { otlpRouteLayer } from "./ingest/providers/otlp/route.ts";
import { TelemetryLogQueryService } from "./ingest/telemetryLogQueryService.ts";
import { TelemetryLogsRepository } from "./ingest/telemetryLogsRepository.ts";
import { TelemetryStore } from "./ingest/telemetryStore.ts";
import { IngestTargetResolver } from "./ingest/targetResolver.ts";
import { DatasetsRepository } from "./repositories/datasetsRepository.ts";
import { ProjectsRepository } from "./repositories/projectsRepository.ts";
import { datasetRpcLayer } from "./rpc/datasetRpc.ts";
import { projectRpcLayer } from "./rpc/projectRpc.ts";
import { makeHttpRoutesLayer } from "./http/routes.ts";
import { DatasetService } from "./services/datasetService.ts";
import { ProjectService } from "./services/projectService.ts";

export interface StartLocalServerOptions {
  readonly mode: "desktop" | "server";
  readonly host?: string;
  readonly port?: number;
  readonly staticDir?: string;
  readonly staticAssetMode?: ServerSnapshot["staticAssetMode"];
  readonly sqliteDatabaseFile?: string;
  readonly duckdbDatabaseFile?: string;
  readonly otel?: {
    readonly enabled: boolean;
    readonly projectSlug: string;
    readonly datasetSlug: string;
  };
}

export interface LocalServerHandle {
  readonly origin: string;
  readonly stop: () => Promise<void>;
}

const defaultOtelConfig: NonNullable<StartLocalServerOptions["otel"]> = {
  enabled: true,
  projectSlug: "lensflare-internal",
  datasetSlug: "runtime-logs",
};

function makeObservabilityLayer(
  origin: string,
  mode: StartLocalServerOptions["mode"],
  otel: NonNullable<StartLocalServerOptions["otel"]>,
) {
  if (!otel.enabled) {
    return Layer.empty;
  }

  return OtlpLogger.layer({
    url: `${origin}/ingest/otlp/v1/logs/${otel.projectSlug}/${otel.datasetSlug}`,
    resource: {
      serviceName: mode === "desktop" ? "lensflare-desktop" : "lensflare-server",
      serviceVersion: APP_VERSION,
      attributes: {
        "lensflare.mode": mode,
      },
    },
    exportInterval: "1 second",
    maxBatchSize: 100,
  }).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(OtlpSerialization.layerJson));
}

/**
 * Boot the local Lensflare server.
 *
 * Layer composition:
 *
 *   Infrastructure (shared singletons, memoized via the runtime's MemoMap):
 *     • {@link makeSqliteDatabaseLayer} – SqliteClient + foreign-key PRAGMA + migrations
 *     • {@link TelemetryStore.layer} – DuckDB bootstrap and telemetry migrations
 *     • {@link ProjectService.layer} + {@link DatasetService.layer} – business
 *       logic, including the shared project / dataset change streams, with
 *       the repositories bundled underneath
 *     • {@link LogIngestService.layer} – provider-agnostic catalog resolution
 *       + telemetry writes (no decoder dependencies; decoders live with the
 *       provider routes)
 *     • {@link HttpRouter.layer}, {@link RpcSerialization.layerJson},
 *       {@link NodeHttpServer.layer} – HTTP plumbing
 *
 *   Routes (consume infrastructure):
 *     • {@link makeHttpRoutesLayer} – health, meta, static assets
 *     • `ingestProvidersLayer` – each provider lives at
 *       `ingest/providers/<name>/` and exports a route layer; this layer
 *       mergeAll's them, providing each provider's decoder service. The
 *       handlers themselves resolve `LogIngestService` from infrastructure.
 *     • {@link RpcServer.layerHttp} – mounts the merged project + dataset
 *       handlers at a single `/rpc` endpoint. The contract groups stay
 *       cleanly separated; merging happens only at the transport seam
 *       so the two groups of handlers can coexist on one socket.
 *
 * The SQLite and DuckDB layers are each created once and shared by reference
 * so the runtime's MemoMap collapses every reference to the same underlying
 * resources. After the runtime is built we touch both the catalog and
 * telemetry services so migrations run eagerly on startup.
 */
export async function startLocalServer(
  options: StartLocalServerOptions,
): Promise<LocalServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_SERVER_PORT;
  const origin = resolveServerOrigin({ host, serverPort: port });
  const startedAt = new Date();
  const otel = options.otel ?? defaultOtelConfig;
  const dataPaths = resolveDataPaths();
  const sqliteDatabaseFile = options.sqliteDatabaseFile ?? dataPaths.sqliteDatabaseFile;
  const duckdbDatabaseFile = options.duckdbDatabaseFile ?? dataPaths.duckdbDatabaseFile;

  await mkdir(dirname(sqliteDatabaseFile), { recursive: true });
  await mkdir(dirname(duckdbDatabaseFile), { recursive: true });

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
  const sqliteDatabaseLayer = makeSqliteDatabaseLayer(sqliteDatabaseFile);
  const telemetryStoreLayer = TelemetryStore.layer(duckdbDatabaseFile);

  // ProjectService depends on DatasetService for cascade-delete event
  // fan-out, so DatasetService is `provideMerge`-ed underneath it — that
  // resolves the in-layer dependency while keeping both services in the
  // merged output. Everything else (repositories, event buses, database)
  // is sealed below the pair.
  const catalogServicesLayer = ProjectService.layer.pipe(
    Layer.provideMerge(DatasetService.layer),
    Layer.provide(ProjectsRepository.layer),
    Layer.provide(DatasetsRepository.layer),
    Layer.provide(sqliteDatabaseLayer),
  );
  // `LogIngestService` is provider-agnostic — its only deps are the catalog
  // resolver and the telemetry repository. Decoders move down into the
  // per-provider route layers where they're actually consumed.
  const ingestServicesLayer = LogIngestService.layer.pipe(
    Layer.provide(TelemetryLogsRepository.layer),
    Layer.provide(IngestTargetResolver.layer),
    Layer.provide(ProjectsRepository.layer),
    Layer.provide(DatasetsRepository.layer),
    Layer.provide(sqliteDatabaseLayer),
    Layer.provide(telemetryStoreLayer),
  );
  const telemetryQueryLayer = TelemetryLogQueryService.layer.pipe(
    Layer.provide(DatasetsRepository.layer),
    Layer.provide(sqliteDatabaseLayer),
    Layer.provide(telemetryStoreLayer),
  );

  // Provider plug-in surface: each provider's route layer is mergeAll-ed
  // here, the per-provider decoder services are provided once below, and
  // the shared `LogIngestService` resolves out via `infrastructureLayer`.
  // Adding a new provider is one new import + one new line in this list
  // (plus a new `Layer.provide(<Decoder>.layer)` if it has its own decoder
  // service). No edits anywhere else.
  const ingestProvidersLayer = Layer.mergeAll(otlpRouteLayer, axiomRouteLayer).pipe(
    Layer.provide(OtlpLogsDecoder.layer),
    Layer.provide(AxiomNativeDecoder.layer),
  );

  const rpcGroup = ProjectRpcGroup.merge(DatasetRpcGroup);
  const rpcHandlersLayer = Layer.merge(projectRpcLayer, datasetRpcLayer);

  const routesLayer = Layer.mergeAll(
    makeHttpRoutesLayer({
      origin,
      snapshot,
      staticDir: options.staticDir,
      mode: options.mode,
      sqliteDatabaseFile,
      duckdbDatabaseFile,
    }),
    ingestProvidersLayer,
    RpcServer.layerHttp({
      group: rpcGroup,
      path: "/rpc",
      protocol: "websocket",
    }).pipe(Layer.provide(rpcHandlersLayer)),
  );

  const platformLayer = Layer.mergeAll(
    telemetryStoreLayer,
    HttpRouter.layer,
    RpcSerialization.layerJson,
    NodeHttpServer.layer(createServer, { host, port }),
  );
  const servicesLayer = Layer.mergeAll(
    catalogServicesLayer,
    ingestServicesLayer,
    telemetryQueryLayer,
  );
  const infrastructureLayer = Layer.merge(platformLayer, servicesLayer);
  const observabilityLayer = makeObservabilityLayer(origin, options.mode, otel);
  const applicationLayer = Layer.merge(infrastructureLayer, observabilityLayer);

  const runtimeLayer = Layer.merge(
    applicationLayer,
    HttpRouter.serve(routesLayer).pipe(Layer.provide(applicationLayer)),
  );

  const runtime = ManagedRuntime.make(runtimeLayer, {
    memoMap: Layer.makeMemoMapUnsafe(),
  });

  await runtime.runPromise(
    Effect.gen(function* () {
      const service = yield* ProjectService;
      yield* service.listProjects();
      const telemetry = yield* TelemetryStore;
      yield* telemetry.execute("SELECT 1");
    }),
  );

  await runtime.runPromise(
    Effect.logInfo("lensflare server listening").pipe(
      Effect.annotateLogs({
        mode: options.mode,
        origin,
        telemetryProjectSlug: options.otel?.projectSlug ?? "disabled",
        telemetryDatasetSlug: options.otel?.datasetSlug ?? "disabled",
        otelEnabled: otel.enabled,
      }),
    ),
  );

  return {
    origin,
    stop() {
      return runtime.dispose();
    },
  };
}
