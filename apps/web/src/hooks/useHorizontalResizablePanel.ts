import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

type ResizeEdge = "left" | "right";

interface HorizontalResizablePanelOptions {
  defaultWidth: number;
  edge: ResizeEdge;
  maxWidth: number;
  minRemainingWidth?: number;
  minWidth: number;
  storageKey: string;
}

interface ResizeState {
  handle: HTMLButtonElement;
  pendingWidth: number;
  pointerId: number;
  rafId: number | null;
  startWidth: number;
  startX: number;
  width: number;
}

function readStoredWidth(storageKey: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredWidth(storageKey: string, width: number): void {
  if (typeof window === "undefined" || !Number.isFinite(width)) return;
  try {
    window.localStorage.setItem(storageKey, String(width));
  } catch {
    // Resize persistence is best-effort; blocked storage should not break drag.
  }
}

export function useHorizontalResizablePanel<TElement extends HTMLElement>({
  defaultWidth,
  edge,
  maxWidth,
  minRemainingWidth = 0,
  minWidth,
  storageKey,
}: HorizontalResizablePanelOptions) {
  const panelRef = useRef<TElement | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const [width, setWidth] = useState(defaultWidth);

  const clampWidth = useCallback(
    (nextWidth: number, panel: TElement | null = panelRef.current) => {
      const parentWidth = panel?.parentElement?.getBoundingClientRect().width;
      const parentMax =
        parentWidth === undefined ? maxWidth : Math.max(minWidth, parentWidth - minRemainingWidth);
      return Math.max(minWidth, Math.min(nextWidth, maxWidth, parentMax));
    },
    [maxWidth, minRemainingWidth, minWidth],
  );

  const finishResize = useCallback(
    (pointerId: number) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

      if (resizeState.rafId !== null) {
        window.cancelAnimationFrame(resizeState.rafId);
      }
      resizeState.width = resizeState.pendingWidth;
      setWidth(resizeState.width);
      writeStoredWidth(storageKey, resizeState.width);
      if (resizeState.handle.hasPointerCapture(pointerId)) {
        resizeState.handle.releasePointerCapture(pointerId);
      }
      resizeStateRef.current = null;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    },
    [storageKey],
  );

  const onResizePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const panel = panelRef.current;
      if (!panel) return;

      event.preventDefault();
      event.stopPropagation();

      const startWidth = clampWidth(panel.getBoundingClientRect().width, panel);
      resizeStateRef.current = {
        handle: event.currentTarget,
        pendingWidth: startWidth,
        pointerId: event.pointerId,
        rafId: null,
        startWidth,
        startX: event.clientX,
        width: startWidth,
      };
      setWidth(startWidth);
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [clampWidth],
  );

  const onResizePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;

      event.preventDefault();
      const delta =
        edge === "left" ? resizeState.startX - event.clientX : event.clientX - resizeState.startX;
      const nextWidth = clampWidth(resizeState.startWidth + delta);
      resizeState.pendingWidth = nextWidth;

      if (resizeState.rafId !== null) {
        window.cancelAnimationFrame(resizeState.rafId);
      }
      resizeState.rafId = window.requestAnimationFrame(() => {
        const activeResizeState = resizeStateRef.current;
        if (!activeResizeState) return;
        activeResizeState.rafId = null;
        activeResizeState.width = nextWidth;
        setWidth(nextWidth);
      });
    },
    [clampWidth, edge],
  );

  const onResizePointerUp = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;
      event.preventDefault();
      finishResize(event.pointerId);
    },
    [finishResize],
  );

  useEffect(() => {
    const storedWidth = readStoredWidth(storageKey);
    setWidth(clampWidth(storedWidth ?? defaultWidth));
  }, [clampWidth, defaultWidth, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleWindowResize = () => {
      setWidth((currentWidth) => clampWidth(currentWidth));
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [clampWidth]);

  useEffect(() => {
    return () => {
      const resizeState = resizeStateRef.current;
      if (resizeState?.rafId !== null && resizeState?.rafId !== undefined) {
        window.cancelAnimationFrame(resizeState.rafId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  return {
    panelRef,
    resizeHandleProps: {
      onPointerCancel: onResizePointerUp,
      onPointerDown: onResizePointerDown,
      onPointerMove: onResizePointerMove,
      onPointerUp: onResizePointerUp,
    },
    width,
  };
}
