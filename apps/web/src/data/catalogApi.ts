import {
  CatalogRpcGroup,
  formatCatalogError,
  type CreateDatasetInput,
  type CreateProjectInput,
  type Dataset,
  type Project,
  type UpdateDatasetInput,
  type UpdateProjectInput,
} from "@lensflare/contracts";
import { resolveWebSocketOrigin } from "@lensflare/shared";
import { createCollection } from "@tanstack/db";
import { QueryClient } from "@tanstack/query-core";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

function resolveCatalogRpcUrl(): string {
  const url = new URL("/rpc", window.location.href);
  url.href = resolveWebSocketOrigin(url.href);
  return url.toString();
}

type CatalogRpcServiceShape = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof CatalogRpcGroup>,
  RpcClientError
>;

class CatalogRpcClient extends Context.Service<CatalogRpcClient, CatalogRpcServiceShape>()(
  "@lensflare/web/CatalogRpcClient",
) {}

const rpcSupportLayer = Layer.merge(
  RpcSerialization.layerJson,
  Socket.layerWebSocket(Effect.sync(resolveCatalogRpcUrl)).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  ),
);

const rpcClientLayer = Layer.effect(CatalogRpcClient)(RpcClient.make(CatalogRpcGroup)).pipe(
  Layer.provide(RpcClient.layerProtocolSocket()),
  Layer.provide(rpcSupportLayer),
);

const rpcRuntime = ManagedRuntime.make(rpcClientLayer, {
  memoMap: Layer.makeMemoMapUnsafe(),
});

async function runCatalogRpc<A>(
  f: (client: CatalogRpcServiceShape) => Effect.Effect<A, unknown>,
): Promise<A> {
  try {
    return await rpcRuntime.runPromise(Effect.flatMap(CatalogRpcClient.asEffect(), f));
  } catch (error) {
    throw new Error(formatCatalogError(error));
  }
}

const queryClient = new QueryClient();

export const projectsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["catalog", "projects"],
    queryFn: async () => [...(await listProjects())],
    queryClient,
    getKey: (project: Project) => project.id,
  }),
);

export async function refetchProjects(): Promise<void> {
  await projectsCollection.utils.refetch({ throwOnError: true });
}

export async function listProjects(): Promise<Array<Project>> {
  return [...(await runCatalogRpc((client) => client.ListProjects()))];
}

export async function getProject(projectId: string): Promise<Project> {
  return runCatalogRpc((client) => client.GetProject({ projectId }));
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const project = await runCatalogRpc((client) => client.CreateProject(input));
  await refetchProjects();
  return project;
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const project = await runCatalogRpc((client) => client.UpdateProject({ projectId, input }));
  await refetchProjects();
  return project;
}

export async function deleteProject(projectId: string): Promise<void> {
  await runCatalogRpc((client) => client.DeleteProject({ projectId }));
  await refetchProjects();
}

export async function getDataset(projectId: string, datasetId: string): Promise<Dataset> {
  return runCatalogRpc((client) => client.GetDataset({ projectId, datasetId }));
}

export async function createDataset(
  projectId: string,
  input: CreateDatasetInput,
): Promise<Dataset> {
  const dataset = await runCatalogRpc((client) => client.CreateDataset({ projectId, input }));
  await refetchProjects();
  return dataset;
}

export async function updateDataset(
  projectId: string,
  datasetId: string,
  input: UpdateDatasetInput,
): Promise<Dataset> {
  const dataset = await runCatalogRpc((client) =>
    client.UpdateDataset({ projectId, datasetId, input })
  );
  await refetchProjects();
  return dataset;
}

export async function deleteDataset(projectId: string, datasetId: string): Promise<void> {
  await runCatalogRpc((client) => client.DeleteDataset({ projectId, datasetId }));
  await refetchProjects();
}
