import protobuf from "protobufjs";

/**
 * OTLP wire format declarations.
 *
 * The OpenTelemetry collector ships protobuf descriptors as part of its own
 * source tree, but pulling that whole dependency in just for HTTP/gRPC
 * exports of `LogRecord` would be massive overkill. Instead we declare the
 * minimal slice of the schema we need inline — this is a faithful, signal-
 * scoped subset of `opentelemetry-proto/` covering:
 *
 *   • `common.v1.AnyValue`/`KeyValue`/`InstrumentationScope`
 *   • `resource.v1.Resource`
 *   • `logs.v1.{LogRecord,ScopeLogs,ResourceLogs,SeverityNumber}`
 *   • `collector.logs.v1.ExportLogsServiceRequest`/`ExportLogsServiceResponse`
 *   • `google.rpc.Status` (for OTLP error responses)
 *
 * If we add metrics or traces support later, those proto strings live next
 * to these and reuse the shared `common.v1` types via the same `Root`.
 */

const commonProto = `
syntax = "proto3";
package opentelemetry.proto.common.v1;

message AnyValue {
  oneof value {
    string string_value = 1;
    bool bool_value = 2;
    int64 int_value = 3;
    double double_value = 4;
    ArrayValue array_value = 5;
    KeyValueList kvlist_value = 6;
    bytes bytes_value = 7;
  }
}

message ArrayValue {
  repeated AnyValue values = 1;
}

message KeyValueList {
  repeated KeyValue values = 1;
}

message KeyValue {
  string key = 1;
  AnyValue value = 2;
}

message InstrumentationScope {
  string name = 1;
  string version = 2;
  repeated KeyValue attributes = 3;
  uint32 dropped_attributes_count = 4;
}
`;

const resourceProto = `
syntax = "proto3";
package opentelemetry.proto.resource.v1;

message Resource {
  repeated opentelemetry.proto.common.v1.KeyValue attributes = 1;
  uint32 dropped_attributes_count = 2;
}
`;

const logsProto = `
syntax = "proto3";
package opentelemetry.proto.logs.v1;

enum SeverityNumber {
  SEVERITY_NUMBER_UNSPECIFIED = 0;
  SEVERITY_NUMBER_TRACE = 1;
  SEVERITY_NUMBER_TRACE2 = 2;
  SEVERITY_NUMBER_TRACE3 = 3;
  SEVERITY_NUMBER_TRACE4 = 4;
  SEVERITY_NUMBER_DEBUG = 5;
  SEVERITY_NUMBER_DEBUG2 = 6;
  SEVERITY_NUMBER_DEBUG3 = 7;
  SEVERITY_NUMBER_DEBUG4 = 8;
  SEVERITY_NUMBER_INFO = 9;
  SEVERITY_NUMBER_INFO2 = 10;
  SEVERITY_NUMBER_INFO3 = 11;
  SEVERITY_NUMBER_INFO4 = 12;
  SEVERITY_NUMBER_WARN = 13;
  SEVERITY_NUMBER_WARN2 = 14;
  SEVERITY_NUMBER_WARN3 = 15;
  SEVERITY_NUMBER_WARN4 = 16;
  SEVERITY_NUMBER_ERROR = 17;
  SEVERITY_NUMBER_ERROR2 = 18;
  SEVERITY_NUMBER_ERROR3 = 19;
  SEVERITY_NUMBER_ERROR4 = 20;
  SEVERITY_NUMBER_FATAL = 21;
  SEVERITY_NUMBER_FATAL2 = 22;
  SEVERITY_NUMBER_FATAL3 = 23;
  SEVERITY_NUMBER_FATAL4 = 24;
}

message LogRecord {
  fixed64 time_unix_nano = 1;
  SeverityNumber severity_number = 2;
  string severity_text = 3;
  opentelemetry.proto.common.v1.AnyValue body = 5;
  repeated opentelemetry.proto.common.v1.KeyValue attributes = 6;
  uint32 dropped_attributes_count = 7;
  fixed32 flags = 8;
  bytes trace_id = 9;
  bytes span_id = 10;
  fixed64 observed_time_unix_nano = 11;
}

message ScopeLogs {
  opentelemetry.proto.common.v1.InstrumentationScope scope = 1;
  repeated LogRecord log_records = 2;
  string schema_url = 3;
}

message ResourceLogs {
  opentelemetry.proto.resource.v1.Resource resource = 1;
  repeated ScopeLogs scope_logs = 2;
  string schema_url = 3;
}
`;

const tracesProto = `
syntax = "proto3";
package opentelemetry.proto.trace.v1;

enum SpanKind {
  SPAN_KIND_UNSPECIFIED = 0;
  SPAN_KIND_INTERNAL = 1;
  SPAN_KIND_SERVER = 2;
  SPAN_KIND_CLIENT = 3;
  SPAN_KIND_PRODUCER = 4;
  SPAN_KIND_CONSUMER = 5;
}

message Status {
  enum StatusCode {
    STATUS_CODE_UNSET = 0;
    STATUS_CODE_OK = 1;
    STATUS_CODE_ERROR = 2;
  }

  string message = 2;
  StatusCode code = 3;
}

message Span {
  bytes trace_id = 1;
  bytes span_id = 2;
  string trace_state = 3;
  bytes parent_span_id = 4;
  fixed32 flags = 16;
  string name = 5;
  SpanKind kind = 6;
  fixed64 start_time_unix_nano = 7;
  fixed64 end_time_unix_nano = 8;
  repeated opentelemetry.proto.common.v1.KeyValue attributes = 9;
  uint32 dropped_attributes_count = 10;
  repeated Event events = 11;
  Status status = 15;

  message Event {
    fixed64 time_unix_nano = 1;
    string name = 2;
    repeated opentelemetry.proto.common.v1.KeyValue attributes = 3;
    uint32 dropped_attributes_count = 4;
  }
}

message ScopeSpans {
  opentelemetry.proto.common.v1.InstrumentationScope scope = 1;
  repeated Span spans = 2;
  string schema_url = 3;
}

message ResourceSpans {
  opentelemetry.proto.resource.v1.Resource resource = 1;
  repeated ScopeSpans scope_spans = 2;
  string schema_url = 3;
}
`;

const traceServiceProto = `
syntax = "proto3";
package opentelemetry.proto.collector.trace.v1;

message ExportTracePartialSuccess {
  int64 rejected_spans = 1;
  string error_message = 2;
}

message ExportTraceServiceRequest {
  repeated opentelemetry.proto.trace.v1.ResourceSpans resource_spans = 1;
}

message ExportTraceServiceResponse {
  ExportTracePartialSuccess partial_success = 1;
}
`;

const serviceProto = `
syntax = "proto3";
package opentelemetry.proto.collector.logs.v1;

message ExportLogsPartialSuccess {
  int64 rejected_log_records = 1;
  string error_message = 2;
}

message ExportLogsServiceRequest {
  repeated opentelemetry.proto.logs.v1.ResourceLogs resource_logs = 1;
}

message ExportLogsServiceResponse {
  ExportLogsPartialSuccess partial_success = 1;
}
`;

const statusProto = `
syntax = "proto3";
package google.rpc;

message Status {
  int32 code = 1;
  string message = 2;
}
`;

// One Root, parsed at module import time. protobufjs caches the parsed
// schema globally on the Root instance, so every `lookupType` below is a
// constant-time map lookup against the same in-memory descriptor set.
const root = new protobuf.Root();
protobuf.parse(commonProto, root);
protobuf.parse(resourceProto, root);
protobuf.parse(logsProto, root);
protobuf.parse(tracesProto, root);
protobuf.parse(serviceProto, root);
protobuf.parse(traceServiceProto, root);
protobuf.parse(statusProto, root);

export const exportLogsServiceRequestType = root.lookupType(
  "opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest",
);
export const exportLogsServiceResponseType = root.lookupType(
  "opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse",
);
export const exportTraceServiceRequestType = root.lookupType(
  "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest",
);
export const exportTraceServiceResponseType = root.lookupType(
  "opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse",
);
export const googleRpcStatusType = root.lookupType("google.rpc.Status");
