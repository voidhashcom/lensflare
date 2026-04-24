import type { TelemetryRecord } from "@lensflare/contracts";

import type { SourceIconKind, TelemetryEntry } from "./types";

export function toTelemetryEntry(
  entry: TelemetryRecord,
  datasetName: string,
  datasetIcon: SourceIconKind,
): TelemetryEntry {
  const parsedTimestamp = new Date(entry.timestamp);
  const timestamp = Number.isNaN(parsedTimestamp.getTime()) ? new Date() : parsedTimestamp;

  if (entry.kind === "span") {
    return {
      id: entry.id,
      kind: "span",
      timestamp,
      sourceName: entry.sourceName || datasetName,
      sourceIcon: inferSourceIcon(entry.sourceName, datasetIcon),
      traceId: entry.traceId,
      spanId: entry.spanId,
      parentSpanId: entry.parentSpanId,
      name: entry.name,
      serviceName: entry.serviceName,
      status: entry.status,
      statusMessage: entry.statusMessage,
      durationUs: entry.durationUs,
      attributes: entry.attributes,
      events: entry.events.map((event) => {
        const eventTimestamp = new Date(event.timestamp);
        return {
          ...event,
          timestamp: Number.isNaN(eventTimestamp.getTime()) ? timestamp : eventTimestamp,
        };
      }),
    };
  }

  if (entry.kind === "spanEvent") {
    return {
      id: entry.id,
      kind: "spanEvent",
      timestamp,
      sourceName: entry.sourceName || datasetName,
      sourceIcon: inferSourceIcon(entry.sourceName, datasetIcon),
      traceId: entry.traceId,
      spanId: entry.spanId,
      name: entry.name,
      serviceName: entry.serviceName,
      attributes: entry.attributes,
    };
  }

  return {
    id: entry.id,
    kind: "log",
    timestamp,
    sourceName: entry.sourceName || datasetName,
    sourceIcon: inferSourceIcon(entry.sourceName, datasetIcon),
    level: entry.level,
    message: entry.message,
    ...(entry.traceId ? { traceId: entry.traceId } : {}),
    ...(entry.spanId ? { spanId: entry.spanId } : {}),
    attributes: entry.attributes,
  };
}

export function mergeUniqueLogs(
  first: ReadonlyArray<TelemetryEntry>,
  second: ReadonlyArray<TelemetryEntry>,
): ReadonlyArray<TelemetryEntry> {
  const byId = new Map<string, TelemetryEntry>();
  for (const log of first) {
    byId.set(log.id, log);
  }
  for (const log of second) {
    byId.set(log.id, log);
  }

  return sortTelemetryEntries([...byId.values()]);
}

export function sortTelemetryEntries(
  logs: ReadonlyArray<TelemetryEntry>,
): ReadonlyArray<TelemetryEntry> {
  return [...logs].sort(compareLogEntries);
}

export function trimNewestTelemetryEntries(
  logs: ReadonlyArray<TelemetryEntry>,
  limit: number,
): ReadonlyArray<TelemetryEntry> {
  if (logs.length <= limit) {
    return logs;
  }
  return logs.slice(logs.length - limit);
}

export function compareLogEntries(left: TelemetryEntry, right: TelemetryEntry): number {
  const timestampDelta = left.timestamp.getTime() - right.timestamp.getTime();
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return left.id.localeCompare(right.id);
}

function inferSourceIcon(sourceName: string, fallback: SourceIconKind): SourceIconKind {
  const normalized = sourceName.trim().toLowerCase();
  if (normalized.includes("typescript") || normalized.includes("lensflare")) {
    return "ts";
  }
  if (normalized.includes("javascript") || normalized.endsWith("-js")) {
    return "js";
  }
  if (normalized.includes("python") || normalized.endsWith("-py")) {
    return "py";
  }
  if (normalized.includes("ruby") || normalized.endsWith("-rb")) {
    return "rb";
  }
  if (normalized.includes("rust") || normalized.endsWith("-rs")) {
    return "rs";
  }
  if (normalized.includes("golang") || normalized === "go" || normalized.endsWith("-go")) {
    return "go";
  }
  if (normalized.includes("java")) {
    return "java";
  }
  return fallback;
}
