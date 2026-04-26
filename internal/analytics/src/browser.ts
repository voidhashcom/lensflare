import posthog from "posthog-js";
import type { AnalyticsBootstrap, AnalyticsContext, AnalyticsEventName, AnalyticsRecorder } from "./index.ts";
import { withAnalyticsMetadata } from "./index.ts";

export function createBrowserAnalyticsRecorder(
  bootstrap: AnalyticsBootstrap,
  context: AnalyticsContext,
): AnalyticsRecorder {
  if (!bootstrap.enabled || !bootstrap.apiKey) {
    return {
      enabled: false,
      capture: () => {},
      shutdown: () => {},
    };
  }

  posthog.init(bootstrap.apiKey, {
    api_host: bootstrap.host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    person_profiles: "never",
    persistence: "localStorage+cookie",
    bootstrap: {
      distinctID: bootstrap.distinctId,
      isIdentifiedID: false,
    },
    loaded(instance) {
      instance.register({ $process_person_profile: false });
    },
  });

  if (bootstrap.debug) {
    posthog.debug(true);
  }

  return {
    enabled: true,
    capture(event: AnalyticsEventName, properties = {}) {
      posthog.capture(event, withAnalyticsMetadata(context, properties));
    },
    shutdown() {
      posthog.reset();
    },
  };
}

