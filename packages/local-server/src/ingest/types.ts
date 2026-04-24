export type IngestProviderKind = "otlp_http_logs" | "otlp_http_traces" | "axiom_native";

export type OtelSpanStatusCode = "Unset" | "Ok" | "Error";

export type OtelAttributes = Readonly<Record<string, string>>;

export interface NormalizedLogRecord {
  readonly timestamp: string | null;
  readonly observedTimestamp: string | null;
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
  readonly severityNumber: number;
  readonly severityText: string;
  readonly serviceName: string;
  readonly body: string;
  readonly resourceSchemaUrl: string;
  readonly resourceAttributes: OtelAttributes;
  readonly scopeSchemaUrl: string;
  readonly scopeName: string;
  readonly scopeVersion: string;
  readonly scopeAttributes: OtelAttributes;
  readonly logAttributes: OtelAttributes;
}

export interface NormalizedSpanRecord {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string;
  readonly traceState: string;
  readonly timestamp: string;
  readonly spanName: string;
  readonly spanKind: string;
  readonly serviceName: string;
  readonly resourceAttributes: OtelAttributes;
  readonly scopeName: string;
  readonly scopeVersion: string;
  readonly spanAttributes: OtelAttributes;
  readonly durationNs: number;
  readonly statusCode: OtelSpanStatusCode;
  readonly statusMessage: string;
  readonly events: ReadonlyArray<NormalizedSpanEventRecord>;
  readonly links: ReadonlyArray<NormalizedSpanLinkRecord>;
}

export interface NormalizedSpanEventRecord {
  readonly timestamp: string;
  readonly name: string;
  readonly attributes: OtelAttributes;
}

export interface NormalizedSpanLinkRecord {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceState: string;
  readonly attributes: OtelAttributes;
}

export interface NormalizedLogIngestBatch {
  readonly providerKind: IngestProviderKind;
  readonly signal: "logs";
  readonly records: ReadonlyArray<NormalizedLogRecord>;
  readonly droppedRecords: number;
  readonly warnings: ReadonlyArray<string>;
}

export interface NormalizedTraceIngestBatch {
  readonly providerKind: IngestProviderKind;
  readonly signal: "traces";
  readonly spans: ReadonlyArray<NormalizedSpanRecord>;
  readonly droppedRecords: number;
  readonly warnings: ReadonlyArray<string>;
}

export type NormalizedIngestBatch = NormalizedLogIngestBatch | NormalizedTraceIngestBatch;

export interface IngestWriteRequest {
  readonly providerKind: IngestProviderKind;
  readonly signal: "logs";
  readonly projectId: string;
  readonly projectSlug: string;
  readonly datasetId: string;
  readonly datasetSlug: string;
  readonly requestContentType: string;
  readonly requestContentEncoding: string | null;
  readonly requestBytes: number;
  readonly clientAddr: string | null;
  readonly receivedAt: string;
  readonly records: ReadonlyArray<NormalizedLogRecord>;
}

export interface SpanIngestWriteRequest {
  readonly providerKind: IngestProviderKind;
  readonly signal: "traces";
  readonly projectId: string;
  readonly projectSlug: string;
  readonly datasetId: string;
  readonly datasetSlug: string;
  readonly requestContentType: string;
  readonly requestContentEncoding: string | null;
  readonly requestBytes: number;
  readonly clientAddr: string | null;
  readonly receivedAt: string;
  readonly spans: ReadonlyArray<NormalizedSpanRecord>;
}

export interface WrittenLogRecord {
  readonly id: string;
  readonly record: NormalizedLogRecord;
}

export interface WrittenSpanRecord {
  readonly id: string;
  readonly record: NormalizedSpanRecord;
}
