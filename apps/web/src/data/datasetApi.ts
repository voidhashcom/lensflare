import {
  formatDatasetError,
  type CreateDatasetInput,
  type Dataset,
  type DatasetStorageStats,
  type UpdateDatasetInput,
} from "@lensflare/contracts";
import { runRpc } from "./rpcConnectionManager";

/**
 * Promise-returning wrappers around the dataset RPC endpoints. These are
 * the only mutation/read entry points the UI should use for datasets —
 * the live query feed is served separately by
 * `~/collections/datasetsCollection`, which subscribes to the same RPC
 * client via the {@link createEntityCollectionOptions} helper.
 *
 * Every call is funneled through {@link runDatasetRpc} so transport/server
 * errors get normalized to a plain {@link Error} via
 * {@link formatDatasetError}.
 */
function toDatasetError(error: unknown): Error {
  return new Error(formatDatasetError(error));
}

async function runDatasetRpc<A>(f: Parameters<typeof runRpc<A>>[0]): Promise<A> {
  try {
    return await runRpc(f);
  } catch (error) {
    throw toDatasetError(error);
  }
}

export async function listDatasets(): Promise<Array<Dataset>> {
  return [...(await runDatasetRpc((client) => client.ListDatasets()))];
}

export async function getDataset(projectId: string, datasetId: string): Promise<Dataset> {
  return runDatasetRpc((client) => client.GetDataset({ projectId, datasetId }));
}

export async function createDataset(
  _projectId: string,
  _input: CreateDatasetInput,
): Promise<never> {
  throw new Error("Datasets are managed automatically per project.");
}

export async function updateDataset(
  _projectId: string,
  _datasetId: string,
  _input: UpdateDatasetInput,
): Promise<never> {
  throw new Error("Datasets are managed automatically per project.");
}

export async function deleteDataset(_projectId: string, _datasetId: string): Promise<never> {
  throw new Error("Datasets are managed automatically per project.");
}

export async function listDatasetStorageStats(): Promise<Array<DatasetStorageStats>> {
  return [...(await runDatasetRpc((client) => client.ListDatasetStorageStats()))];
}

export async function clearDatasetData(projectId: string, datasetId: string): Promise<void> {
  await runDatasetRpc((client) => client.ClearDatasetData({ projectId, datasetId }));
}
