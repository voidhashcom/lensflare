import type { AnalyticsBootstrap, AppSettings, UpdateAppSettingsInput } from "@lensflare/contracts";
import { Context, Effect, Layer, Ref } from "effect";

import {
  mergeAppSettings,
  readHashedAnalyticsDistinctId,
  readPersistedAppSettings,
  resolveLocalAppStatePaths,
  writePersistedAppSettings,
} from "../appSettings.ts";

export interface AppSettingsServiceOptions {
  readonly analytics: {
    readonly enabled: boolean;
    readonly host: string;
    readonly apiKey?: string;
    readonly debug: boolean;
  };
}

export class AppSettingsService extends Context.Service<
  AppSettingsService,
  {
    readonly getSettings: () => Effect.Effect<AppSettings>;
    readonly updateSettings: (input: UpdateAppSettingsInput) => Effect.Effect<AppSettings>;
    readonly getAnalyticsBootstrap: () => Effect.Effect<AnalyticsBootstrap>;
  }
>()("@lensflare/local-server/AppSettingsService") {
  static readonly layer = (options: AppSettingsServiceOptions) =>
    Layer.effect(
      AppSettingsService,
      Effect.gen(function* () {
        const paths = resolveLocalAppStatePaths();
        const initialSettings = yield* Effect.promise(() =>
          readPersistedAppSettings(paths.appSettingsFile),
        );
        const distinctId = yield* Effect.promise(() =>
          readHashedAnalyticsDistinctId(paths.analyticsAnonymousIdFile),
        );
        const settingsRef = yield* Ref.make(initialSettings);

        const getSettings = Effect.fn("AppSettingsService.getSettings")(function* () {
          return yield* Ref.get(settingsRef);
        });

        const updateSettings = Effect.fn("AppSettingsService.updateSettings")(function* (
          input: UpdateAppSettingsInput,
        ) {
          const next = mergeAppSettings(yield* Ref.get(settingsRef), input);
          yield* Effect.promise(() => writePersistedAppSettings(next, paths.appSettingsFile));
          yield* Ref.set(settingsRef, next);
          return next;
        });

        const getAnalyticsBootstrap = Effect.fn("AppSettingsService.getAnalyticsBootstrap")(
          function* () {
            const settings = yield* Ref.get(settingsRef);
            return {
              enabled: options.analytics.enabled && settings.analyticsEnabled,
              distinctId,
              host: options.analytics.host,
              ...(options.analytics.apiKey ? { apiKey: options.analytics.apiKey } : {}),
              debug: options.analytics.debug,
            } satisfies AnalyticsBootstrap;
          },
        );

        return {
          getSettings,
          updateSettings,
          getAnalyticsBootstrap,
        };
      }),
    );
}
