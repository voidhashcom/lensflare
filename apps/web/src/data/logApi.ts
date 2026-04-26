import {
  decodeTelemetryLogPage,
  decodeTelemetryRecordPage,
  decodeTelemetryTraceContext,
  type FilterNode,
  type TelemetryLogPage,
  type TelemetryRecordPage,
} from "@lensflare/contracts";
import { Effect, Stream } from "effect";
import type { TraceContext } from "~/components/LogStream/types";
import { resolveBackendHttpUrl } from "./backendTarget";
import { runRpcCallback } from "./rpcConnectionManager";

interface ListDatasetLogsOptions {
  readonly search?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  readonly direction?: "older" | "newer" | undefined;
  readonly filter?: FilterNode | undefined;
}

export interface TelemetryLogField {
  readonly path: ReadonlyArray<string>;
  readonly label: string;
  readonly kind: "string" | "number" | "enum";
  readonly values?: ReadonlyArray<string>;
  readonly frequency?: number;
}

export type TelemetryField = TelemetryLogField;

/**
 * Past this serialized-filter length we stop putting the filter in the URL
 * and switch to POST-ing a JSON body. Keeps us comfortably below the ~2083
 * char cap that some proxies still enforce on GET URLs while giving the
 * user room for ~30-50 simple row filters before we flip over.
 */
const FILTER_GET_MAX_URL_LENGTH = 2000;

function toLogApiError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error("Failed to load logs.");
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Unexpected non-JSON response: ${text.slice(0, 200)}`);
  }
}

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof (payload.error as { message?: unknown }).message === "string"
  ) {
    return (payload.error as { message: string }).message;
  }
  return fallback;
}

export async function listDatasetLogs(
  projectId: string,
  datasetId: string,
  options: ListDatasetLogsOptions = {},
): Promise<TelemetryLogPage> {
  try {
    const filterJson = options.filter ? JSON.stringify(options.filter) : undefined;
    const useGet = !filterJson || filterJson.length <= FILTER_GET_MAX_URL_LENGTH;

    const response = useGet
      ? await issueGetRequest(projectId, datasetId, options, filterJson)
      : await issuePostRequest(projectId, datasetId, options);

    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload, "Failed to load logs."));
    }

    return decodeTelemetryLogPage(payload);
  } catch (error) {
    throw toLogApiError(error);
  }
}

export async function listDatasetTelemetry(
  projectId: string,
  datasetId: string,
  options: ListDatasetLogsOptions = {},
): Promise<TelemetryRecordPage> {
  try {
    const filterJson = options.filter ? JSON.stringify(options.filter) : undefined;
    const useGet = !filterJson || filterJson.length <= FILTER_GET_MAX_URL_LENGTH;

    const response = useGet
      ? await issueTelemetryGetRequest(projectId, datasetId, options, filterJson)
      : await issueTelemetryPostRequest(projectId, datasetId, options);

    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload, "Failed to load telemetry."));
    }

    return decodeTelemetryRecordPage(payload);
  } catch (error) {
    throw toLogApiError(error);
  }
}

async function issueGetRequest(
  projectId: string,
  datasetId: string,
  options: ListDatasetLogsOptions,
  filterJson: string | undefined,
): Promise<Response> {
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
  if (filterJson) {
    search.set("filter", filterJson);
  }

  const url = resolveBackendHttpUrl(
    `/api/projects/${projectId}/datasets/${datasetId}/logs`,
    search,
  );

  return fetch(url, {
    headers: {
      accept: "application/json",
    },
  });
}

async function issuePostRequest(
  projectId: string,
  datasetId: string,
  options: ListDatasetLogsOptions,
): Promise<Response> {
  const url = resolveBackendHttpUrl(`/api/projects/${projectId}/datasets/${datasetId}/logs/query`);

  const body: Record<string, unknown> = {};
  if (options.search) {
    body.search = options.search;
  }
  if (options.limit !== undefined) {
    body.limit = options.limit;
  }
  if (options.cursor) {
    body.cursor = options.cursor;
  }
  if (options.direction) {
    body.direction = options.direction;
  }
  if (options.filter) {
    body.filter = options.filter;
  }

  return fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function issueTelemetryGetRequest(
  projectId: string,
  datasetId: string,
  options: ListDatasetLogsOptions,
  filterJson: string | undefined,
): Promise<Response> {
  const search = new URLSearchParams();
  if (options.search) search.set("search", options.search);
  if (options.limit !== undefined) search.set("limit", String(options.limit));
  if (options.cursor) search.set("cursor", options.cursor);
  if (options.direction) search.set("direction", options.direction);
  if (filterJson) search.set("filter", filterJson);

  const url = resolveBackendHttpUrl(
    `/api/projects/${projectId}/datasets/${datasetId}/telemetry`,
    search,
  );

  return fetch(url, {
    headers: { accept: "application/json" },
  });
}

async function issueTelemetryPostRequest(
  projectId: string,
  datasetId: string,
  options: ListDatasetLogsOptions,
): Promise<Response> {
  const url = resolveBackendHttpUrl(
    `/api/projects/${projectId}/datasets/${datasetId}/telemetry/query`,
  );

  const body: Record<string, unknown> = {};
  if (options.search) body.search = options.search;
  if (options.limit !== undefined) body.limit = options.limit;
  if (options.cursor) body.cursor = options.cursor;
  if (options.direction) body.direction = options.direction;
  if (options.filter) body.filter = options.filter;

  return fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function listDatasetLogFields(
  projectId: string,
  datasetId: string,
): Promise<ReadonlyArray<TelemetryLogField>> {
  try {
    const url = resolveBackendHttpUrl(
      `/api/projects/${projectId}/datasets/${datasetId}/logs/fields`,
    );
    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload, "Failed to load fields."));
    }
    if (
      payload &&
      typeof payload === "object" &&
      "fields" in payload &&
      Array.isArray((payload as { fields?: unknown }).fields)
    ) {
      return (payload as { fields: ReadonlyArray<TelemetryLogField> }).fields;
    }
    return [];
  } catch (error) {
    throw toLogApiError(error);
  }
}

export async function listDatasetTelemetryFields(
  projectId: string,
  datasetId: string,
): Promise<ReadonlyArray<TelemetryField>> {
  try {
    const url = resolveBackendHttpUrl(
      `/api/projects/${projectId}/datasets/${datasetId}/telemetry/fields`,
    );
    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload, "Failed to load fields."));
    }
    if (
      payload &&
      typeof payload === "object" &&
      "fields" in payload &&
      Array.isArray((payload as { fields?: unknown }).fields)
    ) {
      return (payload as { fields: ReadonlyArray<TelemetryField> }).fields;
    }
    return [];
  } catch (error) {
    throw toLogApiError(error);
  }
}

export async function listDatasetLogFieldValues(
  projectId: string,
  datasetId: string,
  path: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  try {
    const search = new URLSearchParams({ field: path.join(".") });
    const url = resolveBackendHttpUrl(
      `/api/projects/${projectId}/datasets/${datasetId}/logs/values`,
      search,
    );
    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload, "Failed to load values."));
    }
    if (
      payload &&
      typeof payload === "object" &&
      "values" in payload &&
      Array.isArray((payload as { values?: unknown }).values)
    ) {
      return (payload as { values: ReadonlyArray<string> }).values;
    }
    return [];
  } catch (error) {
    throw toLogApiError(error);
  }
}

export async function listDatasetTelemetryFieldValues(
  projectId: string,
  datasetId: string,
  path: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  try {
    const search = new URLSearchParams({ field: path.join(".") });
    const url = resolveBackendHttpUrl(
      `/api/projects/${projectId}/datasets/${datasetId}/telemetry/values`,
      search,
    );
    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload, "Failed to load values."));
    }
    if (
      payload &&
      typeof payload === "object" &&
      "values" in payload &&
      Array.isArray((payload as { values?: unknown }).values)
    ) {
      return (payload as { values: ReadonlyArray<string> }).values;
    }
    return [];
  } catch (error) {
    throw toLogApiError(error);
  }
}

export async function getLogTraceContext(
  projectId: string,
  datasetId: string,
  traceId: string,
  spanId?: string,
): Promise<TraceContext | null> {
  try {
    const search = new URLSearchParams();
    if (spanId) {
      search.set("spanId", spanId);
    }

    const url = resolveBackendHttpUrl(
      `/api/projects/${projectId}/datasets/${datasetId}/traces/${traceId}`,
      search,
    );

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
      },
    });

    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload, "Failed to load trace context."));
    }

    const trace = decodeTelemetryTraceContext(payload);
    return trace === null
      ? null
      : {
          ...trace,
          startTime: new Date(trace.startTime),
          spans: trace.spans.map((span) => ({
            ...span,
            events: span.events.map((event) => ({
              ...event,
              timestamp: new Date(event.timestamp),
            })),
          })),
        };
  } catch (error) {
    throw toLogApiError(error);
  }
}

export function subscribeDatasetLogEntries(
  projectId: string,
  datasetId: string,
  onEntry: (entry: TelemetryLogPage["entries"][number]) => void,
  onError?: (error: Error) => void,
  filter?: FilterNode,
): () => void {
  return runRpcCallback(
    (client) =>
      client
        .SubscribeTelemetryLogEvents(
          filter === undefined ? { projectId, datasetId } : { projectId, datasetId, filter },
        )
        .pipe(
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

export function subscribeDatasetTelemetryEntries(
  projectId: string,
  datasetId: string,
  onEntry: (entry: TelemetryRecordPage["entries"][number]) => void,
  onError?: (error: Error) => void,
  filter?: FilterNode,
): () => void {
  return runRpcCallback(
    (client) =>
      client
        .SubscribeTelemetryEvents(
          filter === undefined ? { projectId, datasetId } : { projectId, datasetId, filter },
        )
        .pipe(
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
