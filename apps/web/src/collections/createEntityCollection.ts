import type { ChangeMessageOrDeleteKeyMessage, CollectionConfig, SyncConfig } from "@tanstack/db";
import { Cause, Effect, Exit, Stream } from "effect";
import { CatalogRpcClient, type CatalogRpcClientShape, rpcRuntime } from "~/data/rpc";
import { reportRpcConnectionFailure } from "~/data/rpcConnection";

/**
 * The generic shape shared by both `ProjectChangeEvent` and
 * `DatasetChangeEvent`. Kept private-ish (only used as a structural
 * constraint on {@link createEntityCollectionOptions}) so the concrete
 * types in `@lensflare/contracts` remain the single source of truth for
 * each domain.
 */
export type EntityChangeEvent<TItem> =
  | { readonly action: "upsert"; readonly value: TItem }
  | { readonly action: "delete"; readonly id: string };

export interface EntityCollectionUtils {
  readonly lastError: Error | undefined;
  clearError(): void;
}

/**
 * TanStack DB collection config helper.
 *
 * Encapsulates the "snapshot + stream" sync pattern: on start-up we
 * subscribe to the change feed, then fetch the initial list, apply it as
 * a truncate-insert snapshot, and replay any events that arrived while
 * the snapshot was in flight. Everything after that is handled by the
 * per-event path.
 *
 * The helper is structural — it knows nothing about projects or datasets
 * beyond "items of type `TItem` keyed by `TKey` with an upsert/delete
 * change stream". That keeps the two domain collection files free of
 * cross-concerns.
 */
export function createEntityCollectionOptions<TItem extends object, TKey extends string>(config: {
  readonly getKey: (item: TItem) => TKey;
  readonly list: (
    client: CatalogRpcClientShape,
  ) => Effect.Effect<ReadonlyArray<TItem>, unknown, never>;
  readonly subscribe: (
    client: CatalogRpcClientShape,
  ) => Stream.Stream<EntityChangeEvent<TItem>, unknown, never>;
  readonly formatError: (error: unknown) => Error;
}): CollectionConfig<TItem, TKey, never, EntityCollectionUtils> & {
  utils: EntityCollectionUtils;
} {
  const state: { lastError: Error | undefined } = {
    lastError: undefined,
  };

  const utils: EntityCollectionUtils = {
    get lastError() {
      return state.lastError;
    },
    clearError() {
      state.lastError = undefined;
    },
  };

  return {
    getKey: config.getKey,
    sync: {
      rowUpdateMode: "full" as const,
      sync: ({
        begin,
        write,
        commit,
        markReady,
        truncate,
        collection,
      }: Parameters<SyncConfig<TItem, TKey>["sync"]>[0]) => {
        const bufferedEvents: Array<EntityChangeEvent<TItem>> = [];
        let isReady = false;
        let readyMarked = false;

        const ensureReady = () => {
          if (readyMarked) {
            return;
          }
          readyMarked = true;
          markReady();
        };

        const applyChange = (change: ChangeMessageOrDeleteKeyMessage<TItem, TKey>) => {
          begin();
          write(change);
          commit();
        };

        const applySnapshot = (items: ReadonlyArray<TItem>) => {
          begin();
          truncate();
          for (const item of items) {
            write({
              type: "insert",
              value: item,
            });
          }
          commit();
        };

        const toChangeMessage = (
          event: EntityChangeEvent<TItem>,
        ): ChangeMessageOrDeleteKeyMessage<TItem, TKey> | null => {
          const syncedData = collection._state.syncedData;

          if (event.action === "delete") {
            const key = event.id as TKey;
            return syncedData.has(key)
              ? {
                  key,
                  type: "delete",
                }
              : null;
          }

          const value = event.value;
          const key = config.getKey(value);

          return syncedData.has(key)
            ? {
                type: "update",
                value,
              }
            : {
                type: "insert",
                value,
              };
        };

        const handleEvent = (event: EntityChangeEvent<TItem>) => {
          if (!isReady) {
            bufferedEvents.push(event);
            return;
          }

          const change = toChangeMessage(event);
          if (change !== null) {
            applyChange(change);
          }
        };

        return rpcRuntime.runCallback(
          Effect.scoped(
            Effect.gen(function* () {
              const client = yield* CatalogRpcClient.asEffect();
              const stream = config.subscribe(client);

              yield* stream.pipe(
                Stream.runForEach((event) =>
                  Effect.sync(() => {
                    handleEvent(event);
                  }),
                ),
                Effect.catchCause((cause) =>
                  Effect.sync(() => {
                    const error = Cause.squash(cause);
                    state.lastError = config.formatError(error);
                    reportRpcConnectionFailure(error);
                    ensureReady();
                  }),
                ),
                Effect.forkChild,
              );

              const items = [...(yield* config.list(client))];

              yield* Effect.sync(() => {
                state.lastError = undefined;
                applySnapshot(items);
                isReady = true;

                for (const event of bufferedEvents) {
                  const change = toChangeMessage(event);
                  if (change !== null) {
                    applyChange(change);
                  }
                }

                bufferedEvents.length = 0;
                ensureReady();
              });

              return yield* Effect.never;
            }),
          ),
          {
            onExit: (exit) => {
              if (!Exit.isFailure(exit) || Cause.hasInterruptsOnly(exit.cause)) {
                return;
              }

              const error = Cause.squash(exit.cause);
              state.lastError = config.formatError(error);
              reportRpcConnectionFailure(error);
              ensureReady();
            },
          },
        );
      },
    },
    utils,
  };
}
