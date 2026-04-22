import * as React from "react";

import type { CursorAnchor, SidebarContextMenuTarget } from "./types";

export interface UseSidebarContextMenuResult {
  open: boolean;
  target: SidebarContextMenuTarget | null;
  anchor: CursorAnchor | null;
  onOpenChange(open: boolean): void;
  handleRowContextMenu(
    event: React.MouseEvent<HTMLElement>,
    target: SidebarContextMenuTarget,
  ): void;
  close(): void;
}

interface ContextMenuState {
  open: boolean;
  target: SidebarContextMenuTarget | null;
  position: { x: number; y: number } | null;
}

const initialState: ContextMenuState = {
  open: false,
  position: null,
  target: null,
};

/**
 * Tracks the cursor-anchored sidebar context menu. The menu is positioned via
 * a virtual anchor whose bounding rect is derived from the right-click
 * coordinates, so Base UI's positioner can place the popup at the cursor
 * without us owning a DOM anchor element.
 */
export function useSidebarContextMenu(): UseSidebarContextMenuResult {
  const [state, setState] = React.useState<ContextMenuState>(initialState);

  const anchor = React.useMemo<CursorAnchor | null>(() => {
    const { position } = state;
    if (!position || typeof DOMRect === "undefined") {
      return null;
    }

    return {
      getBoundingClientRect: () => new DOMRect(position.x, position.y, 0, 0),
    };
  }, [state]);

  const handleRowContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLElement>, target: SidebarContextMenuTarget) => {
      event.preventDefault();
      setState({
        open: true,
        position: { x: event.clientX, y: event.clientY },
        target,
      });
    },
    [],
  );

  const close = React.useCallback(() => {
    setState(initialState);
  }, []);

  const onOpenChange = React.useCallback((open: boolean) => {
    if (open) {
      setState((current) => ({ ...current, open: true }));
      return;
    }
    setState(initialState);
  }, []);

  return {
    anchor,
    close,
    handleRowContextMenu,
    onOpenChange,
    open: state.open,
    target: state.target,
  };
}
