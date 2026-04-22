import { useId } from "react";
import type * as React from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export interface DatasetDialogProps {
  open: boolean;
  mode: "create" | "edit";
  name: string;
  error: string | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onNameChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

/** Create or edit a dataset. Fully controlled by the parent orchestrator. */
export component DatasetDialog({
  open,
  mode,
  name,
  error,
  submitting,
  onOpenChange,
  onNameChange,
  onSubmit,
}: DatasetDialogProps) {
  const formId = useId();
  const isEditing = mode === "edit";
  const title = isEditing ? "Edit Dataset" : "New Dataset";
  const description = isEditing
    ? "Rename this dataset without leaving the current workspace."
    : "Add a dataset to the selected project.";
  const submitLabel = submitting
    ? "Saving..."
    : isEditing
      ? "Save Dataset"
      : "Create Dataset";

  <Dialog {onOpenChange} {open}>
    <DialogPopup class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <form class="space-y-4" id={formId} {onSubmit}>
          <div class="space-y-1.5">
            <Label htmlFor="dataset-name">{"Name"}</Label>
            <Input
              autoFocus
              disabled={submitting}
              id="dataset-name"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                onNameChange(event.target.value);
              }}
              value={name}
            />
          </div>

          if (error) {
            <p class="text-destructive text-sm">{error}</p>
          }
        </form>
      </DialogPanel>
      <DialogFooter>
        <Button
          disabled={submitting}
          onClick={() => onOpenChange(false)}
          variant="outline"
        >
          {"Cancel"}
        </Button>
        <Button disabled={submitting} form={formId} type="submit">
          {submitLabel}
        </Button>
      </DialogFooter>
    </DialogPopup>
  </Dialog>
}
