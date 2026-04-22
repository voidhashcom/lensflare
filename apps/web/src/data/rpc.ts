import { DatasetRpcGroup, ProjectRpcGroup } from "@lensflare/contracts";
import { resolveWebSocketOrigin } from "@lensflare/shared";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

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
 */

function resolveRpcUrl(): string {
  const url = new URL("/rpc", window.location.href);
  url.href = resolveWebSocketOrigin(url.href);
  return url.toString();
}

const CatalogRpcs = ProjectRpcGroup.merge(DatasetRpcGroup);

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

export const rpcRuntime = ManagedRuntime.make(rpcClientLayer, {
  memoMap: Layer.makeMemoMapUnsafe(),
});

/**
 * Run an effect against the shared RPC client and surface the result as a
 * Promise. The caller is expected to wrap the rejection with its own
 * domain-specific error formatter (e.g. {@link formatProjectError}).
 */
export async function runRpc<A>(
  f: (client: CatalogRpcClientShape) => Effect.Effect<A, unknown>,
): Promise<A> {
  return rpcRuntime.runPromise(Effect.flatMap(CatalogRpcClient.asEffect(), f));
}
