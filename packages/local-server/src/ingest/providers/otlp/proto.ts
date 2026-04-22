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
protobuf.parse(serviceProto, root);
protobuf.parse(statusProto, root);

export const exportLogsServiceRequestType = root.lookupType(
  "opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest",
);
export const exportLogsServiceResponseType = root.lookupType(
  "opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse",
);
export const googleRpcStatusType = root.lookupType("google.rpc.Status");
