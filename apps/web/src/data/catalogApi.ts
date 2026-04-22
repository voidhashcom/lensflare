import type {
  CreateDatasetInput,
  CreateProjectInput,
  Dataset,
  Project,
  UpdateDatasetInput,
  UpdateProjectInput,
} from "@lensflare/contracts";

const CATALOG_CHANGED_EVENT = "lensflare:catalog-changed";

interface ApiErrorResponse {
  error?: {
    message?: string;
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const body = (await response.json()) as ApiErrorResponse;
      if (body.error?.message) {
        message = body.error.message;
      }
    } catch {
      // Ignore bodies that are not JSON.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function emitCatalogChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(CATALOG_CHANGED_EVENT));
}

export function subscribeToCatalogChanges(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(CATALOG_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener(CATALOG_CHANGED_EVENT, listener);
  };
}

export async function listProjects(): Promise<ReadonlyArray<Project>> {
  const body = await requestJson<{ projects: ReadonlyArray<Project> }>("/api/projects");
  return body.projects;
}

export async function getProject(projectId: string): Promise<Project> {
  const body = await requestJson<{ project: Project }>(`/api/projects/${projectId}`);
  return body.project;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const body = await requestJson<{ project: Project }>("/api/projects", {
    body: JSON.stringify(input),
    method: "POST",
  });
  return body.project;
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const body = await requestJson<{ project: Project }>(`/api/projects/${projectId}`, {
    body: JSON.stringify(input),
    method: "PATCH",
  });
  return body.project;
}

export async function deleteProject(projectId: string): Promise<void> {
  await requestJson<void>(`/api/projects/${projectId}`, {
    method: "DELETE",
  });
}

export async function getDataset(projectId: string, datasetId: string): Promise<Dataset> {
  const body = await requestJson<{ dataset: Dataset }>(
    `/api/projects/${projectId}/datasets/${datasetId}`,
  );
  return body.dataset;
}

export async function createDataset(
  projectId: string,
  input: CreateDatasetInput,
): Promise<Dataset> {
  const body = await requestJson<{ dataset: Dataset }>(
    `/api/projects/${projectId}/datasets`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
  );
  return body.dataset;
}

export async function updateDataset(
  projectId: string,
  datasetId: string,
  input: UpdateDatasetInput,
): Promise<Dataset> {
  const body = await requestJson<{ dataset: Dataset }>(
    `/api/projects/${projectId}/datasets/${datasetId}`,
    {
      body: JSON.stringify(input),
      method: "PATCH",
    },
  );
  return body.dataset;
}

export async function deleteDataset(projectId: string, datasetId: string): Promise<void> {
  await requestJson<void>(`/api/projects/${projectId}/datasets/${datasetId}`, {
    method: "DELETE",
  });
}
