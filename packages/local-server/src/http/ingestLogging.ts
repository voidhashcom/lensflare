export interface IngestFailureLog {
  readonly provider: string;
  readonly route: string;
  readonly contentType: string | null;
  readonly contentEncoding: string | null;
  readonly projectSlug: string | null;
  readonly datasetSlug: string | null;
  readonly requestBytes: number | null;
  readonly errorCategory: string;
  readonly errorMessage: string;
}

export function logIngestFailure(entry: IngestFailureLog): void {
  console.error(
    JSON.stringify({
      level: "error",
      source: "lensflare.ingest",
      ...entry,
    }),
  );
}
