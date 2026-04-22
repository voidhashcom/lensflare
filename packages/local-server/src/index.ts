import { NodeHttpServer } from "@effect/platform-node";
import {
  CatalogRpcGroup,
  type ServerSnapshot,
  type CreateDatasetInput,
  type CreateProjectInput,
  type UpdateDatasetInput,
  type UpdateProjectInput,
} from "@lensflare/contracts";
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_HOST,
  DEFAULT_SERVER_PORT,
  resolveServerOrigin,
} from "@lensflare/shared";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  HttpRouter,
  HttpServerResponse,
} from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { CatalogStore, makeCatalogStoreLayer } from "./catalog.ts";

export interface StartLocalServerOptions {
  mode: "desktop" | "server";
  host?: string;
  port?: number;
  staticDir?: string;
  staticAssetMode?: ServerSnapshot["staticAssetMode"];
  databaseFile?: string;
}

export interface LocalServerHandle {
  origin: string;
  stop: () => Promise<void>;
}

const DEFAULT_DATABASE_FILE = join(homedir(), ".lensflare", "lensflare.sqlite");

function inferContentType(pathname: string): string {
  if (pathname.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (pathname.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (pathname.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (pathname.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (pathname.endsWith(".png")) {
    return "image/png";
  }
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return "text/html; charset=utf-8";
}

interface StaticFileResponse {
  body: Buffer;
  contentType: string;
}

async function serveStaticFile(
  requestPath: string,
  staticDir: string | undefined,
): Promise<StaticFileResponse | null> {
  if (!staticDir) {
    return null;
  }

  const rootDir = resolve(staticDir);
  const sanitizedPath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const relativePath = sanitizedPath === "/" ? "index.html" : sanitizedPath.replace(/^\//, "");
  const candidatePath = resolve(rootDir, relativePath);
  const fallbackIndexPath = join(staticDir, "index.html");

  const isInsideRoot =
    candidatePath === rootDir || candidatePath.startsWith(`${rootDir}${sep}`);

  if (isInsideRoot && existsSync(candidatePath)) {
    return {
      body: await readFile(candidatePath),
      contentType: inferContentType(candidatePath),
    };
  }

  if (existsSync(fallbackIndexPath)) {
    return {
      body: await readFile(fallbackIndexPath),
      contentType: "text/html; charset=utf-8",
    };
  }

  return null;
}

function renderFallbackApp(origin: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${APP_NAME}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "SF Pro Display", "Segoe UI", sans-serif;
        background: #0d1117;
        color: #f3f4f6;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(17, 94, 89, 0.4), transparent 45%),
          linear-gradient(160deg, #0d1117 0%, #111827 52%, #0f172a 100%);
      }
      main {
        width: min(720px, calc(100vw - 32px));
        padding: 32px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 24px;
        background: rgba(15, 23, 42, 0.72);
        backdrop-filter: blur(20px);
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(2rem, 5vw, 3rem);
      }
      p {
        margin: 0 0 12px;
        line-height: 1.6;
        color: #cbd5e1;
      }
      code {
        color: #f8fafc;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${APP_NAME} local server is live</h1>
      <p>The RPC server is running at <code>${origin}/rpc</code>.</p>
      <p>No web bundle was found yet. Build or run <code>apps/web</code> and point the desktop shell at it during development.</p>
      <p>Once the web app is built, this same server becomes the shared backend for the desktop shell and the browser client.</p>
    </main>
  </body>
</html>`;
}

function makeCatalogRpcLayer() {
  return CatalogRpcGroup.toLayer(
    Effect.gen(function* () {
      const store = yield* CatalogStore;

      return CatalogRpcGroup.of({
        ListProjects: () => store.listProjects().pipe(Effect.catchTag("SqlError", Effect.die)),
        GetProject: ({ projectId }: { projectId: string }) =>
          store.getProject(projectId).pipe(Effect.catchTag("SqlError", Effect.die)),
        CreateProject: (input: CreateProjectInput) =>
          store.createProject(input).pipe(Effect.catchTag("SqlError", Effect.die)),
        UpdateProject: (
          { projectId, input }: { projectId: string; input: UpdateProjectInput },
        ) => store.updateProject(projectId, input).pipe(Effect.catchTag("SqlError", Effect.die)),
        DeleteProject: ({ projectId }: { projectId: string }) =>
          store.deleteProject(projectId).pipe(Effect.catchTag("SqlError", Effect.die)),
        GetDataset: (
          { projectId, datasetId }: { projectId: string; datasetId: string },
        ) => store.getDataset(projectId, datasetId).pipe(Effect.catchTag("SqlError", Effect.die)),
        CreateDataset: (
          { projectId, input }: { projectId: string; input: CreateDatasetInput },
        ) => store.createDataset(projectId, input).pipe(Effect.catchTag("SqlError", Effect.die)),
        UpdateDataset: (
          {
            projectId,
            datasetId,
            input,
          }: { projectId: string; datasetId: string; input: UpdateDatasetInput },
        ) =>
          store.updateDataset(projectId, datasetId, input).pipe(
            Effect.catchTag("SqlError", Effect.die),
          ),
        DeleteDataset: (
          { projectId, datasetId }: { projectId: string; datasetId: string },
        ) => store.deleteDataset(projectId, datasetId).pipe(Effect.catchTag("SqlError", Effect.die)),
      });
    }),
  );
}

function makeHttpRoutesLayer(options: {
  readonly origin: string;
  readonly snapshot: () => ServerSnapshot;
  readonly staticDir: string | undefined;
  readonly mode: StartLocalServerOptions["mode"];
  readonly databaseFile: string;
}) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;

      yield* router.add(
        "GET",
        "/api/health",
        HttpServerResponse.jsonUnsafe(options.snapshot()),
      );

      yield* router.add(
        "GET",
        "/api/meta",
        HttpServerResponse.jsonUnsafe({
          appName: APP_NAME,
          appVersion: APP_VERSION,
          serverOrigin: options.origin,
          mode: options.mode,
          databaseFile: options.databaseFile,
        }),
      );

      const apiNotFound = HttpServerResponse.jsonUnsafe(
        {
          error: {
            tag: "NotFound",
            message: "API route not found.",
          },
        },
        { status: 404 },
      );

      yield* router.add(
        "GET",
        "/*",
        (request) =>
          Effect.gen(function* () {
            const pathname = new URL(request.url, options.origin).pathname;

            if (pathname === "/api" || pathname.startsWith("/api/")) {
              return apiNotFound;
            }

            const staticResponse = yield* Effect.promise(() =>
              serveStaticFile(pathname, options.staticDir),
            );

            if (staticResponse) {
              return HttpServerResponse.uint8Array(staticResponse.body, {
                contentType: staticResponse.contentType,
              });
            }

            return HttpServerResponse.html(renderFallbackApp(options.origin));
          }),
      );
    }),
  );
}

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
    staticAssetMode:
      options.staticAssetMode ?? (options.staticDir ? "filesystem" : "none"),
  });

  const routesLayer = Layer.mergeAll(
    makeHttpRoutesLayer({
      origin,
      snapshot,
      staticDir: options.staticDir,
      mode: options.mode,
      databaseFile,
    }),
    RpcServer.layerHttp({
      group: CatalogRpcGroup,
      path: "/rpc",
      protocol: "websocket",
    }).pipe(Layer.provide(makeCatalogRpcLayer())),
  );

  const infrastructureLayer = Layer.mergeAll(
    makeCatalogStoreLayer(databaseFile),
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
      const store = yield* CatalogStore;
      yield* store.listProjects();
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
