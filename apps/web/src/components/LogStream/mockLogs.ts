import type { HistogramBucket, LogEntry, LogLevel, SourceIconKind } from "./types";

/**
 * Deterministic pseudo-random number generator so the UI stays stable
 * between renders / HMR. Given the same (seed, index) we return the same
 * value — important because the histogram would otherwise flicker on
 * every re-render.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Builds a stable histogram shape for a given number of buckets + seed. */
export function generateMockHistogram(bucketCount = 96, seed = 42): Array<HistogramBucket> {
  const rand = mulberry32(seed);
  const now = Date.now();
  const rangeMs = 30 * 24 * 60 * 60 * 1000;
  const bucketMs = rangeMs / bucketCount;

  const buckets: Array<HistogramBucket> = [];
  for (let i = 0; i < bucketCount; i++) {
    const timestamp = new Date(now - (bucketCount - 1 - i) * bucketMs);
    // Base noise + occasional spike, ranged around 40k–230k.
    const base = 40_000 + rand() * 160_000;
    const spike = rand() > 0.85 ? rand() * 40_000 : 0;
    const count = Math.round(base + spike);
    const errorCount = Math.round(count * (0.008 + rand() * 0.025));
    buckets.push({ timestamp, count, errorCount });
  }
  return buckets;
}

const SAMPLE_MESSAGES: ReadonlyArray<{ level: LogLevel; message: string }> = [
  {
    level: "info",
    message:
      "GET http://adieto-backend-prod-ni7ui.ondigitalocean.app/api/trpc/product.all?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22search%22%3A%22Vlo%22%2C%22categoryId%22%3Anull%2C%22limit%22%3A30%2C%22onlyCreatedByCurrentUser%22%3Afalse%2C%22direction%22%3A%22forward%22%7D%2C%22meta%22%3A%7B%22values%22%3A%7B%22categoryId%22%3A%5B%22undefined%22%5D%7D%7D%7D%7D%7D - 200 - 232ms",
  },
  {
    level: "info",
    message:
      "GET http://adieto-backend-prod-ni7ui.ondigitalocean.app/api/trpc/product.all?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22search%22%3A%22Vl%22%2C%22categoryId%22%3Anull%2C%22limit%22%3A30%2C%22onlyCreatedByCurrentUser%22%3Afalse%2C%22direction%22%3A%22forward%22%7D%2C%22meta%22%3A%7B%22values%22%3A%7B%22categoryId%22%3A%5B%22undefined%22%5D%7D%7D%7D%7D%7D - 200 - 407ms",
  },
  {
    level: "info",
    message:
      "GET http://adieto-backend-prod-ni7ui.ondigitalocean.app/api/trpc/product.all?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22search%22%3A%22Vloc%22%2C%22categoryId%22%3Anull%2C%22limit%22%3A30%2C%22onlyCreatedByCurrentUser%22%3Afalse%2C%22direction%22%3A%22forward%22%7D%2C%22meta%22%3A%7B%22values%22%3A%7B%22categoryId%22%3A%5B%22undefined%22%5D%7D%7D%7D%7D%7D - 200 - 274ms",
  },
  {
    level: "info",
    message:
      "GET http://adieto-backend-prod-ni7ui.ondigitalocean.app/api/trpc/product.all?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22search%22%3A%22Protein%22%2C%22categoryId%22%3Anull%2C%22limit%22%3A30%2C%22onlyCreatedByCurrentUser%22%3Afalse%2C%22cursor%22%3A90%2C%22direction%22%3A%22forward%22%7D%2C%22meta%22%3A%7B%22values%22%3A%7B%22categoryId%22%3A%5B%22undefined%22%5D%7D%7D%7D%7D%7D - 200 - 518ms",
  },
  {
    level: "info",
    message:
      "GET http://adieto-backend-prod-ni7ui.ondigitalocean.app/api/trpc/product.all?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22search%22%3A%22Vlocj%22%2C%22categoryId%22%3Anull%2C%22limit%22%3A30%2C%22onlyCreatedByCurrentUser%22%3Afalse%2C%22direction%22%3A%22forward%22%7D%2C%22meta%22%3A%7B%22values%22%3A%7B%22categoryId%22%3A%5B%22undefined%22%5D%7D%7D%7D%7D%7D - 200 - 311ms",
  },
  {
    level: "warn",
    message:
      "Slow query detected: GET /api/trpc/product.all took 1284ms (threshold: 1000ms) - consider adding an index on (search, categoryId)",
  },
  {
    level: "error",
    message:
      "Unhandled exception in POST /api/trpc/order.create: ValidationError: shipping_address.postal_code is required - request aborted after 47ms",
  },
  {
    level: "debug",
    message:
      "Cache hit for key user:profile:7f1e2 (ttl=298s) — returning stale value while refreshing in background",
  },
];

/**
 * Returns a list of mock log entries anchored to the current time. Entries
 * are generated deterministically per (seed, datasetName) so the rendered
 * stream looks consistent across reloads for the same dataset.
 */
export function generateMockLogs(
  datasetName: string,
  count = 18,
  sourceIcon: SourceIconKind = "js",
): Array<LogEntry> {
  const seed = hashString(datasetName);
  const rand = mulberry32(seed);
  const now = Date.now();
  const entries: Array<LogEntry> = [];

  for (let i = 0; i < count; i++) {
    const template = SAMPLE_MESSAGES[Math.floor(rand() * SAMPLE_MESSAGES.length)];
    if (!template) {
      continue;
    }
    const stepMs = 80 + Math.floor(rand() * 340);
    const timestamp = new Date(now - (count - i) * stepMs);
    entries.push({
      id: `${seed}-${i}`,
      timestamp,
      sourceName: datasetName,
      sourceIcon,
      level: template.level,
      message: template.message,
    });
  }
  return entries;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash || 1;
}
