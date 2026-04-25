import type { SyncConfig } from "@tanstack/db";
import { Effect, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEntityCollectionOptions } from "./createEntityCollection";
import { reportRpcConnectionFailure } from "~/data/rpcConnectionManager";

const rpcConnectionManagerMock = vi.hoisted(() => {
  const state: {
    factory: ((client: unknown) => Effect.Effect<unknown, unknown>) | undefined;
  } = {
    factory: undefined,
  };

  return {
    state,
    reportRpcConnectionFailure: vi.fn(),
    runRpcCallback: vi.fn((factory: (client: unknown) => Effect.Effect<unknown, unknown>) => {
      state.factory = factory;
      return vi.fn();
    }),
  };
});

vi.mock("~/data/rpcConnectionManager", () => ({
  reportRpcConnectionFailure: rpcConnectionManagerMock.reportRpcConnectionFailure,
  runRpcCallback: rpcConnectionManagerMock.runRpcCallback,
}));

afterEach(() => {
  rpcConnectionManagerMock.state.factory = undefined;
  vi.clearAllMocks();
});

describe("createEntityCollectionOptions", () => {
  it("reports swallowed stream failures to the RPC connection manager", async () => {
    const socketError = new Error("SocketCloseError: 1006");
    let ready = false;

    const options = createEntityCollectionOptions<{ id: string }, string>({
      getKey: (item) => item.id,
      list: () => Effect.succeed([]),
      subscribe: () => Stream.fail(socketError),
      formatError: (error) => (error instanceof Error ? error : new Error(String(error))),
    });

    options.sync.sync({
      begin: vi.fn(),
      collection: {
        _state: {
          syncedData: new Map(),
        },
      },
      commit: vi.fn(),
      markReady: () => {
        ready = true;
      },
      truncate: vi.fn(),
      write: vi.fn(),
    } as unknown as Parameters<SyncConfig<{ id: string }, string>["sync"]>[0]);

    expect(rpcConnectionManagerMock.state.factory).toBeDefined();

    await Effect.runPromise(
      rpcConnectionManagerMock.state.factory!(null).pipe(
        Effect.timeout("10 millis"),
        Effect.ignore,
      ),
    );

    expect(reportRpcConnectionFailure).toHaveBeenCalledWith(socketError);
    expect(options.utils.lastError).toBe(socketError);
    expect(ready).toBe(true);
  });
});
