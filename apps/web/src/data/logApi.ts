import { decodeTelemetryLogEntries, type TelemetryLogEntry } from "@lensflare/contracts";
import { resolveBackendHttpUrl } from "./backendTarget";

interface ListDatasetLogsOptions {
  readonly search?: string | undefined;
  readonly limit?: number | undefined;
}

function toLogApiError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error("Failed to load logs.");
}

export async function listDatasetLogs(
  projectId: string,
  datasetId: string,
  options: ListDatasetLogsOptions = {},
): Promise<Array<TelemetryLogEntry>> {
  try {
    const search = new URLSearchParams();
    if (options.search) {
      search.set("search", options.search);
    }
    if (options.limit !== undefined) {
      search.set("limit", String(options.limit));
    }

    const url = resolveBackendHttpUrl(
      `/api/projects/${projectId}/datasets/${datasetId}/logs`,
      search,
    );

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
      },
    });

    const payload = await response.json();
    if (!response.ok) {
      const message =
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : "Failed to load logs.";
      throw new Error(message);
    }

    return decodeTelemetryLogEntries(payload);
  } catch (error) {
    throw toLogApiError(error);
  }
}
