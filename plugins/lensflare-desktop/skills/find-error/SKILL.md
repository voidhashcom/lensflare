---
name: find-error
description: Find recent errors in a Lensflare dataset and summarise their root cause. Use when the user asks "what's broken", "what errors are happening", or pastes a vague stack trace and wants the actual failure context from the running system.
---

# Find an error in Lensflare

You have access to the Lensflare MCP server (`lensflare`).

1. Call `lensflare:listDatasets` if the user has not specified one. If exactly one dataset exists, use it. Otherwise, ask the user which to query.
2. Call `lensflare:queryTelemetry` with `query: 'level in ["error", "fatal"] or status = "error"'`. Use `limit: 50` unless the user asked for more.
3. Group the returned records by `name` (for spans) or `message` (for logs) to find the dominant failure mode.
4. For the most frequent error, if it has a `traceId`, call `lensflare:getTrace` and read `summary.erroredSpans` to identify the failing span.
5. Report: the error class, frequency, the failing service, and the first failing span. Include the `traceId` so the user can open the trace in the desktop app.

**Query language reminder.** Use `~=` for regex, `contains` for substring, and quote string values. Boolean operators are `and` / `or` / `not`. Top-level fields include `level`, `status`, `serviceName`, `traceId`, `durationUs`. Attributes use `attributes.<key>` (or `attr.<key>`). The full grammar is in the `queryTelemetry` tool description.
