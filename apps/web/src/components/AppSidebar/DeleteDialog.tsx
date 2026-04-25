import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

import type { DeleteTarget } from "./types";

export interface DeleteDialogProps {
  open: boolean;
  target: DeleteTarget | null;
  error: string | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/**
 * Confirmation dialog for destructive deletes. The surrounding orchestrator
 * owns the lifecycle (target, submitting, errors) and passes this component
 * pure view data; it only needs to call back on confirm/close.
 */
export function DeleteDialog({
  open,
  target,
  error,
  submitting,
  onOpenChange,
  onConfirm,
}: DeleteDialogProps) {
  const title = "Delete Project";
  const description = target
    ? `This will permanently delete "${target.name}".`
    : "This will permanently delete the selected item.";
  const confirmLabel = submitting ? "Deleting..." : "Delete";

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {error ? <p className="px-6 text-destructive text-sm">{error}</p> : null}

        <AlertDialogFooter>
          <AlertDialogClose disabled={submitting} render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button disabled={submitting} onClick={onConfirm} variant="destructive">
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
