import { APP_NAME } from "@lensflare/shared";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, normalize, resolve, sep } from "node:path";

/**
 * Best-effort `Content-Type` lookup for the small set of asset extensions
 * the local server actually serves. Falls through to HTML so a directory
 * URL or extensionless path still renders in the browser.
 */
export function inferContentType(pathname: string): string {
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

export interface StaticFileResponse {
  readonly body: Buffer;
  readonly contentType: string;
}

/**
 * Serve a file from `staticDir`, falling back to `index.html` so SPA
 * deep-links work, and refusing requests that try to escape the root via
 * `../` segments.
 */
export async function serveStaticFile(
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

  // Reject path-traversal attempts: candidatePath must be inside rootDir.
  const isInsideRoot = candidatePath === rootDir || candidatePath.startsWith(`${rootDir}${sep}`);

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

/**
 * Minimal in-memory landing page used when no built web bundle is mounted
 * (e.g. running the desktop binary in isolation, or a fresh `pnpm dev`
 * before `apps/web` has produced a build).
 */
export function renderFallbackApp(origin: string): string {
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
