import { describe, expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_APP_SETTINGS,
  readHashedAnalyticsDistinctId,
  readPersistedAppSettings,
  resolveAnalyticsBootstrap,
  writePersistedAppSettings,
} from "./appSettings.ts";

describe("appSettings", () => {
  it("returns default settings when no file exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-app-settings-"));

    try {
      const settings = await readPersistedAppSettings(join(directory, "app-settings.json"));
      expect(settings).toEqual(DEFAULT_APP_SETTINGS);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists analytics settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-app-settings-"));
    const settingsPath = join(directory, "app-settings.json");

    try {
      await writePersistedAppSettings({ analyticsEnabled: false }, settingsPath);
      const settings = await readPersistedAppSettings(settingsPath);
      expect(settings).toEqual({ analyticsEnabled: false });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the hashed anonymous distinct id stable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-app-settings-"));
    const distinctIdPath = join(directory, "analytics-anonymous-id");

    try {
      const first = await readHashedAnalyticsDistinctId(distinctIdPath);
      const second = await readHashedAnalyticsDistinctId(distinctIdPath);

      expect(first).toBe(second);
      expect(first).toHaveLength(64);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resolves analytics bootstrap from env config and persisted settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lensflare-app-settings-"));
    const settingsPath = join(directory, "app-settings.json");
    const distinctIdPath = join(directory, "analytics-anonymous-id");

    try {
      await writePersistedAppSettings({ analyticsEnabled: false }, settingsPath);
      const bootstrap = await resolveAnalyticsBootstrap(
        {
          posthogEnabled: true,
          posthogApiKey: "phc_test",
          posthogHost: "https://eu.i.posthog.com",
          posthogDebug: true,
        },
        settingsPath,
        distinctIdPath,
      );

      expect(bootstrap.enabled).toBe(false);
      expect(bootstrap.apiKey).toBe("phc_test");
      expect(bootstrap.host).toBe("https://eu.i.posthog.com");
      expect(bootstrap.debug).toBe(true);
      expect(bootstrap.distinctId).toHaveLength(64);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
