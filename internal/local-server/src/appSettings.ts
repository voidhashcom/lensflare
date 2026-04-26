import type { AnalyticsBootstrap, AppSettings, UpdateAppSettingsInput } from "@lensflare/contracts";
import { resolveDataPaths, type RuntimeConfig } from "@lensflare/shared";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  analyticsEnabled: true,
};

export interface LocalAppStatePaths {
  readonly appSettingsFile: string;
  readonly analyticsAnonymousIdFile: string;
}

export function resolveLocalAppStatePaths(): LocalAppStatePaths {
  const { dataDir } = resolveDataPaths();
  return {
    appSettingsFile: join(dataDir, "app-settings.json"),
    analyticsAnonymousIdFile: join(dataDir, "analytics-anonymous-id"),
  };
}

export async function readPersistedAppSettings(
  filePath: string = resolveLocalAppStatePaths().appSettingsFile,
): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as Partial<AppSettings>;
    return {
      analyticsEnabled: raw.analyticsEnabled !== false,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export async function writePersistedAppSettings(
  settings: AppSettings,
  filePath: string = resolveLocalAppStatePaths().appSettingsFile,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export function mergeAppSettings(
  current: AppSettings,
  input: UpdateAppSettingsInput,
): AppSettings {
  return {
    analyticsEnabled: input.analyticsEnabled ?? current.analyticsEnabled,
  };
}

async function readOrCreateAnonymousId(filePath: string): Promise<string> {
  try {
    const value = (await readFile(filePath, "utf8")).trim();
    if (value.length > 0) {
      return value;
    }
  } catch {
    // Fall through to create.
  }

  await mkdir(dirname(filePath), { recursive: true });
  const next = randomUUID();
  await writeFile(filePath, next, "utf8");
  return next;
}

export async function readHashedAnalyticsDistinctId(
  filePath: string = resolveLocalAppStatePaths().analyticsAnonymousIdFile,
): Promise<string> {
  const anonymousId = await readOrCreateAnonymousId(filePath);
  return createHash("sha256").update(anonymousId).digest("hex");
}

export async function resolveAnalyticsBootstrap(
  runtimeConfig: Pick<RuntimeConfig, "posthogApiKey" | "posthogDebug" | "posthogEnabled" | "posthogHost">,
  settingsPath: string = resolveLocalAppStatePaths().appSettingsFile,
  distinctIdPath: string = resolveLocalAppStatePaths().analyticsAnonymousIdFile,
): Promise<AnalyticsBootstrap> {
  const settings = await readPersistedAppSettings(settingsPath);
  return {
    enabled: runtimeConfig.posthogEnabled && settings.analyticsEnabled,
    distinctId: await readHashedAnalyticsDistinctId(distinctIdPath),
    host: runtimeConfig.posthogHost,
    ...(runtimeConfig.posthogApiKey ? { apiKey: runtimeConfig.posthogApiKey } : {}),
    debug: runtimeConfig.posthogDebug,
  };
}
