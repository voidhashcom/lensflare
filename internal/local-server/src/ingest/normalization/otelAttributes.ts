import { Buffer } from "node:buffer";

function scalarToString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

export function anyValueToOtelString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }

  try {
    return JSON.stringify(value) ?? scalarToString(value);
  } catch {
    return scalarToString(value);
  }
}

export function otelAttributeMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(value)) {
    return out;
  }

  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const key = record.key;
    if (typeof key !== "string" || key.length === 0) {
      continue;
    }
    out[key] = anyValueToOtelString(anyValueToJson(record.value));
  }

  return out;
}

export function anyValueToJson(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value ?? null;
  }

  const record = value as Record<string, unknown>;
  if ("stringValue" in record || "string_value" in record) {
    return record.stringValue ?? record.string_value ?? null;
  }
  if ("boolValue" in record || "bool_value" in record) {
    return record.boolValue ?? record.bool_value ?? null;
  }
  if ("intValue" in record || "int_value" in record) {
    const intValue = record.intValue ?? record.int_value;
    return intValue === undefined ? null : Number(intValue);
  }
  if ("doubleValue" in record || "double_value" in record) {
    return record.doubleValue ?? record.double_value ?? null;
  }
  if ("bytesValue" in record || "bytes_value" in record) {
    const bytes = record.bytesValue ?? record.bytes_value;
    return bytes instanceof Uint8Array ? Buffer.from(bytes).toString("base64") : (bytes ?? null);
  }

  const arrayValue = toObjectRecord(record.arrayValue ?? record.array_value);
  if (arrayValue !== undefined) {
    const values = arrayValue.values;
    return Array.isArray(values) ? values.map((item) => anyValueToJson(item)) : [];
  }

  const kvListValue = toObjectRecord(record.kvlistValue ?? record.kvlist_value);
  if (kvListValue !== undefined) {
    const values = kvListValue.values;
    const out: Record<string, unknown> = {};
    if (Array.isArray(values)) {
      for (const item of values) {
        const child = toObjectRecord(item);
        const key = child?.key;
        if (typeof key === "string" && key.length > 0) {
          out[key] = anyValueToJson(child?.value);
        }
      }
    }
    return out;
  }

  return null;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
