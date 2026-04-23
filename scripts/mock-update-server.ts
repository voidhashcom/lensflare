#!/usr/bin/env node

import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, relative, resolve } from "node:path";

export interface MockUpdateServerOptions {
  readonly port: number;
  readonly root: string;
}

function isOutsideRoot(rootRealPath: string, filePath: string): boolean {
  const relativePath = relative(rootRealPath, filePath);
  return (
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("..\\") ||
    relativePath === ""
  );
}

export function resolveRequestedFilePath(
  rootRealPath: string,
  requestUrl: string | undefined,
): string | null {
  const rawPath = (requestUrl ?? "/").split("?", 1)[0] ?? "/";
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  if (!decodedPath || decodedPath.includes("\0")) {
    return null;
  }

  const filePath = resolve(
    rootRealPath,
    `.${decodedPath.startsWith("/") ? decodedPath : `/${decodedPath}`}`,
  );

  return isOutsideRoot(rootRealPath, filePath) ? null : filePath;
}

function isServableFile(rootRealPath: string, filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    return false;
  }
  const realFilePath = realpathSync(filePath);
  return !isOutsideRoot(rootRealPath, realFilePath);
}

function getContentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".yml" || extension === ".yaml") return "text/yaml";
  if (extension === ".json") return "application/json";
  if (extension === ".blockmap") return "application/octet-stream";
  if (extension === ".dmg") return "application/x-apple-diskimage";
  if (extension === ".exe") return "application/vnd.microsoft.portable-executable";
  return "application/octet-stream";
}

export function createMockUpdateRequestHandler(rootRealPath: string) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const filePath = resolveRequestedFilePath(rootRealPath, request.url);
    if (!filePath || !isServableFile(rootRealPath, filePath)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }

    response.writeHead(200, { "content-type": getContentType(filePath) });
    createReadStream(filePath).pipe(response);
  };
}

export function resolveMockUpdateServerOptions(
  env: NodeJS.ProcessEnv = process.env,
): MockUpdateServerOptions {
  const port = Number.parseInt(env.LENSFLARE_DESKTOP_MOCK_UPDATE_SERVER_PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("LENSFLARE_DESKTOP_MOCK_UPDATE_SERVER_PORT must be a valid TCP port.");
  }

  return {
    port,
    root: resolve(env.LENSFLARE_DESKTOP_MOCK_UPDATE_SERVER_ROOT ?? "release-mock"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = resolveMockUpdateServerOptions();
    const rootRealPath = realpathSync(options.root);
    const server = createServer(createMockUpdateRequestHandler(rootRealPath));
    server.listen(options.port, "localhost", () => {
      console.log(`Mock update server listening on http://localhost:${options.port}`);
      console.log(`Serving ${rootRealPath}`);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
