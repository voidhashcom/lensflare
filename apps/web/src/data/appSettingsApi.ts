import {
  decodeAppMeta,
  type AppMeta,
  type AppSettings,
  type UpdateAppSettingsInput,
} from "@lensflare/contracts";

import { resolveBackendHttpUrl } from "./backendTarget";
import { runRpc } from "./rpcConnectionManager";

function toAppSettingsError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error("Failed to load app settings.");
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return null;
  }
  return JSON.parse(text);
}

export async function getAppSettings(): Promise<AppSettings> {
  try {
    return await runRpc((client) => client.GetAppSettings());
  } catch (error) {
    throw toAppSettingsError(error);
  }
}

export async function updateAppSettings(input: UpdateAppSettingsInput): Promise<AppSettings> {
  try {
    return await runRpc((client) => client.UpdateAppSettings(input));
  } catch (error) {
    throw toAppSettingsError(error);
  }
}

export async function getAppMeta(): Promise<AppMeta> {
  const response = await fetch(resolveBackendHttpUrl("/api/meta"), {
    headers: { accept: "application/json" },
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error("Failed to load app metadata.");
  }
  return decodeAppMeta(payload);
}
