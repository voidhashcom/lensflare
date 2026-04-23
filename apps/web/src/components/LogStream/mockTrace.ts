import type { LogEntry, TraceContext, TraceSpan } from "./types";

/**
 * Deterministic mock trace data used by the log-details trace overview while
 * the backend trace-query path is still being wired up. Each log entry is
 * hashed into a seed so the generated trace stays stable between renders —
 * without this the UI would reshuffle spans every time a log ticks in via
 * the subscription, which looks broken.
 *
 * Once the query service can return real trace context for a log, this file
 * is the only place that needs to change: consumers should continue to use
 * {@link buildLogTraceContext} as the entry point and we'll swap the body to
 * fetch instead of generate.
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

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash || 1;
}

interface SpanTemplate {
  readonly name: string;
  readonly service: string;
}

/**
 * Pool of realistic span name / service pairs. The waterfall pulls from this
 * list in a depth-aware way: "ingress" spans are picked for the root, then
 * child spans favour storage / cache / downstream calls so the tree reads
 * like a real request path rather than a random sequence.
 */
const ROOT_TEMPLATES: ReadonlyArray<SpanTemplate> = [
  { name: "HTTP GET /api/products", service: "api-gateway" },
  { name: "HTTP POST /api/orders", service: "api-gateway" },
  { name: "HTTP GET /api/users/:id", service: "api-gateway" },
  { name: "graphql.query checkout", service: "bff" },
];

const CHILD_TEMPLATES: ReadonlyArray<SpanTemplate> = [
  { name: "auth.verify", service: "auth-service" },
  { name: "sql.select products", service: "products-service" },
  { name: "sql.insert order", service: "orders-service" },
  { name: "cache.get profile", service: "redis" },
  { name: "kafka.publish order.created", service: "orders-service" },
  { name: "http.request pricing", service: "pricing-service" },
  { name: "http.request inventory", service: "inventory-service" },
  { name: "sql.update stock", service: "inventory-service" },
  { name: "s3.put receipt", service: "notifications" },
  { name: "render.template email", service: "notifications" },
];

/**
 * Returns a mock trace context for `log`, or `null` when the log is treated
 * as "not part of a trace" so the UI also exercises the empty-state path.
 *
 * The null path is deterministic (same log id ⇒ same answer) so a user
 * clicking a log twice sees the same trace / empty state. Level matters here
 * too: errors almost always have a trace in practice, so we skip the
 * probabilistic drop for them.
 */
export function buildLogTraceContext(log: LogEntry): TraceContext | null {
  const seed = hashString(log.id);
  const rand = mulberry32(seed);

  // ~15% of non-error logs are considered "not traced". Errors always get a
  // trace so the demo showcases the highlighted-error-span case.
  const isTraced = log.level === "error" || log.level === "fatal" || rand() >= 0.15;
  if (!isTraced) return null;

  const spanCount = 5 + Math.floor(rand() * 7); // 5-11 spans
  const spans: Array<TraceSpan> = [];

  // Root span owns the whole timeline.
  const rootTemplate = pickTemplate(ROOT_TEMPLATES, rand);
  const totalDurationUs = 2_000 + Math.floor(rand() * 48_000); // 2ms–50ms
  const rootId = formatSpanId(seed, 0);
  spans.push({
    id: rootId,
    parentSpanId: null,
    name: rootTemplate.name,
    serviceName: rootTemplate.service,
    startOffsetUs: 0,
    durationUs: totalDurationUs,
    status: "ok",
  });

  // Child spans are laid out sequentially within the root. We advance a
  // "cursor" offset and give each child a random slice of the remaining
  // budget. Nesting depth flips between 1 and 2 so the tree has visible
  // structure without becoming a staircase.
  let cursorUs = Math.floor(totalDurationUs * 0.02);
  let currentParentId = rootId;
  let currentDepth = 1;
  for (let i = 1; i < spanCount; i++) {
    const budgetUs = Math.max(totalDurationUs - cursorUs - 200, 400);
    // Each child takes 20-70% of the remaining budget divided by roughly how
    // many siblings we still expect to fit, so later spans aren't crammed.
    const remainingSlots = Math.max(spanCount - i, 1);
    const sliceBase = budgetUs / remainingSlots;
    const durationUs = Math.max(
      200,
      Math.floor(sliceBase * (0.4 + rand() * 1.4)),
    );

    const template = pickTemplate(CHILD_TEMPLATES, rand);
    const id = formatSpanId(seed, i);
    spans.push({
      id,
      parentSpanId: currentParentId,
      name: template.name,
      serviceName: template.service,
      startOffsetUs: cursorUs,
      durationUs: Math.min(durationUs, budgetUs),
      status: "ok",
    });

    cursorUs += Math.max(Math.floor(durationUs * 0.75), 200);

    // Alternate between nesting one deeper and popping back to the root so
    // the rendered tree reads like: root → child → grandchild → child → ...
    if (currentDepth < 2 && rand() < 0.55) {
      currentParentId = id;
      currentDepth += 1;
    } else if (currentDepth > 1 && rand() < 0.6) {
      currentParentId = rootId;
      currentDepth = 1;
    }
  }

  // Pick the log's own span. Biased towards the middle of the trace so the
  // overview has context on both sides — a highlighted first/last span
  // defeats the "few above/below" intent. `spans` always has at least the
  // root so `spans[currentIndex]` is defined, but we fall back to the root
  // for type safety.
  const currentIndex = 1 + Math.floor(rand() * (spans.length - 1));
  const currentSpan = spans[currentIndex] ?? spans[0]!;

  // If the log was an error, mark the current span as error so the
  // highlighted row visibly reflects the log's severity. Direct mutation is
  // fine here because the array was just constructed above and hasn't been
  // handed out yet.
  if (log.level === "error" || log.level === "fatal") {
    spans[currentIndex] = { ...currentSpan, status: "error" };
  }

  return {
    traceId: formatTraceId(seed),
    startTime: new Date(log.timestamp.getTime() - Math.floor(totalDurationUs / 1000)),
    totalDurationUs,
    spans,
    currentSpanId: currentSpan.id,
  };
}

function pickTemplate(pool: ReadonlyArray<SpanTemplate>, rand: () => number): SpanTemplate {
  const index = Math.floor(rand() * pool.length);
  // Fallback keeps TypeScript happy — `pool` is non-empty in practice.
  return pool[index] ?? pool[0]!;
}

function formatTraceId(seed: number): string {
  const hex = (seed >>> 0).toString(16).padStart(8, "0");
  return `${hex}${hex}${hex}${hex}`.slice(0, 32);
}

function formatSpanId(seed: number, index: number): string {
  const mixed = ((seed ^ (index * 0x9e_37_79_b1)) >>> 0).toString(16).padStart(8, "0");
  return `${mixed}${mixed}`.slice(0, 16);
}
