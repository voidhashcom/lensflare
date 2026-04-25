import { SettingsIcon, Trash2Icon } from "lucide-react";

import { Menu, MenuItem, MenuPopup } from "~/components/ui/menu";

import type { CursorAnchor, SidebarContextMenuTarget } from "./types";

export interface SidebarContextMenuProps {
  open: boolean;
  target: SidebarContextMenuTarget | null;
  anchor: CursorAnchor | null;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Right-click context menu for sidebar rows. The menu is positioned at the
 * cursor via a virtual anchor rather than being attached to the clicked element.
 */
export function SidebarContextMenu({
  open,
  target,
  anchor,
  onOpenChange,
  onEdit,
  onDelete,
}: SidebarContextMenuProps) {
  return (
    <Menu onOpenChange={onOpenChange} open={open}>
      {target && anchor ? (
        <MenuPopup
          align="start"
          anchor={() => anchor}
          className="w-48"
          side="bottom"
          sideOffset={6}
        >
          <MenuItem onClick={onEdit}>
            <SettingsIcon className="size-4" />
            Edit project
          </MenuItem>
          <MenuItem onClick={onDelete} variant="destructive">
            <Trash2Icon className="size-4" />
            Delete project
          </MenuItem>
        </MenuPopup>
      ) : null}
    </Menu>
  );
}
