import type { FilterNode } from "@lensflare/contracts";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  CogIcon,
  LayersIcon,
  ListIcon,
  TelescopeIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

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
import { Menu, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import {
  createLogFilterPreset,
  deleteLogFilterPreset,
  type LogFilterPreset,
  updateLogFilterPreset,
  useLogFilterPresets,
} from "./logFilterPresets";
import { setDatasetStreamFilter } from "./logStreamStore";

interface LogPresetDropdownProps {
  readonly projectId: string;
  readonly datasetId: string;
  readonly filterSource: string;
  readonly filter: FilterNode | null;
}

export function LogPresetDropdown({
  projectId,
  datasetId,
  filterSource,
  filter,
}: LogPresetDropdownProps) {
  const presets = useLogFilterPresets(projectId, datasetId);
  const [open, setOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<LogFilterPreset | null>(null);
  const [editingName, setEditingName] = useState("");
  const hasActiveFilter = filterSource.trim().length > 0 || filter !== null;
  const activePreset = presets.find((preset) => presetMatchesFilter(preset, filterSource, filter));
  const triggerLabel = activePreset?.name ?? "Presets";
  const TriggerIcon = iconForPreset(activePreset);

  const applyPreset = (preset: LogFilterPreset) => {
    setDatasetStreamFilter({
      projectId,
      datasetId,
      source: preset.source,
      filter: preset.filter,
    });
    setOpen(false);
  };

  const openSaveDialog = () => {
    if (!hasActiveFilter) return;
    setOpen(false);
    setSaveName("");
    setSaveDialogOpen(true);
  };

  const createPreset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = saveName.trim();
    if (name.length === 0 || !hasActiveFilter) return;

    createLogFilterPreset(projectId, datasetId, {
      name,
      source: filterSource,
      filter,
    });
    setSaveDialogOpen(false);
    setSaveName("");
  };

  const openEditDialog = (preset: LogFilterPreset) => {
    if (preset.readonly) return;
    setOpen(false);
    setEditingPreset(preset);
    setEditingName(preset.name);
    setEditDialogOpen(true);
  };

  const saveEditedPreset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const preset = editingPreset;
    const name = editingName.trim();
    if (preset === null || preset.readonly || name.length === 0) return;

    updateLogFilterPreset(projectId, datasetId, preset.id, { name });
    setEditDialogOpen(false);
    setEditingPreset(null);
    setEditingName("");
  };

  const snapshotCurrentFilter = () => {
    if (editingPreset === null || editingPreset.readonly || !hasActiveFilter) return;
    updateLogFilterPreset(projectId, datasetId, editingPreset.id, {
      source: filterSource,
      filter,
    });
  };

  const deletePreset = () => {
    if (editingPreset === null || editingPreset.readonly) return;
    deleteLogFilterPreset(projectId, datasetId, editingPreset.id);
    setEditDialogOpen(false);
    setEditingPreset(null);
    setEditingName("");
  };

  return (
    <>
      <Menu onOpenChange={setOpen} open={open}>
        <MenuTrigger
          render={
            <Button
              aria-label="Open filter presets"
              className="h-8 gap-1.5 rounded-md bg-background/60 px-2.5 shadow-xs/5 hover:bg-accent/50 sm:h-8"
              size="sm"
              variant="outline"
            >
              <TriggerIcon className="size-3.5 text-muted-foreground/80" />
              <span className="max-w-28 truncate text-xs">{triggerLabel}</span>
              <ChevronDownIcon className="size-3 text-muted-foreground/60" />
            </Button>
          }
        />
        <MenuPopup align="start" className="w-52" sideOffset={6}>
          {presets.map((preset) => (
            <PresetApplyRow
              key={preset.id}
              onApply={() => applyPreset(preset)}
              onEdit={() => openEditDialog(preset)}
              preset={preset}
            />
          ))}
          <MenuSeparator />
          <button
            className={cn(
              "flex min-h-7 w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm outline-none",
              "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
              !hasActiveFilter && "cursor-not-allowed opacity-50 hover:bg-transparent",
            )}
            disabled={!hasActiveFilter}
            onClick={openSaveDialog}
            type="button"
          >
            <PlusIcon className="size-4 shrink-0 text-muted-foreground/80" />
            <span className="min-w-0 truncate">Save preset</span>
          </button>
        </MenuPopup>
      </Menu>

      <Dialog onOpenChange={setSaveDialogOpen} open={saveDialogOpen}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save Preset</DialogTitle>
            <DialogDescription>Save the current filter as a reusable preset.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form className="space-y-4" id="save-log-filter-preset-form" onSubmit={createPreset}>
              <div className="space-y-1.5">
                <Label htmlFor="save-log-filter-preset-name">Name</Label>
                <Input
                  autoFocus
                  id="save-log-filter-preset-name"
                  onChange={(event) => setSaveName(event.target.value)}
                  value={saveName}
                />
              </div>
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button onClick={() => setSaveDialogOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={saveName.trim().length === 0 || !hasActiveFilter}
              form="save-log-filter-preset-form"
              type="submit"
            >
              Save Preset
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        onOpenChange={(nextOpen) => {
          setEditDialogOpen(nextOpen);
          if (!nextOpen) {
            setEditingPreset(null);
            setEditingName("");
          }
        }}
        open={editDialogOpen}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Preset</DialogTitle>
            <DialogDescription>
              Rename the preset or replace it with the current filter.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form
              className="space-y-4"
              id="edit-log-filter-preset-form"
              onSubmit={saveEditedPreset}
            >
              <div className="space-y-1.5">
                <Label htmlFor="edit-log-filter-preset-name">Name</Label>
                <Input
                  autoFocus
                  id="edit-log-filter-preset-name"
                  onChange={(event) => setEditingName(event.target.value)}
                  value={editingName}
                />
              </div>
              <Button
                className="w-full justify-start"
                disabled={!hasActiveFilter}
                onClick={snapshotCurrentFilter}
                type="button"
                variant="outline"
              >
                <RefreshCwIcon />
                Update from current filter
              </Button>
            </form>
          </DialogPanel>
          <DialogFooter className="sm:justify-between">
            <Button onClick={deletePreset} variant="destructive-outline">
              <Trash2Icon />
              Delete
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={() => setEditDialogOpen(false)} variant="outline">
                Cancel
              </Button>
              <Button
                disabled={editingName.trim().length === 0}
                form="edit-log-filter-preset-form"
                type="submit"
              >
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function presetMatchesFilter(
  preset: LogFilterPreset,
  filterSource: string,
  filter: FilterNode | null,
): boolean {
  if (preset.source !== filterSource) {
    return false;
  }

  return JSON.stringify(preset.filter) === JSON.stringify(filter);
}

interface PresetApplyRowProps {
  readonly preset: LogFilterPreset;
  readonly onApply: () => void;
  readonly onEdit: () => void;
}

function PresetApplyRow({ preset, onApply, onEdit }: PresetApplyRowProps) {
  const PresetIcon = iconForPreset(preset);

  return (
    <div className="group/preset relative">
      <button
        className={cn(
          "flex min-h-7 w-full items-center gap-2 rounded-sm px-2 py-1 pr-8 text-left text-sm outline-none",
          "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
        )}
        onClick={onApply}
        type="button"
      >
        <PresetIcon className="size-4 shrink-0 text-muted-foreground/80" />
        <span className="min-w-0 truncate">{preset.name}</span>
      </button>
      {!preset.readonly ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={`Edit ${preset.name} preset`}
                className="absolute right-1 top-1/2 size-6 -translate-y-1/2 rounded-sm opacity-0 group-hover/preset:opacity-100 focus-visible:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit();
                }}
                size="icon-xs"
                variant="ghost"
              >
                <CogIcon />
              </Button>
            }
          />
          <TooltipPopup side="right">Edit preset</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}

function iconForPreset(preset: LogFilterPreset | undefined): LucideIcon {
  switch (preset?.icon) {
    case "logs":
      return ListIcon;
    case "traces":
      return TelescopeIcon;
    case "errorSpans":
      return AlertCircleIcon;
    default:
      return LayersIcon;
  }
}
