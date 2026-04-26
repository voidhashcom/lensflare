import { PostHog } from "posthog-node";
import type { AnalyticsBootstrap, AnalyticsContext, AnalyticsEventName, AnalyticsRecorder } from "./index.ts";
import { withAnalyticsMetadata } from "./index.ts";

export function createNodeAnalyticsRecorder(
  bootstrap: AnalyticsBootstrap,
  context: AnalyticsContext,
): AnalyticsRecorder {
  if (!bootstrap.enabled || !bootstrap.apiKey) {
    return {
      enabled: false,
      capture: () => {},
      shutdown: async () => {},
    };
  }

  const client = new PostHog(bootstrap.apiKey, {
    host: bootstrap.host,
    flushAt: 20,
    flushInterval: 1_000,
    disableGeoip: true,
  });

  return {
    enabled: true,
    async capture(event: AnalyticsEventName, properties = {}) {
      await client.capture({
        distinctId: bootstrap.distinctId,
        event,
        properties: {
          ...withAnalyticsMetadata(context, properties),
          $process_person_profile: false,
        },
      });
    },
    shutdown: async () => {
      await client.shutdown();
    },
  };
}
