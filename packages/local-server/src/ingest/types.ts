export type IngestProviderKind = "otlp_http_logs" | "otlp_http_traces" | "axiom_native";

export interface NormalizedLogRecord {
  readonly timestamp: string | null;
  readonly observedTimestamp: string | null;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly traceFlags: string | null;
  readonly severityNumber: number | null;
  readonly severityText: string | null;
  readonly serviceName: string | null;
  readonly resourceSchemaUrl: string | null;
  readonly scopeName: string | null;
  readonly scopeVersion: string | null;
  readonly scopeSchemaUrl: string | null;
  readonly bodyText: string | null;
  readonly bodyJson: string | null;
  readonly resourceJson: string | null;
  readonly scopeJson: string | null;
  readonly attributesJson: string | null;
  readonly droppedAttributesCount: number | null;
  readonly rawRecordJson: string;
}

export interface NormalizedSpanRecord {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly kind: string | null;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly durationUs: number;
  readonly statusCode: number | null;
  readonly statusMessage: string | null;
  readonly serviceName: string | null;
  readonly resourceSchemaUrl: string | null;
  readonly scopeName: string | null;
  readonly scopeVersion: string | null;
  readonly scopeSchemaUrl: string | null;
  readonly resourceJson: string | null;
  readonly scopeJson: string | null;
  readonly attributesJson: string | null;
  readonly droppedAttributesCount: number | null;
  readonly rawSpanJson: string;
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
