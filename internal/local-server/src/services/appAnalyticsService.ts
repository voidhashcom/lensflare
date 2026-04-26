import { createNodeAnalyticsRecorder } from "@lensflare/analytics/node";
import type { AnalyticsContext, AnalyticsEventName, AnalyticsRecorder } from "@lensflare/analytics";
import { bucketDurationMs } from "@lensflare/analytics";
import { Context, Effect, Layer, Ref } from "effect";

import { AppSettingsService } from "./appSettingsService.ts";

export interface AppAnalyticsServiceOptions extends AnalyticsContext {}

interface RecorderState {
  readonly signature: string | null;
  readonly recorder: AnalyticsRecorder;
}

function disabledRecorder(): AnalyticsRecorder {
  return {
    enabled: false,
    capture: () => {},
    shutdown: async () => {},
  };
}

export class AppAnalyticsService extends Context.Service<
  AppAnalyticsService,
  {
    readonly capture: (
      event: AnalyticsEventName,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<void>;
    readonly captureServerStop: (startedAtMs: number) => Effect.Effect<void>;
    readonly shutdown: Effect.Effect<void>;
  }
>()("@lensflare/local-server/AppAnalyticsService") {
  static readonly layer = (options: AppAnalyticsServiceOptions) =>
    Layer.effect(
      AppAnalyticsService,
      Effect.gen(function* () {
        const appSettings = yield* AppSettingsService;
        const recorderRef = yield* Ref.make<RecorderState>({
          signature: null,
          recorder: disabledRecorder(),
        });

        const resolveRecorder = Effect.fn("AppAnalyticsService.resolveRecorder")(function* () {
          const bootstrap = yield* appSettings.getAnalyticsBootstrap();
          const signature = JSON.stringify(bootstrap);
          const current = yield* Ref.get(recorderRef);
          if (current.signature === signature) {
            return current.recorder;
          }

          yield* Effect.promise(() => Promise.resolve(current.recorder.shutdown()));
          const next = createNodeAnalyticsRecorder(
            {
              enabled: bootstrap.enabled,
              distinctId: bootstrap.distinctId,
              host: bootstrap.host,
              debug: bootstrap.debug,
              ...(bootstrap.apiKey ? { apiKey: bootstrap.apiKey } : {}),
            },
            options,
          );
          yield* Ref.set(recorderRef, {
            signature,
            recorder: next,
          });
          return next;
        });

        const capture = Effect.fn("AppAnalyticsService.capture")(function* (
          event: AnalyticsEventName,
          properties?: Readonly<Record<string, unknown>>,
        ) {
          const recorder = yield* resolveRecorder();
          yield* Effect.promise(() => Promise.resolve(recorder.capture(event, properties)));
        });

        const captureServerStop = Effect.fn("AppAnalyticsService.captureServerStop")(function* (
          startedAtMs: number,
        ) {
          yield* capture("server_stopped", {
            uptimeBucket: bucketDurationMs(Date.now() - startedAtMs),
          });
        });

        const shutdown = Ref.get(recorderRef).pipe(
          Effect.flatMap((state) => Effect.promise(() => Promise.resolve(state.recorder.shutdown()))),
        );

        return {
          capture,
          captureServerStop,
          shutdown,
        };
      }),
    );
}
