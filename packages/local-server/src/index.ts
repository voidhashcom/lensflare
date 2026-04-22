import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize, resolve, sep } from "node:path";
import { decodeServerEvent, type ServerEvent, type ServerSnapshot } from "@lensflare/contracts";
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_HOST,
  DEFAULT_SERVER_PORT,
  resolveServerOrigin,
} from "@lensflare/shared";
import { Effect } from "effect";
import WebSocket, { WebSocketServer } from "ws";

export interface StartLocalServerOptions {
  mode: "desktop" | "server";
  host?: string;
  port?: number;
  staticDir?: string;
  staticAssetMode?: ServerSnapshot["staticAssetMode"];
}

export interface LocalServerHandle {
  origin: string;
  stop: () => Promise<void>;
}

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

export async function startLocalServer(
  options: StartLocalServerOptions,
): Promise<LocalServerHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_SERVER_PORT;
  const origin = resolveServerOrigin({ host, serverPort: port });
  const startedAt = new Date();
  const sockets = new Set<WebSocket>();

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
        if (url.pathname === "/api/health") {
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(snapshot(), null, 2));
          return;
        }

        if (url.pathname === "/api/meta") {
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify(
              {
                appName: APP_NAME,
                appVersion: APP_VERSION,
                serverOrigin: origin,
                mode: options.mode,
              },
              null,
              2,
            ),
          );
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
            }
            response.end("Internal Server Error");
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
