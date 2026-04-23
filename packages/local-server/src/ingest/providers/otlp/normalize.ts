import { Schema } from "effect";
import { jsonStringOrNull } from "../../normalization/json.ts";
import { parseTimestamp } from "../../normalization/timestamps.ts";
import type { NormalizedIngestBatch, NormalizedLogRecord } from "../../types.ts";
import { exportLogsServiceRequestType } from "./proto.ts";

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

function scalarStringOrNull(value: unknown): string | null {
  return typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.length > 0 && !Number.isNaN(Number(value))
      ? Number(value)
      : null;
}

function normalizeBody(value: unknown): { bodyText: string | null; bodyJson: string | null } {
  const body = anyValueToJson(value);
  if (typeof body === "string") {
    return {
      bodyText: body,
      bodyJson: null,
    };
  }

  return {
    bodyText: null,
    bodyJson: jsonStringOrNull(body),
  };
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

/**
 * Walk the OTLP `ExportLogsServiceRequest` tree and flatten its
 * `ResourceLogs → ScopeLogs → LogRecord` hierarchy into the provider-agnostic
 * `NormalizedLogRecord` shape every storage path expects.
 *
 * Resource- and scope-level attributes are stamped onto each record so a
 * single `log_records` row carries enough context to be queried in isolation.
 * Field name lookups try both `camelCase` (JSON) and `snake_case` (protobuf
 * → JSON) so the function works against either wire format without branching.
 */
export function normalizeOtlpDocument(document: Record<string, unknown>): NormalizedIngestBatch {
  const records: Array<NormalizedLogRecord> = [];
  const resourceLogs = toObjectArray(getRecordValue(document, "resourceLogs", "resource_logs"));

  for (const resourceLog of resourceLogs) {
    const resource = toObjectRecord(getRecordValue(resourceLog, "resource"));
    const resourceAttributes = keyValueArrayToObject(getRecordValue(resource ?? {}, "attributes"));
    const resourceJson = jsonStringOrNull(resourceAttributes);
    const serviceNameValue = resourceAttributes["service.name"];
    const serviceName = typeof serviceNameValue === "string" ? serviceNameValue : null;
    const resourceSchemaUrl = stringOrNull(getRecordValue(resourceLog, "schemaUrl", "schema_url"));

    const scopeLogs = toObjectArray(getRecordValue(resourceLog, "scopeLogs", "scope_logs"));
    for (const scopeLog of scopeLogs) {
      const scope = toObjectRecord(getRecordValue(scopeLog, "scope"));
      const scopeAttributes = keyValueArrayToObject(getRecordValue(scope ?? {}, "attributes"));
      const scopeJson = jsonStringOrNull(scopeAttributes);
      const scopeName = stringOrNull(getRecordValue(scope ?? {}, "name"));
      const scopeVersion = stringOrNull(getRecordValue(scope ?? {}, "version"));
      const scopeSchemaUrl = stringOrNull(getRecordValue(scopeLog, "schemaUrl", "schema_url"));

      const logRecords = toObjectArray(getRecordValue(scopeLog, "logRecords", "log_records"));
      for (const logRecord of logRecords) {
        const attributes = keyValueArrayToObject(getRecordValue(logRecord, "attributes"));
        const { bodyText, bodyJson } = normalizeBody(getRecordValue(logRecord, "body"));

        records.push({
          timestamp: parseTimestamp(getRecordValue(logRecord, "timeUnixNano", "time_unix_nano")),
          observedTimestamp: parseTimestamp(
            getRecordValue(logRecord, "observedTimeUnixNano", "observed_time_unix_nano"),
          ),
          traceId: bytesToHex(getRecordValue(logRecord, "traceId", "trace_id")),
          spanId: bytesToHex(getRecordValue(logRecord, "spanId", "span_id")),
          traceFlags: scalarStringOrNull(getRecordValue(logRecord, "flags")),
          severityNumber: numberOrNull(
            getRecordValue(logRecord, "severityNumber", "severity_number"),
          ),
          severityText: stringOrNull(getRecordValue(logRecord, "severityText", "severity_text")),
          serviceName,
          resourceSchemaUrl,
          scopeName,
          scopeVersion,
          scopeSchemaUrl,
          bodyText,
          bodyJson,
          resourceJson,
          scopeJson,
          attributesJson: jsonStringOrNull(attributes),
          droppedAttributesCount: numberOrNull(
            getRecordValue(logRecord, "droppedAttributesCount", "dropped_attributes_count"),
          ),
          rawRecordJson: JSON.stringify(logRecord),
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
