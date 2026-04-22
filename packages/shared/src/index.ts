import { homedir } from "node:os";
import { join } from "node:path";
import { APP_NAME } from "./browser.ts";

export * from "./browser.ts";

export interface DataPaths {
  readonly dataDir: string;
  readonly sqliteDatabaseFile: string;
  readonly duckdbDatabaseFile: string;
}

export interface ResolveDataPathsOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: Record<string, string | undefined>;
  readonly homeDirectory?: string;
}

export function resolveDataPaths(options: ResolveDataPathsOptions = {}): DataPaths {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();

  const dataDir =
    platform === "darwin"
      ? join(homeDirectory, "Library", "Application Support", APP_NAME)
      : platform === "win32"
        ? join(env.LOCALAPPDATA?.trim() || join(homeDirectory, "AppData", "Local"), APP_NAME)
        : join(env.XDG_DATA_HOME?.trim() || join(homeDirectory, ".local", "share"), "lensflare");

  return {
    dataDir,
    sqliteDatabaseFile: join(dataDir, "lensflare.sqlite"),
    duckdbDatabaseFile: join(dataDir, "lensflare.duckdb"),
  };
}
