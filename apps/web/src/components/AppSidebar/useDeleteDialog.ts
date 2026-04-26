import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { recordProjectDeleted } from "~/analytics";
import { deleteProject } from "~/data/projectApi";

import type { DeleteTarget } from "./types";

export interface UseDeleteDialogResult {
  open: boolean;
  target: DeleteTarget | null;
  error: string | null;
  submitting: boolean;
  openFor(target: DeleteTarget): void;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

interface DeleteDialogState {
  target: DeleteTarget | null;
  error: string | null;
  submitting: boolean;
}

const initialState: DeleteDialogState = {
  error: null,
  submitting: false,
  target: null,
};

/**
 * Encapsulates the destructive delete confirmation dialog. If the deleted item
 * is the currently active route (project or dataset), navigates away so the
 * user isn't stranded on a stale URL pointing at nothing.
 */
export function useDeleteDialog(
  activeProjectId: string | undefined,
  projectCount: number,
): UseDeleteDialogResult {
  const navigate = useNavigate();
  const [state, setState] = React.useState<DeleteDialogState>(initialState);

  const openFor = React.useCallback((target: DeleteTarget) => {
    setState({ error: null, submitting: false, target });
  }, []);

  const onOpenChange = React.useCallback((open: boolean) => {
    if (open) {
      return;
    }
    setState((current) => (current.submitting ? current : initialState));
  }, []);

  const onConfirm = React.useCallback(async () => {
    const target = state.target;
    if (!target) {
      return;
    }

    setState((current) => ({ ...current, error: null, submitting: true }));

    try {
      await deleteProject(target.projectId);
      recordProjectDeleted(Math.max(0, projectCount - 1));
      if (activeProjectId === target.projectId) {
        await navigate({ to: "/" });
      }

      setState(initialState);
    } catch (deleteFailure) {
      setState((current) => ({
        ...current,
        error: deleteFailure instanceof Error ? deleteFailure.message : "Failed to delete item.",
        submitting: false,
      }));
    }
  }, [activeProjectId, navigate, projectCount, state.target]);

  return {
    error: state.error,
    onConfirm: () => {
      void onConfirm();
    },
    onOpenChange,
    open: state.target !== null,
    openFor,
    submitting: state.submitting,
    target: state.target,
  };
}
