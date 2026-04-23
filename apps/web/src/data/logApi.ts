import { decodeTelemetryLogPage, type TelemetryLogPage } from "@lensflare/contracts";
import { Effect, Stream } from "effect";
import { resolveBackendHttpUrl } from "./backendTarget";
import { runRpcCallback } from "./rpcConnectionManager";

interface ListDatasetLogsOptions {
  readonly search?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  readonly direction?: "older" | "newer" | undefined;
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
): Promise<TelemetryLogPage> {
  try {
    const search = new URLSearchParams();
    if (options.search) {
      search.set("search", options.search);
    }
    if (options.limit !== undefined) {
      search.set("limit", String(options.limit));
    }
    if (options.cursor) {
      search.set("cursor", options.cursor);
    }
    if (options.direction) {
      search.set("direction", options.direction);
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

    return decodeTelemetryLogPage(payload);
  } catch (error) {
    throw toLogApiError(error);
  }
}

export function subscribeDatasetLogEntries(
  projectId: string,
  datasetId: string,
  onEntry: (entry: TelemetryLogPage["entries"][number]) => void,
  onError?: (error: Error) => void,
): () => void {
  return runRpcCallback(
    (client) =>
      client.SubscribeTelemetryLogEvents({ projectId, datasetId }).pipe(
        Stream.runForEach((entry) =>
          Effect.sync(() => {
            onEntry(entry);
          }),
        ),
      ),
    {
      onError: (error) => {
        onError?.(toLogApiError(error));
      },
    },
  );
}
