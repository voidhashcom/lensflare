import type { ReactNode } from "react";

import type { TelemetryEntry } from "./types";

/**
 * Ordered list of fields surfaced on the Event Properties tab. Order is
 * chosen to mirror the reference log-details sheet: primitive scalars first,
 * then compound data near the bottom. Each entry points at a value extracted
 * from the log by {@link getLogDetailValue}.
 *
 * IMPORTANT: Keep the order stable — the table renders in iteration order so
 * moving entries here reshuffles the UI.
 */
const LOG_DETAIL_FIELDS: ReadonlyArray<string> = [
  "kind",
  "id",
  "timestamp",
  "level",
  "status",
  "source.name",
  "source.icon",
  "message",
  "name",
  "duration.us",
  "trace.id",
  "span.id",
  "parent.span.id",
  "service.name",
  "status.message",
  "attributes",
  "events",
];

export interface LogDetailEntry {
  readonly field: string;
  readonly value: unknown;
}

/**
 * Flattens a {@link LogEntry} into a list of field/value pairs for display.
 * Values are raw (not yet stringified) so the renderer can colour them
 * according to type.
 */
export function buildLogDetailEntries(log: TelemetryEntry): ReadonlyArray<LogDetailEntry> {
  return LOG_DETAIL_FIELDS.map((field) => ({ field, value: getLogDetailValue(log, field) }));
}

function getLogDetailValue(log: TelemetryEntry, field: string): unknown {
  switch (field) {
    case "kind":
      return log.kind;
    case "id":
      return log.id;
    case "timestamp":
      return log.timestamp.toISOString();
    case "level":
      return log.kind === "log" ? log.level : null;
    case "status":
      return log.kind === "span" ? log.status : null;
    case "source.name":
      return log.sourceName;
    case "source.icon":
      return log.sourceIcon;
    case "message":
      return log.kind === "log" ? log.message : null;
    case "name":
      return log.kind === "span" || log.kind === "spanEvent" ? log.name : null;
    case "duration.us":
      return log.kind === "span" ? log.durationUs : null;
    case "trace.id":
      return log.traceId ?? null;
    case "span.id":
      return log.spanId ?? null;
    case "parent.span.id":
      return log.kind === "span" ? log.parentSpanId : null;
    case "service.name":
      return log.kind === "span" || log.kind === "spanEvent" ? log.serviceName : null;
    case "status.message":
      return log.kind === "span" ? log.statusMessage : null;
    case "attributes":
      return log.attributes;
    case "events":
      return log.kind === "span" ? log.events : null;
    default:
      return null;
  }
}

/**
 * Builds the object rendered on the "Raw Data" tab. Returns a plain
 * JSON-friendly shape (timestamps serialised to ISO strings) so it round-trips
 * through `JSON.stringify` without losing information.
 */
export function buildLogRawData(log: TelemetryEntry): unknown {
  if (log.kind === "span") {
    return {
      id: log.id,
      kind: log.kind,
      timestamp: log.timestamp.toISOString(),
      sourceName: log.sourceName,
      traceId: log.traceId,
      spanId: log.spanId,
      parentSpanId: log.parentSpanId,
      name: log.name,
      serviceName: log.serviceName,
      status: log.status,
      statusMessage: log.statusMessage,
      durationUs: log.durationUs,
      attributes: log.attributes,
      events: log.events.map((event) => ({
        ...event,
        timestamp: event.timestamp.toISOString(),
      })),
    };
  }
  if (log.kind === "spanEvent") {
    return {
      id: log.id,
      kind: log.kind,
      timestamp: log.timestamp.toISOString(),
      sourceName: log.sourceName,
      traceId: log.traceId,
      spanId: log.spanId,
      name: log.name,
      serviceName: log.serviceName,
      attributes: log.attributes,
    };
  }
  return {
    id: log.id,
    kind: log.kind,
    timestamp: log.timestamp.toISOString(),
    level: log.level,
    source: {
      name: log.sourceName,
      icon: log.sourceIcon,
    },
    message: log.message,
    traceId: log.traceId ?? null,
    spanId: log.spanId ?? null,
    attributes: log.attributes,
  };
}

/**
 * Returns `true` when a value should be hidden under the "Show null values"
 * toggle. We treat empty strings as null because otherwise the UI shows a
 * confusing blank value cell.
 */
export function isNullLike(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string" && value.length === 0) return true;
  return false;
}

/**
 * Renders a primitive or nested value as React nodes with palette-aligned
 * syntax highlighting. Objects and arrays recurse into pretty-printed JSON —
 * we roll our own renderer instead of pulling in a dependency so we can
 * colour specific tokens (keys, strings, numbers, booleans, null) exactly
 * like the reference design.
 */
export function renderDetailValue(value: unknown): ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-zinc-500 dark:text-zinc-400">null</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-emerald-600 dark:text-emerald-300">{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="text-cyan-600 dark:text-cyan-300">{value}</span>;
  }
  if (typeof value === "bigint") {
    return <span className="text-cyan-600 dark:text-cyan-300">{value.toString()}</span>;
  }
  if (typeof value === "string") {
    return <span className="text-foreground/90">{value}</span>;
  }

  // Arrays and objects: pretty-print with two-space indentation and colour
  // the individual tokens. We intentionally avoid `JSON.stringify(replacer)`
  // so we can place React nodes (colour spans) in the output.
  return <pre className="whitespace-pre-wrap break-all">{renderJsonTokens(value, 0)}</pre>;
}

/**
 * Recursive JSON pretty-printer that yields React nodes. Keeps whitespace
 * readable (two-space indent, one key/value per line for compound values,
 * inline rendering for empty arrays/objects).
 */
function renderJsonTokens(value: unknown, depth: number): ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-zinc-500 dark:text-zinc-400">null</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-emerald-600 dark:text-emerald-300">{String(value)}</span>;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return <span className="text-cyan-600 dark:text-cyan-300">{value.toString()}</span>;
  }
  if (typeof value === "string") {
    return <span className="text-orange-600 dark:text-orange-300">{JSON.stringify(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-foreground/80">[]</span>;
    const inner = " ".repeat((depth + 1) * 2);
    const outer = " ".repeat(depth * 2);
    return (
      <>
        <span className="text-foreground/80">[</span>
        {value.map((item, index) => (
          // Index keys are safe here — the array is derived from the log which
          // is immutable for the lifetime of this render.
          // eslint-disable-next-line react/no-array-index-key
          <span key={index}>
            {"\n"}
            {inner}
            {renderJsonTokens(item, depth + 1)}
            {index < value.length - 1 ? <span className="text-foreground/60">,</span> : null}
          </span>
        ))}
        {"\n"}
        {outer}
        <span className="text-foreground/80">]</span>
      </>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-foreground/80">{"{}"}</span>;
    const inner = " ".repeat((depth + 1) * 2);
    const outer = " ".repeat(depth * 2);
    return (
      <>
        <span className="text-foreground/80">{"{"}</span>
        {entries.map(([key, val], index) => (
          <span key={key}>
            {"\n"}
            {inner}
            <span className="text-sky-700 dark:text-sky-300">{JSON.stringify(key)}</span>
            <span className="text-foreground/60">: </span>
            {renderJsonTokens(val, depth + 1)}
            {index < entries.length - 1 ? <span className="text-foreground/60">,</span> : null}
          </span>
        ))}
        {"\n"}
        {outer}
        <span className="text-foreground/80">{"}"}</span>
      </>
    );
  }

  // Fallback for exotic types (symbols, functions). Shouldn't happen with our
  // log shape but we want to render *something* instead of throwing.
  return <span className="text-foreground/60">{String(value)}</span>;
}
