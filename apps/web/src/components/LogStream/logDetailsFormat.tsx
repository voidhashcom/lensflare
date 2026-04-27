import type { ReactNode } from "react";

import type { SpanEventSummary, TelemetryEntry, TraceContext, TraceSpan } from "./types";

/**
 * Ordered list of fields surfaced on the Fields tab. Order is
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
  "events",
];

export interface LogDetailEntry {
  readonly field: string;
  readonly value: unknown;
  /**
   * Optional override for how this entry's value renders. When set, the
   * Fields tab uses this React node instead of the default type-aware
   * renderer. Used by the `events` row to swap the array-as-JSON dump
   * for a button that opens the events sub-panel.
   *
   * `value` is still consulted for null-filtering — if you want a row to
   * always be visible regardless of `showNullValues`, set `value` to
   * something non-null-like (e.g. the underlying source array).
   */
  readonly renderValue?: ReactNode;
}

/**
 * Flattens a {@link LogEntry} into a list of field/value pairs for display.
 * Values are raw (not yet stringified) so the renderer can colour them
 * according to type.
 */
export function buildLogDetailEntries(log: TelemetryEntry): ReadonlyArray<LogDetailEntry> {
  return LOG_DETAIL_FIELDS.map((field) => ({ field, value: getLogDetailValue(log, field) }));
}

/**
 * Returns each entry on `log.attributes` as its own field/value pair so the
 * Fields tab can render attributes alongside the canonical fields instead of
 * as a nested JSON blob. Iteration order matches the source object
 * — we deliberately don't sort keys so the UI stays stable across renders and
 * mirrors the order produced by the SDK.
 */
export function buildLogAttributeEntries(log: TelemetryEntry): ReadonlyArray<LogDetailEntry> {
  return Object.entries(log.attributes).map(([field, value]) => ({ field, value }));
}

/**
 * Builds field/value pairs for a {@link TraceSpan} so the trace explorer can
 * feed the same Fields tab as {@link buildLogDetailEntries}. The set of
 * fields is intentionally aligned with the canonical span entries surfaced
 * for {@link TelemetryEntry}, with two differences:
 *
 * 1. We add `start.offset.us` because the trace context expresses each span
 *    as an offset from the trace start, and seeing that offset is useful
 *    while exploring a waterfall.
 * 2. We omit fields that the trace context schema doesn't carry (the
 *    LensflareRecordId-style `id`, source icon, log-only `level`/`message`).
 *
 * `timestamp` is derived from `trace.startTime + span.startOffsetUs` so the
 * value matches what the log-stream details panel shows for the same span.
 */
export function buildSpanDetailEntries(
  span: TraceSpan,
  trace: TraceContext,
): ReadonlyArray<LogDetailEntry> {
  const startTime = new Date(trace.startTime.getTime() + span.startOffsetUs / 1_000).toISOString();
  return [
    { field: "kind", value: "span" },
    { field: "timestamp", value: startTime },
    { field: "status", value: span.status },
    { field: "source.name", value: span.serviceName },
    { field: "name", value: span.name },
    { field: "duration.us", value: span.durationUs },
    { field: "start.offset.us", value: span.startOffsetUs },
    { field: "trace.id", value: trace.traceId },
    { field: "span.id", value: span.id },
    { field: "parent.span.id", value: span.parentSpanId },
    { field: "service.name", value: span.serviceName },
    { field: "status.message", value: span.statusMessage },
    // Same shape as `buildLogDetailEntries`'s events row: emit an array
    // for non-empty event lists so the consumer can `.map(…)` and swap
    // the value for an "Events N" button. Empty arrays become null so
    // the row drops out under the default null-filter.
    { field: "events", value: span.events.length > 0 ? span.events : null },
  ];
}

/**
 * Same idea as {@link buildLogAttributeEntries} but reading from a
 * {@link TraceSpan}. Kept as a separate helper so the call sites read
 * naturally — the underlying shape is the same `Record<string, unknown>`.
 */
export function buildSpanAttributeEntries(span: TraceSpan): ReadonlyArray<LogDetailEntry> {
  return Object.entries(span.attributes).map(([field, value]) => ({ field, value }));
}

/**
 * Parent-span context an event needs to mirror the "spanEvent" fields
 * surfaced on {@link TelemetryEntry}. The event itself only carries
 * `id`/`timestamp`/`name`/`attributes`; the canonical fields like
 * `trace.id`, `span.id`, `service.name` come from whichever span the
 * event belongs to.
 */
export interface EventParentContext {
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly serviceName: string | null;
  readonly sourceName: string | null;
}

/**
 * Builds Fields-tab entries for a single span event. Field set is
 * intentionally aligned with the `spanEvent` projection of
 * {@link TelemetryEntry} so the events sub-panel feels like a natural
 * peer of the top-level details panel.
 */
export function buildEventDetailEntries(
  event: SpanEventSummary,
  parent: EventParentContext,
): ReadonlyArray<LogDetailEntry> {
  return [
    { field: "kind", value: "spanEvent" },
    { field: "id", value: event.id },
    { field: "timestamp", value: event.timestamp.toISOString() },
    { field: "name", value: event.name },
    { field: "trace.id", value: parent.traceId },
    { field: "span.id", value: parent.spanId },
    { field: "source.name", value: parent.sourceName ?? parent.serviceName },
    { field: "service.name", value: parent.serviceName },
  ];
}

export function buildEventAttributeEntries(event: SpanEventSummary): ReadonlyArray<LogDetailEntry> {
  return Object.entries(event.attributes).map(([field, value]) => ({ field, value }));
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
    case "events":
      // Treat empty arrays as null-like so the row drops out under the
      // default "hide null values" filter. The Fields tab swaps this row
      // for a button that opens the events sub-panel; an empty array
      // would otherwise produce an "Events 0" button that does nothing.
      return log.kind === "span" && log.events.length > 0 ? log.events : null;
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
  const rendered =
    typeof value === "function"
      ? value.name || "function"
      : typeof value === "symbol"
        ? (value.description ?? value.toString())
        : "";
  return <span className="text-foreground/60">{rendered}</span>;
}
