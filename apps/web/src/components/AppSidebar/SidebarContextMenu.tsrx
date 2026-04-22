import { PlusIcon, SettingsIcon, Trash2Icon } from "lucide-react";

import { Menu, MenuItem, MenuPopup } from "~/components/ui/menu";

import type { CursorAnchor, SidebarContextMenuTarget } from "./types";

export interface SidebarContextMenuProps {
  open: boolean;
  target: SidebarContextMenuTarget | null;
  anchor: CursorAnchor | null;
  onOpenChange: (open: boolean) => void;
  onCreateDataset: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Right-click context menu for sidebar rows. The menu is positioned at the
 * cursor via a virtual anchor (a `getBoundingClientRect` stub pointing at the
 * click coordinates), rather than being attached to the clicked DOM element.
 */
export component SidebarContextMenu({
  open,
  target,
  anchor,
  onOpenChange,
  onCreateDataset,
  onEdit,
  onDelete,
}: SidebarContextMenuProps) {
  <Menu {onOpenChange} {open}>
    if (target && anchor) {
      <MenuPopup
        align="start"
        anchor={() => anchor}
        class="w-48"
        side="bottom"
        sideOffset={6}
      >
        if (target.kind === "project") {
          <MenuItem onClick={onCreateDataset}>
            <PlusIcon class="size-4" />
            {"New dataset"}
          </MenuItem>
          <MenuItem onClick={onEdit}>
            <SettingsIcon class="size-4" />
            {"Edit project"}
          </MenuItem>
          <MenuItem onClick={onDelete} variant="destructive">
            <Trash2Icon class="size-4" />
            {"Delete project"}
          </MenuItem>
        } else {
          <MenuItem onClick={onEdit}>
            <SettingsIcon class="size-4" />
            {"Edit dataset"}
          </MenuItem>
          <MenuItem onClick={onDelete} variant="destructive">
            <Trash2Icon class="size-4" />
            {"Delete dataset"}
          </MenuItem>
        }
      </MenuPopup>
    }
  </Menu>
}
