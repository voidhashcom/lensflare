import {
  type TelemetryFilterCatalogChangeEvent,
  type TelemetryFilterCatalogEntry,
} from "@lensflare/contracts";
import { Context, Effect, Layer, Option, PubSub, Stream } from "effect";
import { SqlError } from "effect/unstable/sql";
import { datasetFromRow, DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { DuckDbError, TelemetryStore } from "./telemetryStore.ts";
import type {
  IngestWriteRequest,
  NormalizedLogRecord,
  NormalizedSpanEventRecord,
  NormalizedSpanRecord,
  SpanIngestWriteRequest,
} from "./types.ts";

type FieldKind = TelemetryFilterCatalogEntry["kind"];

interface MutableEntry {
  readonly id: string;
  readonly projectId: string;
  readonly datasetId: string;
  readonly path: ReadonlyArray<string>;
  readonly label: string;
  kind: FieldKind;
  readonly values: Set<string>;
  frequency: number;
  highCardinality: boolean;
  updatedAt: string;
}

interface FieldValue {
  readonly path: ReadonlyArray<string>;
  readonly kind: FieldKind;
  readonly value: unknown;
}

const maxValuesPerField = 500;
const defaultRebuildWindowMs = 3 * 24 * 60 * 60 * 1_000;
const minRebuildWindowMs = 6 * 60 * 60 * 1_000;
const rebuildAttemptTimeout = "2 seconds";

const staticFields: ReadonlyArray<{
  readonly path: ReadonlyArray<string>;
  readonly kind: FieldKind;
  readonly values?: ReadonlyArray<string>;
}> = [
  { path: ["kind"], kind: "enum", values: ["log", "span", "spanEvent"] },
  { path: ["level"], kind: "enum", values: ["trace", "debug", "info", "warn", "error", "fatal"] },
  { path: ["status"], kind: "enum", values: ["ok", "error", "unset"] },
  { path: ["message"], kind: "string" },
  { path: ["name"], kind: "string" },
  { path: ["sourceName"], kind: "string" },
  { path: ["serviceName"], kind: "string" },
  { path: ["durationUs"], kind: "number" },
  { path: ["traceId"], kind: "string" },
  { path: ["spanId"], kind: "string" },
  { path: ["parentSpanId"], kind: "string" },
  { path: ["severityText"], kind: "string" },
  { path: ["severityNumber"], kind: "number" },
  { path: ["relatedEvents", "name"], kind: "string" },
];

function fieldId(datasetId: string, path: ReadonlyArray<string>): string {
  return `${datasetId}:${path.join(".")}`;
}

function fieldLabel(path: ReadonlyArray<string>): string {
  return path.join(".");
}

function entrySnapshot(entry: MutableEntry): TelemetryFilterCatalogEntry {
  return {
    id: entry.id,
    projectId: entry.projectId,
    datasetId: entry.datasetId,
    path: [...entry.path],
    label: entry.label,
    kind: entry.kind,
    values: [...entry.values].sort(),
    frequency: entry.frequency,
    highCardinality: entry.highCardinality,
    updatedAt: entry.updatedAt,
  };
}

function mapToObject(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object") {
    return {};
  }
  if (!Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }

  const out: Record<string, unknown> = {};
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const key = String((entry as { key?: unknown }).key ?? "");
    if (key.length > 0) {
      out[key] = (entry as { value?: unknown }).value ?? "";
    }
  }
  return out;
}

function valueKind(value: unknown): FieldKind {
  return typeof value === "number" ? "number" : "string";
}

function scalarValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  return String(value);
}

function attributeValues(
  prefix: ReadonlyArray<string>,
  attributes: Readonly<Record<string, unknown>>,
): ReadonlyArray<FieldValue> {
  return Object.entries(attributes).map(([key, value]) => ({
    path: [...prefix, key],
    kind: valueKind(value),
    value,
  }));
}

function logFieldValues(record: NormalizedLogRecord): ReadonlyArray<FieldValue> {
  const level =
    record.severityText.trim().toLowerCase() ||
    (record.severityNumber >= 17 ? "error" : record.severityNumber >= 13 ? "warn" : "info");

  return [
    { path: ["kind"], kind: "enum", value: "log" },
    { path: ["level"], kind: "enum", value: level },
    { path: ["message"], kind: "string", value: record.body },
    { path: ["sourceName"], kind: "string", value: record.serviceName },
    { path: ["serviceName"], kind: "string", value: record.serviceName },
    { path: ["traceId"], kind: "string", value: record.traceId },
    { path: ["spanId"], kind: "string", value: record.spanId },
    { path: ["severityText"], kind: "string", value: record.severityText },
    { path: ["severityNumber"], kind: "number", value: record.severityNumber },
    ...attributeValues(["attributes"], record.logAttributes),
  ];
}

function spanStatus(statusCode: NormalizedSpanRecord["statusCode"]): string {
  if (statusCode === "Error") return "error";
  if (statusCode === "Ok") return "ok";
  return "unset";
}

function spanEventFieldValues(
  span: NormalizedSpanRecord,
  event: NormalizedSpanEventRecord,
): ReadonlyArray<FieldValue> {
  return [
    { path: ["kind"], kind: "enum", value: "spanEvent" },
    { path: ["name"], kind: "string", value: event.name },
    { path: ["message"], kind: "string", value: event.name },
    { path: ["sourceName"], kind: "string", value: span.serviceName },
    { path: ["serviceName"], kind: "string", value: span.serviceName },
    { path: ["traceId"], kind: "string", value: span.traceId },
    { path: ["spanId"], kind: "string", value: span.spanId },
    ...attributeValues(["attributes"], event.attributes),
  ];
}

function spanFieldValues(record: NormalizedSpanRecord): ReadonlyArray<FieldValue> {
  return [
    { path: ["kind"], kind: "enum", value: "span" },
    { path: ["status"], kind: "enum", value: spanStatus(record.statusCode) },
    { path: ["message"], kind: "string", value: record.spanName },
    { path: ["name"], kind: "string", value: record.spanName },
    { path: ["sourceName"], kind: "string", value: record.serviceName },
    { path: ["serviceName"], kind: "string", value: record.serviceName },
    { path: ["durationUs"], kind: "number", value: Math.floor(record.durationNs / 1_000) },
    { path: ["traceId"], kind: "string", value: record.traceId },
    { path: ["spanId"], kind: "string", value: record.spanId },
    { path: ["parentSpanId"], kind: "string", value: record.parentSpanId },
    ...attributeValues(["attributes"], record.spanAttributes),
    ...record.events.flatMap((event) => [
      { path: ["relatedEvents", "name"], kind: "string" as const, value: event.name },
      ...attributeValues(["relatedEvents", "attributes"], event.attributes),
    ]),
    ...record.events.flatMap((event) => spanEventFieldValues(record, event)),
  ];
}

function rowLogValues(row: Record<string, unknown>): ReadonlyArray<FieldValue> {
  return logFieldValues({
    timestamp: String(row.Timestamp ?? ""),
    observedTimestamp: null,
    traceId: String(row.TraceId ?? ""),
    spanId: String(row.SpanId ?? ""),
    traceFlags: Number(row.TraceFlags ?? 0),
    severityNumber: Number(row.SeverityNumber ?? 0),
    severityText: String(row.SeverityText ?? ""),
    serviceName: String(row.ServiceName ?? ""),
    body: String(row.Body ?? ""),
    resourceSchemaUrl: "",
    resourceAttributes: {},
    scopeSchemaUrl: "",
    scopeName: "",
    scopeVersion: "",
    scopeAttributes: {},
    logAttributes: mapToObject(row.LogAttributes) as Record<string, string>,
  });
}

function rowSpanValues(row: Record<string, unknown>): ReadonlyArray<FieldValue> {
  const eventNames = Array.isArray(row["Events.Name"]) ? row["Events.Name"] : [];
  const eventAttributes = Array.isArray(row["Events.Attributes"]) ? row["Events.Attributes"] : [];
  return spanFieldValues({
    traceId: String(row.TraceId ?? ""),
    spanId: String(row.SpanId ?? ""),
    parentSpanId: String(row.ParentSpanId ?? ""),
    traceState: "",
    timestamp: String(row.Timestamp ?? ""),
    spanName: String(row.SpanName ?? ""),
    spanKind: String(row.SpanKind ?? ""),
    serviceName: String(row.ServiceName ?? ""),
    resourceAttributes: {},
    scopeName: "",
    scopeVersion: "",
    spanAttributes: mapToObject(row.SpanAttributes) as Record<string, string>,
    durationNs: Number(row.Duration ?? 0),
    statusCode: String(row.StatusCode ?? "Unset") as NormalizedSpanRecord["statusCode"],
    statusMessage: String(row.StatusMessage ?? ""),
    events: eventNames.map((name, index) => ({
      timestamp: "",
      name: String(name ?? ""),
      attributes: mapToObject(eventAttributes[index]) as Record<string, string>,
    })),
    links: [],
  });
}

export class TelemetryFilterCatalogService extends Context.Service<
  TelemetryFilterCatalogService,
  {
    readonly listDatasetCatalog: (
      projectId: string,
      datasetId: string,
    ) => Effect.Effect<ReadonlyArray<TelemetryFilterCatalogEntry>>;
    readonly streamDatasetCatalog: (
      projectId: string,
      datasetId: string,
    ) => Stream.Stream<TelemetryFilterCatalogChangeEvent>;
    readonly applyLogBatch: (request: IngestWriteRequest) => Effect.Effect<void>;
    readonly applySpanBatch: (request: SpanIngestWriteRequest) => Effect.Effect<void>;
    readonly rebuildAll: () => Effect.Effect<void, DuckDbError | SqlError.SqlError>;
  }
>()("@lensflare/local-server/TelemetryFilterCatalogService") {
  static readonly layer = Layer.effect(
    TelemetryFilterCatalogService,
    Effect.gen(function* () {
      const datasets = yield* DatasetsRepository;
      const store = yield* TelemetryStore;
      const pubsub = yield* PubSub.unbounded<TelemetryFilterCatalogChangeEvent>();
      const byDataset = new Map<string, Map<string, MutableEntry>>();

      const ensureDataset = (projectId: string, datasetId: string) => {
        const existing = byDataset.get(datasetId);
        if (existing) return existing;

        const next = new Map<string, MutableEntry>();
        const now = new Date().toISOString();
        for (const field of staticFields) {
          const id = fieldId(datasetId, field.path);
          next.set(id, {
            id,
            projectId,
            datasetId,
            path: field.path,
            label: fieldLabel(field.path),
            kind: field.kind,
            values: new Set(field.values ?? []),
            frequency: 0,
            highCardinality: false,
            updatedAt: now,
          });
        }
        byDataset.set(datasetId, next);
        return next;
      };

      const publish = (entry: MutableEntry) =>
        PubSub.publish(pubsub, {
          action: "upsert" as const,
          value: entrySnapshot(entry),
        }).pipe(Effect.asVoid);

      const applyValues = (
        projectId: string,
        datasetId: string,
        values: ReadonlyArray<FieldValue>,
      ) =>
        Effect.gen(function* () {
          const fields = ensureDataset(projectId, datasetId);
          const changed = new Set<MutableEntry>();
          const now = new Date().toISOString();

          for (const item of values) {
            const rendered = scalarValue(item.value);
            if (rendered === null) continue;

            const id = fieldId(datasetId, item.path);
            let entry = fields.get(id);
            if (!entry) {
              entry = {
                id,
                projectId,
                datasetId,
                path: item.path,
                label: fieldLabel(item.path),
                kind: item.kind,
                values: new Set(),
                frequency: 0,
                highCardinality: false,
                updatedAt: now,
              };
              fields.set(id, entry);
              changed.add(entry);
            }

            if (entry.kind !== "string" && item.kind === "string") {
              entry.kind = "string";
              changed.add(entry);
            }
            entry.frequency += 1;
            entry.updatedAt = now;
            changed.add(entry);
            if (entry.values.size >= maxValuesPerField && !entry.values.has(rendered)) {
              entry.highCardinality = true;
              changed.add(entry);
              continue;
            }
            if (!entry.values.has(rendered)) {
              entry.values.add(rendered);
              entry.updatedAt = now;
              changed.add(entry);
            }
          }

          yield* Effect.forEach(changed, publish, { discard: true });
        });

      const listDatasetCatalog = (projectId: string, datasetId: string) =>
        Effect.sync(() =>
          [...ensureDataset(projectId, datasetId).values()]
            .map(entrySnapshot)
            .sort((left, right) => left.label.localeCompare(right.label)),
        );

      const streamDatasetCatalog = (projectId: string, datasetId: string) =>
        Stream.fromPubSub(pubsub).pipe(
          Stream.filter(
            (event) =>
              event.action === "upsert" &&
              event.value.projectId === projectId &&
              event.value.datasetId === datasetId,
          ),
        );

      const applyLogBatch = (request: IngestWriteRequest) =>
        applyValues(request.projectId, request.datasetId, request.records.flatMap(logFieldValues));

      const applySpanBatch = (request: SpanIngestWriteRequest) =>
        applyValues(request.projectId, request.datasetId, request.spans.flatMap(spanFieldValues));

      const rebuildDataset = (projectId: string, datasetId: string, windowMs: number) =>
        Effect.gen(function* () {
          byDataset.delete(datasetId);
          ensureDataset(projectId, datasetId);

          const since = new Date(Date.now() - windowMs).toISOString();
          const logs = yield* store.queryRows<Record<string, unknown>>(
            datasetId,
            `
              SELECT TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber, ServiceName, Body, LogAttributes
              FROM otel_logs
              WHERE Timestamp >= CAST($since AS TIMESTAMP_NS)
            `,
            { since },
          );
          yield* applyValues(projectId, datasetId, logs.flatMap(rowLogValues));

          const spans = yield* store.queryRows<Record<string, unknown>>(
            datasetId,
            `
              SELECT
                TraceId, SpanId, ParentSpanId, SpanName, SpanKind, ServiceName, SpanAttributes,
                Duration, StatusCode, StatusMessage, "Events.Name", "Events.Attributes"
              FROM otel_traces
              WHERE Timestamp >= CAST($since AS TIMESTAMP_NS)
            `,
            { since },
          );
          yield* applyValues(projectId, datasetId, spans.flatMap(rowSpanValues));
        });

      const rebuildDatasetWithFallback = (projectId: string, datasetId: string) =>
        Effect.gen(function* () {
          let windowMs = defaultRebuildWindowMs;
          while (windowMs >= minRebuildWindowMs) {
            const result = yield* rebuildDataset(projectId, datasetId, windowMs).pipe(
              Effect.timeoutOption(rebuildAttemptTimeout),
            );
            if (Option.isSome(result)) {
              return;
            }
            windowMs = Math.floor(windowMs / 2);
          }
        });

      const rebuildAll = Effect.fn("TelemetryFilterCatalogService.rebuildAll")(function* () {
        const rows = yield* datasets.findAll();
        yield* Effect.forEach(
          rows.map(datasetFromRow),
          (dataset) => rebuildDatasetWithFallback(dataset.projectId, dataset.id),
          { discard: true, concurrency: 1 },
        );
      });

      return TelemetryFilterCatalogService.of({
        listDatasetCatalog,
        streamDatasetCatalog,
        applyLogBatch,
        applySpanBatch,
        rebuildAll,
      });
    }),
  );
}
