import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createMockUpdateRequestHandler } from "./mock-update-server.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function withMockServer<T>(
  rootRealPath: string,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer(createMockUpdateRequestHandler(rootRealPath));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve mock server address.");
  }
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error: Error | undefined) => (error ? reject(error) : resolve()));
    });
  }
}

describe("mock-update-server", () => {
  it("serves files from the configured root", async () => {
    const root = makeTempDir("lensflare-mock-update-root-");
    writeFileSync(join(root, "latest.yml"), "version: 0.1.0\n", "utf8");

    await withMockServer(realpathSync(root), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/latest.yml`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/yaml");
      expect(await response.text()).toBe("version: 0.1.0\n");
    });
  });

  it("rejects encoded path traversal outside the configured root", async () => {
    const root = makeTempDir("lensflare-mock-update-root-");
    const outside = makeTempDir("lensflare-mock-update-outside-");
    writeFileSync(join(outside, "secret.txt"), "nope\n", "utf8");

    await withMockServer(realpathSync(root), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/%2e%2e/secret.txt`);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
    });
  });

  it("rejects symlinked files that escape the configured root", async () => {
    const root = makeTempDir("lensflare-mock-update-root-");
    const outside = makeTempDir("lensflare-mock-update-outside-");
    const outsideFile = join(outside, "outside.yml");
    const linksDir = join(root, "links");
    writeFileSync(outsideFile, "version: outside\n", "utf8");
    mkdirSync(linksDir);
    symlinkSync(outsideFile, join(linksDir, "outside.yml"));

    await withMockServer(realpathSync(root), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/links/outside.yml`);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
    });
  });
});
