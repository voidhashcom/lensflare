---
name: query-logs
description: Translate a natural-language question about logs or telemetry into a Lensflare query and return the results. Use when the user asks "find logs that…", "show me…", or describes a filter in prose that should map to a structured query.
---

# Query Lensflare telemetry

You have access to a structured query language exposed via `lensflare:queryTelemetry`. The full grammar is in that tool's description — read it. Examples:

- "errors from the api service" → `serviceName = "api" and (level in ["error", "fatal"] or status = "error")`
- "slow requests" → `durationUs >= 1000000`
- "anything that mentions ECONNRESET" → `message ~= /ECONNRESET/`
- "logs with http status 500" → `attributes.http.status_code = 500`

Steps:

1. Identify the dataset. Use `lensflare:listDatasets` if needed.
2. Translate the user's prose into a single query string. Prefer structured comparisons over free-text — fewer false positives, easier to refine.
3. Call `lensflare:queryTelemetry` with `limit: 50` (or as requested). Use `cursor` from `usage.nextPageCursor` if the user asks for more.
4. Summarise the page: counts, time range covered, dominant `serviceName` / `level`. Show a few example records inline (id, level, message or name, timestamp).
5. Offer a refined query if the result set is too broad or too narrow.

Never invent fields — call `queryTelemetry` with no `query` first if you're unsure; the records show you the available shape.
