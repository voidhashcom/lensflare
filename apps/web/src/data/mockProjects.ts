export interface MockCollection {
  id: string;
  name: string;
}

export interface MockProject {
  id: string;
  name: string;
  /** Lucide icon name; rendered by the sidebar via a small lookup. */
  icon: "folder" | "sparkles" | "rocket" | "compass";
  collections: ReadonlyArray<MockCollection>;
}

export const mockProjects: ReadonlyArray<MockProject> = [
  {
    id: "lensflare",
    name: "lensflare",
    icon: "folder",
    collections: [
      { id: "http", name: "HTTP requests" },
      { id: "spans", name: "Spans for /api/health" },
      { id: "sql", name: "SQL queries" },
      { id: "ws", name: "WebSocket frames" },
      { id: "logs", name: "App logs" },
    ],
  },
  {
    id: "atlas-collector",
    name: "atlas-collector",
    icon: "sparkles",
    collections: [
      { id: "ingest", name: "Ingest pipeline traces" },
      { id: "exporter", name: "OTLP exporter spans" },
      { id: "metrics", name: "Metrics scrape" },
      { id: "errors", name: "Recent errors" },
    ],
  },
  {
    id: "edge-runner",
    name: "edge-runner",
    icon: "rocket",
    collections: [
      { id: "cold-start", name: "Cold-start traces" },
      { id: "render", name: "Render handlers" },
      { id: "kv", name: "KV operations" },
      { id: "cache", name: "Cache hits/misses" },
    ],
  },
  {
    id: "compass",
    name: "compass",
    icon: "compass",
    collections: [
      { id: "session", name: "Session traces" },
      { id: "search", name: "Search latency" },
    ],
  },
];
