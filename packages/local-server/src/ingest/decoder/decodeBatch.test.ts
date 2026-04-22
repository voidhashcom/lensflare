import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { MalformedPayload, NormalizationFailure } from "../errors.ts";
import type { NormalizedIngestBatch } from "../types.ts";
import { decodeBatch } from "./decodeBatch.ts";

const emptyBatch: NormalizedIngestBatch = {
  providerKind: "otlp_http_logs",
  signal: "logs",
  records: [],
  droppedRecords: 0,
  warnings: [],
};

describe("decodeBatch", () => {
  it.effect("converts a thrown error into MalformedPayload tagged with the provider", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeBatch({
          provider: "otlp_http_logs",
          emptyMessage: "unused",
          decode: () => {
            throw new Error("boom");
          },
        }),
      );

      expect(error).toBeInstanceOf(MalformedPayload);
      expect(error._tag).toBe("MalformedPayload");
      expect(error.provider).toBe("otlp_http_logs");
      expect(error.message).toBe("boom");
    }),
  );

  it.effect("converts an empty batch into NormalizationFailure with the supplied message", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeBatch({
          provider: "axiom_native",
          emptyMessage: "Payload did not contain any valid events.",
          decode: () => emptyBatch,
        }),
      );

      expect(error).toBeInstanceOf(NormalizationFailure);
      expect(error._tag).toBe("NormalizationFailure");
      expect(error.provider).toBe("axiom_native");
      expect(error.message).toBe("Payload did not contain any valid events.");
    }),
  );

  it.effect("passes through a non-empty batch unchanged", () =>
    Effect.gen(function* () {
      const batch: NormalizedIngestBatch = {
        ...emptyBatch,
        records: [
          {
            timestamp: null,
            observedTimestamp: null,
            traceId: null,
            spanId: null,
            traceFlags: null,
            severityNumber: null,
            severityText: null,
            serviceName: null,
            resourceSchemaUrl: null,
            scopeName: null,
            scopeVersion: null,
            scopeSchemaUrl: null,
            bodyText: null,
            bodyJson: null,
            resourceJson: null,
            scopeJson: null,
            attributesJson: null,
            droppedAttributesCount: null,
            rawRecordJson: "{}",
          },
        ],
      };

      const result = yield* decodeBatch({
        provider: "otlp_http_logs",
        emptyMessage: "unused",
        decode: () => batch,
      });

      expect(result).toBe(batch);
    }),
  );
});
