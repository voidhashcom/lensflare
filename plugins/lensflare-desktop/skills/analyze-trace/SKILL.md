---
name: analyze-trace
description: Walk a Lensflare trace span-by-span and explain timing, errors, and parent/child structure. Use when the user pastes a trace id, asks "why is this slow", or wants a request-level post-mortem of a real production / dev request captured in Lensflare.
---

# Analyze a trace in Lensflare

1. If the user supplied a `traceId`, use it. Otherwise call `lensflare:queryTelemetry` to find a relevant trace (filter by `serviceName`, time, or attributes). Pick the trace whose root span has the highest `durationUs` or whose `status = "error"`.
2. Call `lensflare:getTrace` with the resolved `datasetId` and `traceId`. If it returns `null`, double-check the `traceId` with `queryTelemetry` (`traceId = "<id>"`) before reporting back.
3. Read `summary.spanCount` and `summary.erroredSpanCount`. If errors exist, lead with them: name + service + `durationUs`.
4. Walk `spans` in order. Highlight the longest span, the deepest chain, and any span whose `status = "error"` or whose duration is more than 50% of its parent's.
5. Surface `relatedEvents` only when they materially explain a failure (e.g. an exception event on the failing span).
6. End with a one-line root-cause hypothesis and a suggested follow-up query. Example: _"to see all requests with this error: `attributes.http.status_code = 500 and serviceName = \"api\"`"_.
