import { TelemetryLogRpcGroup } from "@lensflare/contracts";
import { Effect } from "effect";
import { TelemetryLogEventService } from "../ingest/telemetryLogEventService.ts";

export const telemetryLogRpcLayer = TelemetryLogRpcGroup.toLayer(
  Effect.gen(function* () {
    const service = yield* TelemetryLogEventService;

    return TelemetryLogRpcGroup.of({
      SubscribeTelemetryLogEvents: ({ projectId, datasetId }) =>
        service.streamDatasetLogs(projectId, datasetId),
    });
  }),
);
