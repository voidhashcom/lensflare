import { PostHog } from "posthog-node";
import type {
  AnalyticsBootstrap,
  AnalyticsContext,
  AnalyticsEventName,
  AnalyticsRecorder,
} from "./index.ts";
import { withAnalyticsMetadata } from "./index.ts";

const ANALYTICS_SHUTDOWN_TIMEOUT_MS = 250;

function ignorePromiseRejection(promise: Promise<unknown>): void {
  void promise.catch(() => {
    // Analytics must never delay or break app lifecycle transitions.
  });
}

function normalizePromise(value: void | Promise<unknown>): Promise<unknown> {
  return Promise.resolve(value);
}

function withTimeout(promise: void | Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    ignorePromiseRejection(
      normalizePromise(promise).finally(() => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });
}

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
    capture(event: AnalyticsEventName, properties = {}) {
      ignorePromiseRejection(
        normalizePromise(
          client.capture({
            distinctId: bootstrap.distinctId,
            event,
            properties: {
              ...withAnalyticsMetadata(context, properties),
              $process_person_profile: false,
            },
          }),
        ),
      );
    },
    shutdown() {
      return withTimeout(client.shutdown(), ANALYTICS_SHUTDOWN_TIMEOUT_MS);
    },
  };
}
