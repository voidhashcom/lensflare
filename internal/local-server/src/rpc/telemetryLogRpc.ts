import { TelemetryLogRpcGroup } from "@lensflare/contracts";
import { Effect } from "effect";
import { TelemetryFilterCatalogService } from "../ingest/telemetryFilterCatalogService.ts";
import { TelemetryLogEventService } from "../ingest/telemetryLogEventService.ts";

export const telemetryLogRpcLayer = TelemetryLogRpcGroup.toLayer(
  Effect.gen(function* () {
    const service = yield* TelemetryLogEventService;
    const filterCatalog = yield* TelemetryFilterCatalogService;

    return TelemetryLogRpcGroup.of({
      SubscribeTelemetryLogEvents: ({ projectId, datasetId, filter }) =>
        service.streamDatasetLogs(projectId, datasetId, filter),
      SubscribeTelemetryEvents: ({ projectId, datasetId, filter }) =>
        service.streamDatasetTelemetry(projectId, datasetId, filter),
      ListTelemetryFilterCatalog: ({ projectId, datasetId }) =>
        filterCatalog.listDatasetCatalog(projectId, datasetId).pipe(Effect.orDie),
      SubscribeTelemetryFilterCatalogEvents: ({ projectId, datasetId }) =>
        filterCatalog.streamDatasetCatalog(projectId, datasetId),
    });
  }),
);
