import type { Dataset, Project } from "@lensflare/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { createDataset, updateDataset } from "~/data/datasetApi";

export interface UseDatasetDialogResult {
  open: boolean;
  mode: "create" | "edit";
  name: string;
  error: string | null;
  submitting: boolean;
  openCreate(project: Project): void;
  openEdit(project: Project, dataset: Dataset): void;
  onOpenChange(open: boolean): void;
  onNameChange(value: string): void;
  onSubmit(event: React.FormEvent<HTMLFormElement>): void;
}

interface DatasetDialogState {
  open: boolean;
  mode: "create" | "edit";
  projectId: string | null;
  datasetId: string | null;
  name: string;
  error: string | null;
  submitting: boolean;
}

const initialState: DatasetDialogState = {
  datasetId: null,
  error: null,
  mode: "create",
  name: "",
  open: false,
  projectId: null,
  submitting: false,
};

/**
 * Encapsulates the create/edit dataset dialog's state and submission flow.
 * On successful create, navigates to the newly created dataset's collection
 * view so the user lands on it immediately.
 */
export function useDatasetDialog(): UseDatasetDialogResult {
  const navigate = useNavigate();
  const [state, setState] = React.useState<DatasetDialogState>(initialState);

  const openCreate = React.useCallback((project: Project) => {
    setState({
      datasetId: null,
      error: null,
      mode: "create",
      name: "",
      open: true,
      projectId: project.id,
      submitting: false,
    });
  }, []);

  const openEdit = React.useCallback((project: Project, dataset: Dataset) => {
    setState({
      datasetId: dataset.id,
      error: null,
      mode: "edit",
      name: dataset.name,
      open: true,
      projectId: project.id,
      submitting: false,
    });
  }, []);

  const onOpenChange = React.useCallback((open: boolean) => {
    if (open) {
      return;
    }
    setState((current) => (current.submitting ? current : initialState));
  }, []);

  const onNameChange = React.useCallback((value: string) => {
    setState((current) => ({ ...current, name: value }));
  }, []);

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmedName = state.name.trim();
      if (trimmedName.length === 0) {
        setState((current) => ({ ...current, error: "Dataset name is required." }));
        return;
      }

      if (!state.projectId) {
        setState((current) => ({ ...current, error: "A project is required." }));
        return;
      }

      setState((current) => ({ ...current, error: null, submitting: true }));

      try {
        if (state.mode === "edit" && state.datasetId) {
          await updateDataset(state.projectId, state.datasetId, {
            name: trimmedName,
          });
        } else {
          const dataset = await createDataset(state.projectId, {
            name: trimmedName,
          });
          await navigate({
            params: {
              collectionId: dataset.id,
              projectId: state.projectId,
            },
            to: "/projects/$projectId/collections/$collectionId",
          });
        }

        setState(initialState);
      } catch (submitError) {
        setState((current) => ({
          ...current,
          error:
            submitError instanceof Error ? submitError.message : "Failed to save dataset.",
          submitting: false,
        }));
      }
    },
    [navigate, state.datasetId, state.mode, state.name, state.projectId],
  );

  return {
    error: state.error,
    mode: state.mode,
    name: state.name,
    onNameChange,
    onOpenChange,
    onSubmit,
    open: state.open,
    openCreate,
    openEdit,
    submitting: state.submitting,
  };
}
