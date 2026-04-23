import * as FS from "node:fs";
import * as Path from "node:path";
import type { DesktopUpdateChannel } from "@lensflare/contracts";

import { resolveDefaultDesktopUpdateChannel } from "./updateChannels.ts";

export interface DesktopSettings {
  readonly updateChannel: DesktopUpdateChannel;
  readonly updateChannelConfiguredByUser: boolean;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  updateChannel: "latest",
  updateChannelConfiguredByUser: false,
};

export function resolveDefaultDesktopSettings(appVersion: string): DesktopSettings {
  return {
    ...DEFAULT_DESKTOP_SETTINGS,
    updateChannel: resolveDefaultDesktopUpdateChannel(appVersion),
  };
}

export function setDesktopUpdateChannelPreference(
  settings: DesktopSettings,
  requestedChannel: DesktopUpdateChannel,
): DesktopSettings {
  return {
    ...settings,
    updateChannel: requestedChannel,
    updateChannelConfiguredByUser: true,
  };
}

export function readDesktopSettings(settingsPath: string, appVersion: string): DesktopSettings {
  const defaultSettings = resolveDefaultDesktopSettings(appVersion);

  try {
    if (!FS.existsSync(settingsPath)) {
      return defaultSettings;
    }

    const parsed = JSON.parse(FS.readFileSync(settingsPath, "utf8")) as {
      readonly updateChannel?: unknown;
      readonly updateChannelConfiguredByUser?: unknown;
    };
    const parsedUpdateChannel =
      parsed.updateChannel === "nightly" || parsed.updateChannel === "latest"
        ? parsed.updateChannel
        : null;
    const updateChannelConfiguredByUser = parsed.updateChannelConfiguredByUser === true;

    return {
      updateChannel:
        updateChannelConfiguredByUser && parsedUpdateChannel !== null
          ? parsedUpdateChannel
          : defaultSettings.updateChannel,
      updateChannelConfiguredByUser,
    };
  } catch {
    return defaultSettings;
  }
}

export function writeDesktopSettings(settingsPath: string, settings: DesktopSettings): void {
  const directory = Path.dirname(settingsPath);
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, settingsPath);
}
