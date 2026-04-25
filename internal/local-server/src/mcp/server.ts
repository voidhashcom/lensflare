import {
  type TelemetryRecordPage,
  type TelemetryTraceContext,
} from "@lensflare/contracts";
import { Effect, Layer, Schema } from "effect";
import { McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { TelemetryLogQueryService } from "../ingest/telemetryLogQueryService.ts";
import {
  decodeTelemetryCursor,
  TelemetryQueryService,
} from "../ingest/telemetryQueryService.ts";
import { DatasetService } from "../services/datasetService.ts";
import { parseTelemetryQuery, QueryLanguageError } from "@lensflare/query";

const JsonResult = Schema.Any;
const ToolFailure = Schema.Any;

const Limit = Schema.optional(
  Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: 500 }),
  ).annotate({ description: "Maximum number of records to return." }),
);

const DatasetId = Schema.String.annotate({
  description:
    "Dataset id. Get this from listDatasets; projectId is resolved by the server.",
});

const TELEMETRY_QUERY_LANGUAGE = `Telemetry query language:
- Empty query returns the newest telemetry.
- Free text terms search across messages, names, statuses, service names, trace/span ids, and attributes. Example: timeout ECONNRESET
- Structured comparisons use: <field> <operator> <value>. Example: level = "error" or durationUs >= 1000.
- Boolean logic supports parentheses, and, or, and not. Precedence is: parentheses, not, and, or. Adjacent terms are treated as and.
- Operators: =, !=, contains, startsWith, endsWith, ~= for regex, >, >=, <, <=, in, not in, exists, missing.
- Values: quoted strings with backslash escapes, bare strings, regex literals such as /timeout|ECONNRESET/, numbers, true, false, null, and arrays such as ["error", "fatal"].
- Top-level fields include id, kind, timestamp, level, message, name, status, statusMessage, durationUs, sourceName, serviceName, traceId, spanId, parentSpanId, severityNumber, severityText.
- OTEL attributes use attributes.<key> or attr.<key>. Attribute keys containing dots also work, for example attributes.http.status_code = 500.
- Span event fields use relatedEvents.name and relatedEvents.attributes.<key>.
- Error examples: (level in ["error", "fatal"]) or status = "error"; serviceName = "api" and ((level in ["error", "fatal"]) or status = "error"); message ~= /timeout|ECONNRESET/.`;

const readOnlyLocalTool = <T extends Tool.Any>(tool: T, title: string): T =>
  (tool
    .annotate(Tool.Title, title)
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.OpenWorld, false) as T);

const ListDatasets = readOnlyLocalTool(
  Tool.make("listDatasets", {
    description:
      "List all datasets available to this local Lensflare server. Use the returned dataset id in queryTelemetry and getTrace.",
    success: JsonResult,
    failure: ToolFailure,
    dependencies: [DatasetService],
  }),
  "List Datasets",
);

const QueryTelemetry = readOnlyLocalTool(
  Tool.make("queryTelemetry", {
    description: `Search logs, spans, and span events in one dataset using a single query string.\n\n${TELEMETRY_QUERY_LANGUAGE}`,
    parameters: Schema.Struct({
      datasetId: DatasetId,
      query: Schema.optional(
        Schema.String.annotate({
          description: "Unified telemetry query string. See the tool description for the full language.",
        }),
      ),
      limit: Limit,
      cursor: Schema.optional(
        Schema.String.annotate({ description: "Page cursor returned from a previous query." }),
      ),
      direction: Schema.optional(Schema.Literals(["older", "newer"])),
    }),
    success: JsonResult,
    failure: ToolFailure,
    dependencies: [DatasetService, TelemetryQueryService],
  }),
  "Query Telemetry",
);

const GetTrace = readOnlyLocalTool(
  Tool.make("getTrace", {
    description:
      "Get a trace by trace id, including ordered spans, events, timings, and errored span summary.",
    parameters: Schema.Struct({
      datasetId: DatasetId,
      traceId: Schema.String.annotate({ description: "OTEL trace id." }),
      currentSpanId: Schema.optional(
        Schema.String.annotate({
          description: "Optional span id to select in the returned trace context.",
        }),
      ),
    }),
    success: JsonResult,
    failure: ToolFailure,
    dependencies: [DatasetService, TelemetryLogQueryService],
  }),
  "Get Trace",
);

const LensflareMcpToolkit = Toolkit.make(
  ListDatasets,
  QueryTelemetry,
  GetTrace,
);

function pageSummary(page: TelemetryRecordPage) {
  return {
    ...page,
    usage: {
      nextPageCursor: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
      previousPageCursor: page.pageInfo.hasPreviousPage ? page.pageInfo.startCursor : null,
    },
  };
}

function traceSummary(trace: TelemetryTraceContext | null) {
  if (trace === null) {
    return null;
  }

  const erroredSpans = trace.spans.filter((span) => span.status === "error");
  return {
    ...trace,
    summary: {
      spanCount: trace.spans.length,
      erroredSpanCount: erroredSpans.length,
      erroredSpans: erroredSpans.map((span) => ({
        id: span.id,
        parentSpanId: span.parentSpanId,
        name: span.name,
        serviceName: span.serviceName,
        durationUs: span.durationUs,
      })),
    },
  };
}

const resolveProjectIdForDataset = Effect.fn("LensflareMcp.resolveProjectIdForDataset")(function* (
  datasetId: string,
) {
  const datasets = yield* DatasetService;
  const dataset = (yield* datasets.listDatasets()).find((candidate) => candidate.id === datasetId);
  if (dataset === undefined) {
    return yield* Effect.fail(`Unknown datasetId '${datasetId}'. Call listDatasets first.`);
  }
  return dataset.projectId;
});

export const LensflareMcpToolsLayer = Layer.effectDiscard(
  McpServer.registerToolkit(LensflareMcpToolkit),
).pipe(
  Layer.provideMerge(
    LensflareMcpToolkit.toLayer({
      listDatasets: () =>
        Effect.gen(function* () {
          const datasets = yield* DatasetService;
          return yield* datasets.listDatasets();
        }),
      queryTelemetry: ({ datasetId, query, limit, cursor, direction }) =>
        Effect.gen(function* () {
          const decodedCursor = cursor === undefined ? undefined : decodeTelemetryCursor(cursor);
          if (cursor !== undefined && decodedCursor === null) {
            return yield* Effect.fail("Invalid cursor.");
          }

          const projectId = yield* resolveProjectIdForDataset(datasetId);
          const telemetry = yield* TelemetryQueryService;
          const fields = yield* telemetry.listFields(projectId, datasetId);
          const filter = yield* Effect.try({
            try: () => parseTelemetryQuery(query, fields),
            catch: (error) =>
              error instanceof QueryLanguageError
                ? error.message
                : "Invalid telemetry query.",
          });
          const page = yield* telemetry.listDatasetTelemetry(projectId, datasetId, {
            filter: filter ?? undefined,
            limit,
            cursor: decodedCursor ?? undefined,
            direction,
          });
          return pageSummary(page);
        }),
      getTrace: ({ datasetId, traceId, currentSpanId }) =>
        Effect.gen(function* () {
          const projectId = yield* resolveProjectIdForDataset(datasetId);
          const logs = yield* TelemetryLogQueryService;
          const trace = yield* logs.getTraceContext(projectId, datasetId, traceId, currentSpanId);
          return traceSummary(trace);
        }),
    }),
  ),
);
