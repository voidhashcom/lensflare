# Lensflare Desktop

## Description

Lensflare is a local-first observability workspace. With this plugin, your agent (Claude Code, Cursor, Codex, …) can search the logs, spans, and traces flowing into the Lensflare desktop app — no cloud, no auth, no data egress. The MCP server runs at `http://127.0.0.1:43110/mcp` whenever the desktop app is open.

## Tools

- **`listDatasets`** — list all datasets in the local server. Use the returned `datasetId` for the other tools.
- **`queryTelemetry`** — search logs, spans, and span events with a structured query language (`level in ["error","fatal"]`, `serviceName = "api"`, `attributes.http.status_code = 500`, `durationUs >= 1000000`, regex via `~=`, etc.). Paginates via `usage.nextPageCursor`.
- **`getTrace`** — fetch a complete trace by id, with ordered spans, events, timings, and an errored-span summary.

## Skills

This plugin ships three skills that wire the tools into common workflows:

- **`find-error`** — surface recent errors in a dataset and summarise the dominant failure mode.
- **`analyze-trace`** — walk a trace span by span, highlighting the longest / failing spans and proposing a follow-up query.
- **`query-logs`** — translate prose questions into Lensflare's query language and return paginated results.

## Prerequisites

The Lensflare desktop app must be running. Download it at [lensflare.dev/download](https://lensflare.dev/download).

## Examples

### Example 1: Find errors

**User prompt:** "What errors happened in my dev dataset in the last hour?"

**Expected behavior:**

- Calls `lensflare:listDatasets` (if needed), then `lensflare:queryTelemetry` with `level in ["error","fatal"] or status = "error"`.
- Groups by `name` / `message` to find the dominant failure.
- For the top error, fetches the trace via `lensflare:getTrace` and reports the failing span.

### Example 2: Analyse a trace

**User prompt:** "Pull trace 7c1e... from Lensflare and tell me where it failed."

**Expected behavior:**

- Calls `lensflare:getTrace` with the supplied id.
- Reads `summary.erroredSpans` and the longest spans.
- Reports a one-line root-cause hypothesis and a follow-up query.

### Example 3: Translate a prose question

**User prompt:** "Show me the slowest spans where serviceName = api."

**Expected behavior:**

- Calls `lensflare:queryTelemetry` with `serviceName = "api" and durationUs >= 1000000`.
- Lists the top spans by `durationUs`.

## Privacy Policy

See: [lensflare.dev/privacy](https://lensflare.dev/privacy).

## Support

- Documentation: [lensflare.dev/docs/mcp](https://lensflare.dev/docs/mcp)
- Issues: [github.com/voidhashcom/lensflare/issues](https://github.com/voidhashcom/lensflare/issues)
