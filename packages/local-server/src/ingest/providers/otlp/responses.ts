import { HttpServerResponse } from "effect/unstable/http";
import type { IngestErrorMapping } from "../../../http/ingestErrorMapping.ts";
import {
  exportLogsServiceResponseType,
  googleRpcStatusType,
} from "./proto.ts";
import type { OtlpWireFormat } from "./normalize.ts";

/**
 * OTLP response wire-format encoders + their HTTP wrappers.
 *
 * The `responses.ts` module owns everything needed to translate an
 * outcome from `LogIngestService.ingest(...)` into an `HttpServerResponse`
 * that conforms to the OTLP/HTTP spec. Co-locating these with the OTLP
 * decoder (rather than scattering them into the generic HTTP layer) is
 * what makes the provider plug-in pattern work — each provider owns its
 * wire concerns end to end.
 */

/**
 * Returns the `Content-Type` header value an OTLP/HTTP response needs for
 * a given wire format. The OTLP spec requires the response format to
 * match the request's `Content-Type`.
 */
export function otlpResponseContentType(format: OtlpWireFormat): string {
  return format === "json" ? "application/json" : "application/x-protobuf";
}

/**
 * Encode an OTLP success body.
 *
 * Returns a JSON string for `format === "json"` and a protobuf
 * `Uint8Array` otherwise. When `rejectedRecords > 0` the body carries an
 * `ExportLogsPartialSuccess` describing how many records were dropped
 * and why; an all-success response is the empty object/message.
 */
function encodeOtlpSuccessBody(
  format: OtlpWireFormat,
  partial:
    | {
        readonly rejectedLogRecords: number;
        readonly errorMessage: string;
      }
    | undefined,
): Uint8Array | string {
  const payload =
    partial && partial.rejectedLogRecords > 0
      ? {
          partial_success: {
            rejected_log_records: partial.rejectedLogRecords,
            error_message: partial.errorMessage,
          },
        }
      : {};

  if (format === "json") {
    return JSON.stringify(
      partial && partial.rejectedLogRecords > 0
        ? {
            partialSuccess: {
              rejectedLogRecords: partial.rejectedLogRecords,
              errorMessage: partial.errorMessage,
            },
          }
        : {},
    );
  }

  return exportLogsServiceResponseType.encode(payload).finish();
}

/**
 * Encode an OTLP error body as a `google.rpc.Status` envelope.
 *
 * `code` follows `google.rpc.Code` (NOT_FOUND=5, INVALID_ARGUMENT=3,
 * INTERNAL=13). `message` is a human-readable explanation surfaced to the
 * client.
 */
function encodeOtlpErrorBody(
  format: OtlpWireFormat,
  code: number,
  message: string,
): Uint8Array | string {
  if (format === "json") {
    return JSON.stringify({ code, message });
  }

  return googleRpcStatusType.encode({ code, message }).finish();
}

function asHttpResponse(body: Uint8Array | string, status: number, contentType: string) {
  return typeof body === "string"
    ? HttpServerResponse.text(body, { status, contentType })
    : HttpServerResponse.uint8Array(body, { status, contentType });
}

/**
 * Build a complete OTLP success `HttpServerResponse`.
 *
 * Accepts `rejectedRecords` and `warnings` because partial success is
 * still a 200 — the OTLP spec puts rejection details inside the response
 * body, not the status code.
 */
export function otlpSuccessResponse(
  format: OtlpWireFormat,
  args: {
    readonly rejectedRecords: number;
    readonly warnings: ReadonlyArray<string>;
  },
) {
  const body = encodeOtlpSuccessBody(
    format,
    args.rejectedRecords > 0
      ? {
          rejectedLogRecords: args.rejectedRecords,
          errorMessage: args.warnings.join("; ") || "Some log records were rejected.",
        }
      : undefined,
  );

  return asHttpResponse(body, 200, otlpResponseContentType(format));
}

/**
 * Build a complete OTLP error `HttpServerResponse`.
 *
 * `httpStatus` is the HTTP-level outcome (4xx/5xx); `grpcCode` is the
 * `google.rpc.Code` value carried in the response body (NOT_FOUND=5,
 * INVALID_ARGUMENT=3, INTERNAL=13). The two are paired but not redundant:
 * gRPC clients hitting the same endpoint over `application/grpc-web`
 * read the gRPC code, while plain HTTP clients react to the status.
 */
export function otlpErrorResponse(
  format: OtlpWireFormat,
  args: {
    readonly httpStatus: number;
    readonly grpcCode: number;
    readonly message: string;
  },
) {
  const body = encodeOtlpErrorBody(format, args.grpcCode, args.message);
  return asHttpResponse(body, args.httpStatus, otlpResponseContentType(format));
}

/**
 * Convenience wrapper that takes the provider-agnostic
 * {@link IngestErrorMapping} produced by `resolveIngestErrorStatus(...)`
 * and projects it onto the OTLP-specific error response shape.
 *
 * Provider route handlers should prefer this over building the
 * {@link otlpErrorResponse} args by hand — it keeps the wire-format
 * concerns inside the provider while letting the central error mapping
 * stay the single source of truth for HTTP status / gRPC code pairs.
 */
export function otlpErrorResponseFromMapping(
  format: OtlpWireFormat,
  mapping: IngestErrorMapping,
) {
  return otlpErrorResponse(format, {
    httpStatus: mapping.httpStatus,
    grpcCode: mapping.grpcCode,
    message: mapping.publicMessage,
  });
}
