import { exportLogsServiceRequestType, exportTraceServiceRequestType } from "./proto.ts";

/**
 * Encode an `ExportLogsServiceRequest`-shaped JS object into the same
 * protobuf wire bytes a real OTLP client would send.
 *
 * Tests use this to round-trip through the production decoder path
 * (protobuf → object → normalized batch) without spinning up a separate
 * exporter. Production code never imports this.
 */
export function encodeOtlpRequestForTest(document: Record<string, unknown>): Uint8Array {
  return exportLogsServiceRequestType.encode(document).finish();
}

export function encodeOtlpTraceRequestForTest(document: Record<string, unknown>): Uint8Array {
  return exportTraceServiceRequestType.encode(document).finish();
}
