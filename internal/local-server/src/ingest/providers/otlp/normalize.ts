import { Schema } from "effect";
import { anyValueToOtelString, otelAttributeMap } from "../../normalization/otelAttributes.ts";
import { parseTimestamp } from "../../normalization/timestamps.ts";
import type {
  NormalizedIngestBatch,
  NormalizedLogRecord,
  NormalizedSpanEventRecord,
  NormalizedSpanLinkRecord,
  NormalizedSpanRecord,
  OtelSpanStatusCode,
} from "../../types.ts";
import { exportLogsServiceRequestType, exportTraceServiceRequestType } from "./proto.ts";

export type OtlpWireFormat = "json" | "protobuf";

const decodeUnknownJsonString = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);

function getRecordValue(record: Record<string, unknown>, ...keys: ReadonlyArray<string>): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toObjectArray(value: unknown): ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(value)
    ? value
        .map((item) => toObjectRecord(item))
        .filter((item): item is Record<string, unknown> => item !== undefined)
    : [];
}

function bytesToHex(value: unknown): string | null {
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }

  if (typeof value === "string" && value.length > 0) {
    return value.toLowerCase();
  }

  return null;
}

function attributeString(attributes: Readonly<Record<string, string>>, key: string): string {
  return attributes[key] ?? "";
}

function anyValueToJson(value: unknown): unknown {
  const record = toObjectRecord(value);
  if (record === undefined) {
    return value ?? null;
  }

  if ("stringValue" in record || "string_value" in record) {
    return getRecordValue(record, "stringValue", "string_value") ?? null;
  }
  if ("boolValue" in record || "bool_value" in record) {
    return getRecordValue(record, "boolValue", "bool_value") ?? null;
  }
  if ("intValue" in record || "int_value" in record) {
    const intValue = getRecordValue(record, "intValue", "int_value");
    return intValue === undefined ? null : Number(intValue);
  }
  if ("doubleValue" in record || "double_value" in record) {
    return getRecordValue(record, "doubleValue", "double_value") ?? null;
  }
  if ("bytesValue" in record || "bytes_value" in record) {
    const bytes = getRecordValue(record, "bytesValue", "bytes_value");
    return bytes instanceof Uint8Array ? Buffer.from(bytes).toString("base64") : (bytes ?? null);
  }

  const arrayValue = toObjectRecord(getRecordValue(record, "arrayValue", "array_value"));
  if (arrayValue !== undefined) {
    const values = getRecordValue(arrayValue, "values");
    return Array.isArray(values) ? values.map((item) => anyValueToJson(item)) : [];
  }

  const kvListValue = toObjectRecord(getRecordValue(record, "kvlistValue", "kvlist_value"));
  if (kvListValue !== undefined) {
    return keyValueArrayToObject(getRecordValue(kvListValue, "values"));
  }

  return null;
}

function keyValueArrayToObject(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of toObjectArray(value)) {
    const key = getRecordValue(item, "key");
    if (typeof key !== "string" || key.length === 0) {
      continue;
    }
    out[key] = anyValueToJson(getRecordValue(item, "value"));
  }
  return out;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.length > 0 && !Number.isNaN(Number(value))
      ? Number(value)
      : null;
}

function normalizeBody(value: unknown): string {
  const body = anyValueToJson(value);
  if (typeof body === "string") {
    return body;
  }

  return anyValueToOtelString(body);
}

/**
 * Decode the wire-format payload into the loosely-typed object graph the
 * normalizer below works against.
 *
 * Both wire formats end up as `Record<string, unknown>` so the rest of the
 * pipeline doesn't have to fork: only this function knows whether a given
 * batch came in as JSON or protobuf.
 */
export function parseDocument(format: OtlpWireFormat, body: Uint8Array): Record<string, unknown> {
  if (format === "json") {
    return decodeUnknownJsonString(Buffer.from(body).toString("utf8")) as Record<string, unknown>;
  }

  return exportLogsServiceRequestType.toObject(exportLogsServiceRequestType.decode(body), {
    longs: String,
    enums: Number,
    bytes: Uint8Array,
  }) as Record<string, unknown>;
}

export function parseTraceDocument(
  format: OtlpWireFormat,
  body: Uint8Array,
): Record<string, unknown> {
  if (format === "json") {
    return decodeUnknownJsonString(Buffer.from(body).toString("utf8")) as Record<string, unknown>;
  }

  return exportTraceServiceRequestType.toObject(exportTraceServiceRequestType.decode(body), {
    longs: String,
    enums: Number,
    bytes: Uint8Array,
  }) as Record<string, unknown>;
}

function requiredHex(value: unknown): string | null {
  const hex = bytesToHex(value);
  return hex && hex.length > 0 ? hex : null;
}

function optionalHex(value: unknown): string | null {
  return bytesToHex(value);
}

function integerOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function enumStringOrNumber(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function normalizeSpanKind(value: unknown): string {
  const raw = enumStringOrNumber(value);
  if (raw === null) {
    return "Unspecified";
  }

  if (typeof raw === "number") {
    switch (raw) {
      case 1:
        return "Internal";
      case 2:
        return "Server";
      case 3:
        return "Client";
      case 4:
        return "Producer";
      case 5:
        return "Consumer";
      default:
        return "Unspecified";
    }
  }

  switch (raw.replace(/^SPAN_KIND_/, "").toLowerCase()) {
    case "internal":
      return "Internal";
    case "server":
      return "Server";
    case "client":
      return "Client";
    case "producer":
      return "Producer";
    case "consumer":
      return "Consumer";
    default:
      return "Unspecified";
  }
}

function normalizeStatusCode(value: unknown): OtelSpanStatusCode {
  const raw = enumStringOrNumber(value);
  if (raw === null) {
    return "Unset";
  }
  if (typeof raw === "number") {
    return raw === 1 ? "Ok" : raw === 2 ? "Error" : "Unset";
  }
  switch (raw) {
    case "STATUS_CODE_OK":
    case "Ok":
    case "OK":
      return "Ok";
    case "STATUS_CODE_ERROR":
    case "Error":
    case "ERROR":
      return "Error";
    case "STATUS_CODE_UNSET":
    case "Unset":
    case "UNSET":
      return "Unset";
    default:
      return "Unset";
  }
}

function normalizeSpanEvents(
  span: Record<string, unknown>,
  args: {
    readonly traceId: string;
    readonly spanId: string;
  },
): ReadonlyArray<NormalizedSpanEventRecord> {
  const events: Array<NormalizedSpanEventRecord> = [];
  for (const event of toObjectArray(getRecordValue(span, "events"))) {
    const name = stringOrNull(getRecordValue(event, "name"));
    const timestamp = parseTimestamp(getRecordValue(event, "timeUnixNano", "time_unix_nano"));
    if (name === null || timestamp === null) {
      continue;
    }

    events.push({
      timestamp,
      name,
      attributes: otelAttributeMap(getRecordValue(event, "attributes")),
    });
  }
  return events;
}

function normalizeSpanLinks(
  span: Record<string, unknown>,
): ReadonlyArray<NormalizedSpanLinkRecord> {
  const links: Array<NormalizedSpanLinkRecord> = [];
  for (const link of toObjectArray(getRecordValue(span, "links"))) {
    const traceId = optionalHex(getRecordValue(link, "traceId", "trace_id"));
    const spanId = optionalHex(getRecordValue(link, "spanId", "span_id"));
    if (!traceId || !spanId) {
      continue;
    }

    links.push({
      traceId,
      spanId,
      traceState: stringOrNull(getRecordValue(link, "traceState", "trace_state")) ?? "",
      attributes: otelAttributeMap(getRecordValue(link, "attributes")),
    });
  }
  return links;
}

function nanoStringToBigInt(value: unknown): bigint | null {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.trunc(value));
  }
  return null;
}

function durationNsFromNanos(start: unknown, end: unknown): number | null {
  const startNanos = nanoStringToBigInt(start);
  const endNanos = nanoStringToBigInt(end);
  if (startNanos === null || endNanos === null || endNanos < startNanos) {
    return null;
  }

  const duration = Number(endNanos - startNanos);
  return Number.isFinite(duration) ? duration : null;
}

function durationNsFromIso(startTime: string, endTime: string | null): number {
  if (endTime === null) {
    return 0;
  }

  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
    ? (endMs - startMs) * 1_000_000
    : 0;
}

/**
 * Walk the OTLP `ExportLogsServiceRequest` tree and flatten its
 * `ResourceLogs → ScopeLogs → LogRecord` hierarchy into the provider-agnostic
 * `NormalizedLogRecord` shape every storage path expects.
 *
 * Resource- and scope-level attributes are stamped onto each record so a
 * single `otel_logs` row carries enough context to be queried in isolation.
 * Field name lookups try both `camelCase` (JSON) and `snake_case` (protobuf
 * → JSON) so the function works against either wire format without branching.
 */
export function normalizeOtlpDocument(document: Record<string, unknown>): NormalizedIngestBatch {
  const records: Array<NormalizedLogRecord> = [];
  const resourceLogs = toObjectArray(getRecordValue(document, "resourceLogs", "resource_logs"));

  for (const resourceLog of resourceLogs) {
    const resource = toObjectRecord(getRecordValue(resourceLog, "resource"));
    const resourceAttributes = otelAttributeMap(getRecordValue(resource ?? {}, "attributes"));
    const serviceName = attributeString(resourceAttributes, "service.name");
    const resourceSchemaUrl =
      stringOrNull(getRecordValue(resourceLog, "schemaUrl", "schema_url")) ?? "";

    const scopeLogs = toObjectArray(getRecordValue(resourceLog, "scopeLogs", "scope_logs"));
    for (const scopeLog of scopeLogs) {
      const scope = toObjectRecord(getRecordValue(scopeLog, "scope"));
      const scopeAttributes = otelAttributeMap(getRecordValue(scope ?? {}, "attributes"));
      const scopeName = stringOrNull(getRecordValue(scope ?? {}, "name")) ?? "";
      const scopeVersion = stringOrNull(getRecordValue(scope ?? {}, "version")) ?? "";
      const scopeSchemaUrl =
        stringOrNull(getRecordValue(scopeLog, "schemaUrl", "schema_url")) ?? "";

      const logRecords = toObjectArray(getRecordValue(scopeLog, "logRecords", "log_records"));
      for (const logRecord of logRecords) {
        const logAttributes = otelAttributeMap(getRecordValue(logRecord, "attributes"));
        const traceId =
          bytesToHex(getRecordValue(logRecord, "traceId", "trace_id")) ??
          attributeString(logAttributes, "traceId");
        const spanId =
          bytesToHex(getRecordValue(logRecord, "spanId", "span_id")) ??
          attributeString(logAttributes, "spanId");

        records.push({
          timestamp: parseTimestamp(getRecordValue(logRecord, "timeUnixNano", "time_unix_nano")),
          observedTimestamp: parseTimestamp(
            getRecordValue(logRecord, "observedTimeUnixNano", "observed_time_unix_nano"),
          ),
          traceId,
          spanId,
          traceFlags: integerOrNull(getRecordValue(logRecord, "flags")) ?? 0,
          severityNumber:
            numberOrNull(getRecordValue(logRecord, "severityNumber", "severity_number")) ?? 0,
          severityText:
            stringOrNull(getRecordValue(logRecord, "severityText", "severity_text")) ?? "",
          serviceName,
          resourceSchemaUrl,
          resourceAttributes,
          scopeSchemaUrl,
          scopeName,
          scopeVersion,
          scopeAttributes,
          body: normalizeBody(getRecordValue(logRecord, "body")),
          logAttributes,
        });
      }
    }
  }

  return {
    providerKind: "otlp_http_logs",
    signal: "logs",
    records,
    droppedRecords: 0,
    warnings: [],
  };
}

export function normalizeOtlpTraceDocument(
  document: Record<string, unknown>,
): NormalizedIngestBatch {
  const spans: Array<NormalizedSpanRecord> = [];
  const warnings: Array<string> = [];
  let droppedRecords = 0;
  const resourceSpans = toObjectArray(getRecordValue(document, "resourceSpans", "resource_spans"));

  for (const resourceSpan of resourceSpans) {
    const resource = toObjectRecord(getRecordValue(resourceSpan, "resource"));
    const resourceAttributes = otelAttributeMap(getRecordValue(resource ?? {}, "attributes"));
    const serviceName = attributeString(resourceAttributes, "service.name");

    const scopeSpans = toObjectArray(getRecordValue(resourceSpan, "scopeSpans", "scope_spans"));
    for (const scopeSpan of scopeSpans) {
      const scope = toObjectRecord(getRecordValue(scopeSpan, "scope"));
      const scopeName = stringOrNull(getRecordValue(scope ?? {}, "name")) ?? "";
      const scopeVersion = stringOrNull(getRecordValue(scope ?? {}, "version")) ?? "";

      const rawSpans = toObjectArray(getRecordValue(scopeSpan, "spans"));
      for (const span of rawSpans) {
        const traceId = requiredHex(getRecordValue(span, "traceId", "trace_id"));
        const spanId = requiredHex(getRecordValue(span, "spanId", "span_id"));
        const name = stringOrNull(getRecordValue(span, "name"));
        const startValue = getRecordValue(span, "startTimeUnixNano", "start_time_unix_nano");
        const endValue = getRecordValue(span, "endTimeUnixNano", "end_time_unix_nano");
        const startTime = parseTimestamp(startValue);
        const endTime = parseTimestamp(endValue);

        if (traceId === null || spanId === null || name === null || startTime === null) {
          droppedRecords += 1;
          warnings.push("Dropped OTLP span missing trace id, span id, name, or start time.");
          continue;
        }

        const status = toObjectRecord(getRecordValue(span, "status"));

        spans.push({
          traceId,
          spanId,
          parentSpanId: optionalHex(getRecordValue(span, "parentSpanId", "parent_span_id")) ?? "",
          traceState: stringOrNull(getRecordValue(span, "traceState", "trace_state")) ?? "",
          timestamp: startTime,
          spanName: name,
          spanKind: normalizeSpanKind(getRecordValue(span, "kind")),
          statusCode: normalizeStatusCode(getRecordValue(status ?? {}, "code")),
          statusMessage: stringOrNull(getRecordValue(status ?? {}, "message")) ?? "",
          serviceName,
          resourceAttributes,
          scopeName,
          scopeVersion,
          spanAttributes: otelAttributeMap(getRecordValue(span, "attributes")),
          durationNs:
            durationNsFromNanos(startValue, endValue) ?? durationNsFromIso(startTime, endTime),
          events: normalizeSpanEvents(span, {
            traceId,
            spanId,
          }),
          links: normalizeSpanLinks(span),
        });
      }
    }
  }

  return {
    providerKind: "otlp_http_traces",
    signal: "traces",
    spans,
    droppedRecords,
    warnings,
  };
}
