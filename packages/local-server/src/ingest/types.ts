export type IngestProviderKind = "otlp_http_logs" | "axiom_native";

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

export interface NormalizedIngestBatch {
  readonly providerKind: IngestProviderKind;
  readonly signal: "logs";
  readonly records: ReadonlyArray<NormalizedLogRecord>;
  readonly droppedRecords: number;
  readonly warnings: ReadonlyArray<string>;
}

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
