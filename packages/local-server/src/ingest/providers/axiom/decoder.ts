import { Context, Effect, Layer } from "effect";
import { decodeBatch } from "../../decoder/decodeBatch.ts";
import { MalformedPayload, NormalizationFailure } from "../../errors.ts";
import { jsonStringOrNull } from "../../normalization/json.ts";
import { parseTimestamp } from "../../normalization/timestamps.ts";
import type { NormalizedIngestBatch, NormalizedLogRecord } from "../../types.ts";

/**
 * Project an Axiom-native event into the canonical `NormalizedLogRecord`.
 *
 * Axiom's native ingest schema is loose JSON: known top-level keys are
 * `time`, `service`, `data`, and `labels`; everything else flows into
 * `attributes`. `labels` (when present and object-shaped) is folded into
 * the same attribute bag so downstream queries don't need to know whether
 * a tag was emitted via `labels.foo` or as a top-level key.
 *
 * `data` can be either a string (logged as `bodyText`) or any JSON value
 * (logged as serialized `bodyJson`). The original event is preserved
 * verbatim in `rawRecordJson` for debugging.
 */
function normalizeEvent(event: Record<string, unknown>): NormalizedLogRecord {
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === "time" || key === "data" || key === "labels") {
      continue;
    }
    attributes[key] = value;
  }

  const labels = event.labels;
  if (labels !== null && typeof labels === "object" && !Array.isArray(labels)) {
    for (const [key, value] of Object.entries(labels as Record<string, unknown>)) {
      attributes[key] = value;
    }
  }

  return {
    timestamp: parseTimestamp(event.time),
    observedTimestamp: null,
    traceId: null,
    spanId: null,
    traceFlags: null,
    severityNumber: null,
    severityText: null,
    serviceName: typeof event.service === "string" ? event.service : null,
    resourceSchemaUrl: null,
    scopeName: null,
    scopeVersion: null,
    scopeSchemaUrl: null,
    bodyText: typeof event.data === "string" ? event.data : null,
    bodyJson: typeof event.data === "string" ? null : jsonStringOrNull(event.data),
    resourceJson: null,
    scopeJson: null,
    attributesJson: jsonStringOrNull(attributes),
    droppedAttributesCount: null,
    rawRecordJson: JSON.stringify(event),
  };
}

function decodeJsonArray(body: string): ReadonlyArray<unknown> {
  const parsed = JSON.parse(body);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array.");
  }
  return parsed;
}

function decodeNdjson(body: string): ReadonlyArray<unknown> {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * Decode an Axiom-native ingest body (`application/json` array or
 * `application/x-ndjson` newline-delimited stream) into a
 * provider-agnostic `NormalizedIngestBatch`.
 *
 * Non-object items in the input are dropped (with a warning) rather than
 * aborting the whole batch — Axiom clients in the wild are known to mix
 * stray nulls / scalars into otherwise-valid streams.
 */
export class AxiomNativeDecoder extends Context.Service<
  AxiomNativeDecoder,
  {
    readonly decode: (
      contentType: "application/json" | "application/x-ndjson",
      body: string,
    ) => Effect.Effect<NormalizedIngestBatch, MalformedPayload | NormalizationFailure>;
  }
>()("@lensflare/local-server/AxiomNativeDecoder") {
  static readonly layer = Layer.sync(AxiomNativeDecoder, () =>
    AxiomNativeDecoder.of({
      decode(contentType, body) {
        return decodeBatch({
          provider: "axiom_native",
          emptyMessage: "Payload did not contain any valid events.",
          decode: () => {
            const items =
              contentType === "application/x-ndjson" ? decodeNdjson(body) : decodeJsonArray(body);

            const records: Array<NormalizedLogRecord> = [];
            let droppedRecords = 0;
            const warnings: Array<string> = [];

            for (const item of items) {
              if (item === null || typeof item !== "object" || Array.isArray(item)) {
                droppedRecords += 1;
                warnings.push("Dropped non-object Axiom event.");
                continue;
              }

              records.push(normalizeEvent(item as Record<string, unknown>));
            }

            return {
              providerKind: "axiom_native",
              signal: "logs",
              records,
              droppedRecords,
              warnings,
            } satisfies NormalizedIngestBatch;
          },
        });
      },
    }),
  );
}
