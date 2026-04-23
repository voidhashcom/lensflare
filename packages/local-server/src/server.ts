import { NodeHttpServer } from "@effect/platform-node";
import { NodeSdk } from "@effect/opentelemetry";
import {
  DatasetRpcGroup,
  type LensflareEnvironmentDescriptor,
  ProjectRpcGroup,
  type ServerSnapshot,
  TelemetryLogRpcGroup,
} from "@lensflare/contracts";
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_HOST,
  DEFAULT_SERVER_PORT,
  httpUrlToWsUrl,
  resolveDataPaths,
  resolveServerOrigin,
} from "@lensflare/shared";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { makeSqliteDatabaseLayer } from "./db/database.ts";
import { makeDatasetTag } from "./domain/slug.ts";
import { AxiomNativeDecoder } from "./ingest/providers/axiom/decoder.ts";
import { axiomRouteLayer } from "./ingest/providers/axiom/route.ts";
import { LogIngestService } from "./ingest/logIngestService.ts";
import { TelemetryLogEventService } from "./ingest/telemetryLogEventService.ts";
import { OtlpLogsDecoder, OtlpTracesDecoder } from "./ingest/providers/otlp/decoder.ts";
import { otlpRouteLayer } from "./ingest/providers/otlp/route.ts";
import { TelemetryLogQueryService } from "./ingest/telemetryLogQueryService.ts";
import { TelemetryQueryService } from "./ingest/telemetryQueryService.ts";
import { TelemetryLogsRepository } from "./ingest/telemetryLogsRepository.ts";
import { TelemetrySpansRepository } from "./ingest/telemetrySpansRepository.ts";
import { TelemetryStore } from "./ingest/telemetryStore.ts";
import { IngestTargetResolver } from "./ingest/targetResolver.ts";
import { DatasetsRepository } from "./repositories/datasetsRepository.ts";
import { ProjectsRepository } from "./repositories/projectsRepository.ts";
import { datasetRpcLayer } from "./rpc/datasetRpc.ts";
import { projectRpcLayer } from "./rpc/projectRpc.ts";
import { telemetryLogRpcLayer } from "./rpc/telemetryLogRpc.ts";
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
  /**
   * When set, non-API/non-RPC static routes are redirected to this URL so
   * desktop dev can load the Vite dev client through the backend origin
   * without losing the dev transport guarantees. Leave unset in production
   * and server mode.
   */
  readonly devClientUrl?: string;
  readonly otel?: {
    readonly enabled: boolean;
    readonly projectSlug: string;
    readonly datasetSlug: string;
  };
  /**
   * Creates the configured OTLP project/dataset on startup. This is intended
   * only for Lensflare development self-observability.
   */
  readonly bootstrapOtelCatalog?: boolean;
}

export interface LocalServerHandle {
  readonly origin: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly serverInstanceId: string;
  readonly descriptor: LensflareEnvironmentDescriptor;
  readonly stop: () => Promise<void>;
}

const otelShutdownTimeout = "250 millis";
const defaultOtelConfig: NonNullable<StartLocalServerOptions["otel"]> = {
  enabled: false,
  projectSlug: "lensflare",
  datasetSlug: "dev",
};
const defaultOtelProjectName = "Lensflare";
const defaultOtelDatasetName = "Dev";

function makeObservabilityLayer(
  origin: string,
  mode: StartLocalServerOptions["mode"],
  otel: NonNullable<StartLocalServerOptions["otel"]>,
) {
  if (!otel.enabled) {
    return Layer.empty;
  }

  const resource = {
    serviceName: mode === "desktop" ? "lensflare-desktop" : "lensflare-server",
    serviceVersion: APP_VERSION,
    attributes: {
      "lensflare.mode": mode,
    },
  };

  return NodeSdk.layer(() => ({
    resource,
    logRecordProcessor: new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: `${origin}/ingest/otlp/v1/logs/${otel.projectSlug}/${otel.datasetSlug}`,
      }),
      {
        scheduledDelayMillis: 1_000,
        maxExportBatchSize: 100,
      },
    ),
    spanProcessor: new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: `${origin}/ingest/otlp/v1/traces/${otel.projectSlug}/${otel.datasetSlug}`,
      }),
      {
        scheduledDelayMillis: 1_000,
        maxExportBatchSize: 100,
      },
    ),
    shutdownTimeout: otelShutdownTimeout,
  }));
}

function ensureTelemetryCatalogTarget(
  otel: NonNullable<StartLocalServerOptions["otel"]>,
): Effect.Effect<void, never, ProjectService | DatasetService> {
  return Effect.orDie(
    Effect.gen(function* () {
      if (!otel.enabled) {
        return;
      }

      const projects = yield* ProjectService;
      const datasets = yield* DatasetService;

      const existingProject = (yield* projects.listProjectEntities()).find(
        (project) => project.slug === otel.projectSlug,
      );
      const project =
        existingProject ??
        (yield* projects.createProject({
          name: defaultOtelProjectName,
          slug: otel.projectSlug,
        }));
      const datasetTag = makeDatasetTag(project.slug, otel.datasetSlug);
      const existingDataset = (yield* datasets.listDatasets()).find(
        (dataset) => dataset.slug === datasetTag,
      );

      if (existingDataset === undefined) {
        yield* datasets.createDataset(project.id, {
          name: defaultOtelDatasetName,
          slug: otel.datasetSlug,
        });
        return;
      }

      if (existingDataset.projectId !== project.id) {
        return yield* Effect.die(
          new Error(
            `Telemetry dataset slug "${otel.datasetSlug}" already belongs to project "${existingDataset.projectId}" and cannot be attached to "${project.id}".`,
          ),
        );
      }
    }),
  );
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
  const wsBaseUrl = httpUrlToWsUrl(origin);
  const serverInstanceId = randomUUID();
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

  const descriptor: LensflareEnvironmentDescriptor = {
    appName: APP_NAME,
    appVersion: APP_VERSION,
    mode: options.mode,
    platform: process.platform,
    host,
    port,
    httpBaseUrl: origin,
    wsBaseUrl,
    serverInstanceId,
    startedAt: startedAt.toISOString(),
  };

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
    Layer.provide(telemetryStoreLayer),
  );
  // `LogIngestService` is provider-agnostic — its only deps are the catalog
  // resolver and the telemetry repository. Decoders move down into the
  // per-provider route layers where they're actually consumed.
  const telemetryLogEventLayer = TelemetryLogEventService.layer;
  const ingestServicesLayer = LogIngestService.layer.pipe(
    Layer.provide(telemetryLogEventLayer),
    Layer.provide(TelemetryLogsRepository.layer),
    Layer.provide(TelemetrySpansRepository.layer),
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
  const unifiedTelemetryQueryLayer = TelemetryQueryService.layer.pipe(
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
    Layer.provide(OtlpTracesDecoder.layer),
    Layer.provide(AxiomNativeDecoder.layer),
  );

  const rpcGroup = ProjectRpcGroup.merge(DatasetRpcGroup).merge(TelemetryLogRpcGroup);
  const rpcHandlersLayer = Layer.mergeAll(projectRpcLayer, datasetRpcLayer, telemetryLogRpcLayer);

  // Desktop dev serves the renderer from Vite (`options.devClientUrl`) while
  // HTTP + RPC stay on this origin, so `fetch` calls from the renderer are
  // cross-origin and need CORS. Packaged desktop and cloud server mode
  // don't set `devClientUrl`, and either serve the renderer same-origin
  // (desktop) or handle CORS at the deployment layer (cloud), so we skip
  // the middleware in those cases.
  const corsLayer = options.devClientUrl
    ? HttpRouter.cors({
        allowedOrigins: [options.devClientUrl],
        credentials: true,
      })
    : Layer.empty;

  const routesLayer = Layer.mergeAll(
    makeHttpRoutesLayer({
      origin,
      snapshot,
      descriptor,
      staticDir: options.staticDir,
      devClientUrl: options.devClientUrl,
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
    corsLayer,
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
    unifiedTelemetryQueryLayer,
    telemetryLogEventLayer,
  );
  const infrastructureLayer = Layer.merge(platformLayer, servicesLayer);

  const observabilityLayer = makeObservabilityLayer(origin, options.mode, otel);
  const applicationLayer = Layer.merge(infrastructureLayer, observabilityLayer);

  const runtimeLayer = Layer.merge(
    applicationLayer,
    HttpRouter.serve(routesLayer).pipe(Layer.provide(applicationLayer)),
  );

  if (options.bootstrapOtelCatalog) {
    const bootstrapRuntime = ManagedRuntime.make(catalogServicesLayer);
    try {
      await bootstrapRuntime.runPromise(ensureTelemetryCatalogTarget(otel));
    } finally {
      await bootstrapRuntime.dispose();
    }
  }

  const runtime = ManagedRuntime.make(runtimeLayer, {
    memoMap: Layer.makeMemoMapUnsafe(),
  });

  await runtime.runPromise(
    Effect.gen(function* () {
      const service = yield* ProjectService;
      yield* service.listProjects();
    }),
  );

  await runtime.runPromise(
    Effect.logInfo("lensflare server listening").pipe(
      Effect.annotateLogs({
        mode: options.mode,
        origin,
        telemetryProjectSlug: otel.enabled ? otel.projectSlug : "disabled",
        telemetryDatasetSlug: otel.enabled ? otel.datasetSlug : "disabled",
        otelEnabled: otel.enabled,
      }),
    ),
  );

  return {
    origin,
    httpBaseUrl: origin,
    wsBaseUrl,
    serverInstanceId,
    descriptor,
    stop() {
      return runtime.dispose();
    },
  };
}
