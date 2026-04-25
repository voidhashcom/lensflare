import { Context, Effect, Layer } from "effect";
import { decodeBatch } from "../../decoder/decodeBatch.ts";
import { MalformedPayload, NormalizationFailure } from "../../errors.ts";
import type { NormalizedIngestBatch } from "../../types.ts";
import {
  type OtlpWireFormat,
  normalizeOtlpDocument,
  normalizeOtlpTraceDocument,
  parseDocument,
  parseTraceDocument,
} from "./normalize.ts";

/**
 * Decode an OTLP `ExportLogsServiceRequest` (JSON or protobuf) into a
 * provider-agnostic `NormalizedIngestBatch`.
 *
 * Wire-format choice is the only configurable knob — the rest of the
 * pipeline (extracting records, validating non-empty, tagging errors with
 * the provider) is delegated to the shared `decodeBatch` helper so this
 * service stays at the ~10-line size that justifies a dedicated layer.
 */
export class OtlpLogsDecoder extends Context.Service<
  OtlpLogsDecoder,
  {
    readonly decode: (
      format: OtlpWireFormat,
      body: Uint8Array,
    ) => Effect.Effect<NormalizedIngestBatch, MalformedPayload | NormalizationFailure>;
  }
>()("@lensflare/local-server/OtlpLogsDecoder") {
  static readonly layer = Layer.sync(OtlpLogsDecoder, () =>
    OtlpLogsDecoder.of({
      decode(format, body) {
        return decodeBatch({
          provider: "otlp_http_logs",
          emptyMessage: "Payload did not contain any log records.",
          decode: () => normalizeOtlpDocument(parseDocument(format, body)),
        });
      },
    }),
  );
}

export class OtlpTracesDecoder extends Context.Service<
  OtlpTracesDecoder,
  {
    readonly decode: (
      format: OtlpWireFormat,
      body: Uint8Array,
    ) => Effect.Effect<NormalizedIngestBatch, MalformedPayload | NormalizationFailure>;
  }
>()("@lensflare/local-server/OtlpTracesDecoder") {
  static readonly layer = Layer.sync(OtlpTracesDecoder, () =>
    OtlpTracesDecoder.of({
      decode(format, body) {
        return decodeBatch({
          provider: "otlp_http_traces",
          emptyMessage: "Payload did not contain any spans.",
          decode: () => normalizeOtlpTraceDocument(parseTraceDocument(format, body)),
        });
      },
    }),
  );
}
