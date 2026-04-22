import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_WEB_DEV_PORT,
  readRuntimeConfigFromEnv,
  resolveDataPaths,
  resolveServerOrigin,
  resolveWebDevUrl,
  resolveWebSocketOrigin,
} from "./index.ts";

describe("@lensflare/shared", () => {
  it("falls back to default ports", () => {
    const config = readRuntimeConfigFromEnv({});

    expect(config.serverPort).toBe(DEFAULT_SERVER_PORT);
    expect(config.webDevPort).toBe(DEFAULT_WEB_DEV_PORT);
  });

  it("builds stable URLs", () => {
    expect(resolveServerOrigin({ host: "127.0.0.1", serverPort: 43110 })).toBe(
      "http://127.0.0.1:43110",
    );
    expect(resolveWebSocketOrigin("http://127.0.0.1:43110")).toBe(
      "ws://127.0.0.1:43110/",
    );
    expect(resolveWebDevUrl({ host: "localhost", webDevPort: 5173 })).toBe(
      "http://localhost:5173",
    );
  });

  it("resolves standardized data paths per platform", () => {
    expect(
      resolveDataPaths({
        platform: "darwin",
        homeDirectory: "/Users/tester",
      }),
    ).toEqual({
      dataDir: "/Users/tester/Library/Application Support/Lensflare",
      sqliteDatabaseFile: "/Users/tester/Library/Application Support/Lensflare/lensflare.sqlite",
      duckdbDatabaseFile: "/Users/tester/Library/Application Support/Lensflare/lensflare.duckdb",
    });

    expect(
      resolveDataPaths({
        platform: "linux",
        homeDirectory: "/home/tester",
        env: {},
      }),
    ).toEqual({
      dataDir: "/home/tester/.local/share/lensflare",
      sqliteDatabaseFile: "/home/tester/.local/share/lensflare/lensflare.sqlite",
      duckdbDatabaseFile: "/home/tester/.local/share/lensflare/lensflare.duckdb",
    });

    expect(
      resolveDataPaths({
        platform: "win32",
        homeDirectory: "C:\\Users\\tester",
        env: {
          LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        },
      }),
    ).toEqual({
      dataDir: "C:\\Users\\tester\\AppData\\Local/Lensflare",
      sqliteDatabaseFile: "C:\\Users\\tester\\AppData\\Local/Lensflare/lensflare.sqlite",
      duckdbDatabaseFile: "C:\\Users\\tester\\AppData\\Local/Lensflare/lensflare.duckdb",
    });
  });
});
