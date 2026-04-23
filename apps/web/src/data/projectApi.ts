import {
  formatProjectError,
  type CreateProjectInput,
  type Project,
  type ProjectEntity,
  type UpdateProjectInput,
} from "@lensflare/contracts";
import { runRpc } from "./rpcConnectionManager";

/**
 * Promise-returning wrappers around the project RPC endpoints. These are
 * the only mutation/read entry points the UI should use for projects —
 * the live query feed is served separately by
 * `~/collections/projectsCollection`, which subscribes to the same RPC
 * client via the {@link createEntityCollectionOptions} helper.
 *
 * Every call is funneled through {@link runProjectRpc} so transport/server
 * errors get normalized to a plain {@link Error} via
 * {@link formatProjectError}.
 */
function toProjectError(error: unknown): Error {
  return new Error(formatProjectError(error));
}

async function runProjectRpc<A>(f: Parameters<typeof runRpc<A>>[0]): Promise<A> {
  try {
    return await runRpc(f);
  } catch (error) {
    throw toProjectError(error);
  }
}

export async function listProjectEntities(): Promise<Array<ProjectEntity>> {
  return [...(await runProjectRpc((client) => client.ListProjectEntities()))];
}

export async function listProjects(): Promise<Array<Project>> {
  return [...(await runProjectRpc((client) => client.ListProjects()))];
}

export async function getProject(projectId: string): Promise<Project> {
  return runProjectRpc((client) => client.GetProject({ projectId }));
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  return runProjectRpc((client) => client.CreateProject(input));
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  return runProjectRpc((client) => client.UpdateProject({ projectId, input }));
}

export async function deleteProject(projectId: string): Promise<void> {
  await runProjectRpc((client) => client.DeleteProject({ projectId }));
}
