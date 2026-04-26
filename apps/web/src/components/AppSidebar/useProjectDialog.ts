import { DEFAULT_PROJECT_ICON, type Project } from "@lensflare/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { recordProjectCreated } from "~/analytics";
import { createProject, updateProject } from "~/data/projectApi";

export interface UseProjectDialogResult {
  open: boolean;
  mode: "create" | "edit";
  name: string;
  error: string | null;
  submitting: boolean;
  openCreate(): void;
  openEdit(project: Project): void;
  onOpenChange(open: boolean): void;
  onNameChange(value: string): void;
  onSubmit(event: React.FormEvent<HTMLFormElement>): void;
}

interface ProjectDialogState {
  open: boolean;
  mode: "create" | "edit";
  projectId: string | null;
  name: string;
  error: string | null;
  submitting: boolean;
}

const initialState: ProjectDialogState = {
  error: null,
  mode: "create",
  name: "",
  open: false,
  projectId: null,
  submitting: false,
};

/**
 * Encapsulates the create/edit project dialog's state and submission flow.
 * On successful create, navigates to the newly created project so the user
 * lands on it immediately.
 */
export function useProjectDialog(projectCount: number): UseProjectDialogResult {
  const navigate = useNavigate();
  const [state, setState] = React.useState<ProjectDialogState>(initialState);

  const openCreate = React.useCallback(() => {
    setState({ ...initialState, open: true });
  }, []);

  const openEdit = React.useCallback((project: Project) => {
    setState({
      error: null,
      mode: "edit",
      name: project.name,
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
        setState((current) => ({ ...current, error: "Project name is required." }));
        return;
      }

      setState((current) => ({ ...current, error: null, submitting: true }));

      try {
        if (state.mode === "edit" && state.projectId) {
          await updateProject(state.projectId, {
            icon: DEFAULT_PROJECT_ICON,
            name: trimmedName,
          });
        } else {
          const project = await createProject({
            icon: DEFAULT_PROJECT_ICON,
            name: trimmedName,
          });
          recordProjectCreated(projectCount + 1);
          await navigate({
            params: { projectId: project.id },
            to: "/projects/$projectId",
          });
        }

        setState(initialState);
      } catch (submitError) {
        setState((current) => ({
          ...current,
          error: submitError instanceof Error ? submitError.message : "Failed to save project.",
          submitting: false,
        }));
      }
    },
    [navigate, projectCount, state.mode, state.name, state.projectId],
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
