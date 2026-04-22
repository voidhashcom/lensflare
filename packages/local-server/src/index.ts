import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, normalize, resolve, sep } from "node:path";
import {
  decodeCreateDatasetInput,
  decodeCreateProjectInput,
  decodeServerEvent,
  decodeUpdateDatasetInput,
  decodeUpdateProjectInput,
  type ServerEvent,
  type ServerSnapshot,
} from "@lensflare/contracts";
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_HOST,
  DEFAULT_SERVER_PORT,
  resolveServerOrigin,
} from "@lensflare/shared";
import { Effect, Layer, ManagedRuntime } from "effect";
import WebSocket, { WebSocketServer } from "ws";
import {
  CatalogStore,
  DatasetNotFound,
  makeCatalogStoreLayer,
  ProjectNotFound,
  ValidationError,
} from "./catalog.ts";

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
      <p>The API is running at <code>${origin}</code>.</p>
      <p>No web bundle was found yet. Build or run <code>apps/web</code> and point the desktop shell at it during development.</p>
      <p>Once the web app is built, this same server becomes the shared backend for the desktop shell and the browser client.</p>
    </main>
  </body>
</html>`;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

function sendNoContent(response: ServerResponse): void {
  response.writeHead(204);
  response.end();
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Array<Buffer> = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendApiError(response: ServerResponse, error: unknown): void {
  if (error instanceof ProjectNotFound) {
    sendJson(response, 404, {
      error: {
        tag: error._tag,
        message: "Project not found.",
        projectId: error.projectId,
      },
    });
    return;
  }

  if (error instanceof DatasetNotFound) {
    sendJson(response, 404, {
      error: {
        tag: error._tag,
        message: "Dataset not found.",
        projectId: error.projectId,
        datasetId: error.datasetId,
      },
    });
    return;
  }

  if (error instanceof ValidationError) {
    sendJson(response, 400, {
      error: {
        tag: error._tag,
        message: error.message,
        field: error.field,
      },
    });
    return;
  }

  if (error instanceof SyntaxError) {
    sendJson(response, 400, {
      error: {
        tag: "InvalidJson",
        message: "Request body must be valid JSON.",
      },
    });
    return;
  }

  console.error("[lensflare] API request failed", error);
  sendJson(response, 500, {
    error: {
      tag: "InternalServerError",
      message: "Internal Server Error",
    },
  });
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: StartLocalServerOptions,
  origin: string,
  runtime: ManagedRuntime.ManagedRuntime<CatalogStore, unknown>,
  snapshot: () => ServerSnapshot,
): Promise<boolean> {
  const method = request.method ?? "GET";
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (segments[0] !== "api") {
    return false;
  }

  const runCatalog = <A, E>(program: Effect.Effect<A, E, CatalogStore>) =>
    runtime.runPromise(program);

  if (segments.length === 2 && segments[1] === "health" && method === "GET") {
    sendJson(response, 200, snapshot());
    return true;
  }

  if (segments.length === 2 && segments[1] === "meta" && method === "GET") {
    sendJson(response, 200, {
      appName: APP_NAME,
      appVersion: APP_VERSION,
      serverOrigin: origin,
      mode: options.mode,
      databaseFile: options.databaseFile ?? DEFAULT_DATABASE_FILE,
    });
    return true;
  }

  if (segments.length === 2 && segments[1] === "projects") {
    try {
      if (method === "GET") {
        const projects = await runCatalog(
          Effect.gen(function* () {
            const store = yield* CatalogStore;
            return yield* store.listProjects();
          }),
        );
        sendJson(response, 200, { projects });
        return true;
      }

      if (method === "POST") {
        const body = await readJsonBody(request);
        const input = decodeCreateProjectInput(body);
        const project = await runCatalog(
          Effect.gen(function* () {
            const store = yield* CatalogStore;
            return yield* store.createProject(input);
          }),
        );
        sendJson(response, 201, { project });
        return true;
      }
    } catch (error) {
      sendApiError(response, error);
      return true;
    }

    sendJson(response, 405, {
      error: { tag: "MethodNotAllowed", message: "Method not allowed." },
    });
    return true;
  }

  if (segments.length === 3 && segments[1] === "projects") {
    const projectId = segments[2]!;

    try {
      if (method === "GET") {
        const project = await runCatalog(
          Effect.gen(function* () {
            const store = yield* CatalogStore;
            return yield* store.getProject(projectId);
          }),
        );
        sendJson(response, 200, { project });
        return true;
      }

      if (method === "PATCH") {
        const body = await readJsonBody(request);
        const input = decodeUpdateProjectInput(body);
        const project = await runCatalog(
          Effect.gen(function* () {
            const store = yield* CatalogStore;
            return yield* store.updateProject(projectId, input);
          }),
        );
        sendJson(response, 200, { project });
        return true;
      }

      if (method === "DELETE") {
        await runCatalog(
          Effect.gen(function* () {
            const store = yield* CatalogStore;
            yield* store.deleteProject(projectId);
          }),
        );
        sendNoContent(response);
        return true;
      }
    } catch (error) {
      sendApiError(response, error);
      return true;
    }

    sendJson(response, 405, {
      error: { tag: "MethodNotAllowed", message: "Method not allowed." },
    });
    return true;
  }

  if (segments.length === 4 && segments[1] === "projects" && segments[3] === "datasets") {
    const projectId = segments[2]!;

    try {
      if (method === "GET") {
        const datasets = await runCatalog(
          Effect.gen(function* () {
            const store = yield* CatalogStore;
            const project = yield* store.getProject(projectId);
            return project.datasets;
          }),
        );
        sendJson(response, 200, { datasets });
        return true;
      }

      if (method === "POST") {
        const body = await readJsonBody(request);
        const input = decodeCreateDatasetInput(body);
        const dataset = await runCatalog(
          Effect.gen(function* () {
            const store = yield* CatalogStore;
            return yield* store.createDataset(projectId, input);
          }),
        );
        sendJson(response, 201, { dataset });
        return true;
      }
    } catch (error) {
      sendApiError(response, error);
      return true;
    }

    sendJson(response, 405, {
      error: { tag: "MethodNotAllowed", message: "Method not allowed." },
    });
    return true;
  }

  if (
    segments.length === 5 &&
    segments[1] === "projects" &&
    segments[3] === "datasets"
  ) {
    const projectId = segments[2]!;
    const datasetId = segments[4]!;

    try {
      if (method === "GET") {
        const dataset = await runCatalog(
          Effect.gen(function* () {
            const store = yield* CatalogStore;
            return yield* store.getDataset(projectId, datasetId);
          }),
        );
        sendJson(response, 200, { dataset });
        return true;
      }

      if (method === "PATCH") {
        const body = await readJsonBody(request);
        const input = decodeUpdateDatasetInput(body);
        const dataset = await runCatalog(
          Effect.gen(function* () {
            const store = yield* CatalogStore;
            return yield* store.updateDataset(projectId, datasetId, input);
          }),
        );
        sendJson(response, 200, { dataset });
        return true;
      }

      if (method === "DELETE") {
        await runCatalog(
          Effect.gen(function* () {
            const store = yield* CatalogStore;
            yield* store.deleteDataset(projectId, datasetId);
          }),
        );
        sendNoContent(response);
        return true;
      }
    } catch (error) {
      sendApiError(response, error);
      return true;
    }

    sendJson(response, 405, {
      error: { tag: "MethodNotAllowed", message: "Method not allowed." },
    });
    return true;
  }

  sendJson(response, 404, {
    error: { tag: "NotFound", message: "API route not found." },
  });
  return true;
}

export async function startLocalServer(
  options: StartLocalServerOptions,
): Promise<LocalServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_SERVER_PORT;
  const origin = resolveServerOrigin({ host, serverPort: port });
  const startedAt = new Date();
  const sockets = new Set<WebSocket>();
  const databaseFile = options.databaseFile ?? DEFAULT_DATABASE_FILE;

  await mkdir(dirname(databaseFile), { recursive: true });

  const appLayer = makeCatalogStoreLayer(databaseFile);
  const runtime = ManagedRuntime.make(appLayer, {
    memoMap: Layer.makeMemoMapUnsafe(),
  });

  await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* CatalogStore;
      yield* store.listProjects();
    }),
  );

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

  const broadcast = (event: ServerEvent): void => {
    const encoded = JSON.stringify(event);
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(encoded);
      }
    }
  };

  const heartbeatTimer = setInterval(() => {
    const nextEvent = decodeServerEvent({
      type: "server.heartbeat",
      sentAt: new Date().toISOString(),
      snapshot: snapshot(),
      detail: "local server heartbeat",
    });

    Effect.runSync(Effect.sync(() => broadcast(nextEvent)));
  }, 5_000);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", origin);

    void Effect.runPromise(
      Effect.gen(function* () {
        const apiHandled = yield* Effect.promise(() =>
          handleApiRequest(request, response, url, options, origin, runtime, snapshot),
        );
        if (apiHandled) {
          return;
        }

        const staticResponse = yield* Effect.promise(() =>
          serveStaticFile(url.pathname, options.staticDir),
        );

        if (staticResponse) {
          response.writeHead(200, { "content-type": staticResponse.contentType });
          response.end(staticResponse.body);
          return;
        }

        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderFallbackApp(origin));
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            console.error("[lensflare] local server request failed", cause);
            if (!response.headersSent) {
              response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
              response.end("Internal Server Error");
              return;
            }
            if (!response.writableEnded) {
              response.end("Internal Server Error");
            }
          }),
        ),
      ),
    );
  });

  const webSocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", origin);

    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => {
      sockets.delete(socket);
    });
    socket.send(
      JSON.stringify(
        decodeServerEvent({
          type: "server.ready",
          sentAt: new Date().toISOString(),
          snapshot: snapshot(),
          detail: `${options.mode} runtime attached`,
        }),
      ),
    );
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });

  console.log(`[lensflare] ${options.mode} server listening on ${origin}`);

  return {
    origin,
    async stop() {
      clearInterval(heartbeatTimer);

      for (const socket of sockets) {
        socket.close();
      }

      await Promise.all([
        runtime.dispose(),
        new Promise<void>((resolvePromise, reject) => {
          webSocketServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolvePromise();
          });
        }),
        new Promise<void>((resolvePromise, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolvePromise();
          });
        }),
      ]);
    },
  };
}
