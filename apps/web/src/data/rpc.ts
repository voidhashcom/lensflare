import { DatasetRpcGroup, ProjectRpcGroup } from "@lensflare/contracts";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";
import { resolveBackendWsUrl } from "./backendTarget";

/**
 * Transport-level plumbing shared by the project + dataset RPC wrappers
 * (`~/data/projectApi`, `~/data/datasetApi`) and the TanStack DB
 * collections in `~/collections/*`.
 *
 * The contract-level RPC groups ({@link ProjectRpcGroup}, {@link DatasetRpcGroup})
 * are deliberately split with no shared catalog primitives — the two
 * domains expose independent event streams, payloads, and typed errors.
 * On the wire, though, the server mounts them together at a single `/rpc`
 * WebSocket endpoint, so the client mirrors that: we merge the groups
 * purely for transport so every mutation and every subscription can share
 * one socket and one client identity.
 *
 * The runtime itself is owned by {@link ../data/rpcConnectionManager} —
 * this module exposes the {@link CatalogRpcClient} Context.Service, the
 * merged RPC group, and a `createRpcRuntime` factory that the manager
 * calls on each (re)connect.
 */

function resolveRpcUrl(): string {
  return resolveBackendWsUrl("/rpc");
}

export const CatalogRpcs = ProjectRpcGroup.merge(DatasetRpcGroup);

export type CatalogRpcClientShape = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof CatalogRpcs>,
  RpcClientError
>;

export class CatalogRpcClient extends Context.Service<CatalogRpcClient, CatalogRpcClientShape>()(
  "@lensflare/web/CatalogRpcClient",
) {}

const rpcSupportLayer = Layer.merge(
  RpcSerialization.layerJson,
  Socket.layerWebSocket(Effect.sync(resolveRpcUrl)).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  ),
);

const rpcClientLayer = Layer.effect(CatalogRpcClient)(RpcClient.make(CatalogRpcs)).pipe(
  Layer.provide(RpcClient.layerProtocolSocket()),
  Layer.provide(rpcSupportLayer),
);

export type RpcRuntime = ManagedRuntime.ManagedRuntime<CatalogRpcClient, never>;

export function createRpcRuntime(): RpcRuntime {
  return ManagedRuntime.make(rpcClientLayer, {
    memoMap: Layer.makeMemoMapUnsafe(),
  });
}
