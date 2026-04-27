import { ArrowLeftIcon, ChevronDownIcon, ChevronRight, ChevronUpIcon } from "lucide-react";
import { useEffect, useMemo, type MouseEvent } from "react";

import { Button } from "~/components/ui/button";
import { IconButtonTooltip } from "~/components/ui/tooltip";

import { FieldsTab } from "./FieldsTab";
import {
  buildEventAttributeEntries,
  buildEventDetailEntries,
  type EventParentContext,
} from "./logDetailsFormat";
import type { SpanEventSummary } from "./types";

interface EventViewerProps {
  readonly events: ReadonlyArray<SpanEventSummary>;
  readonly selectedIndex: number;
  readonly onSelectIndex: (index: number) => void;
  readonly onClose: () => void;
  readonly parent: EventParentContext;
}

/**
 * Nested side-panel content for inspecting a single span event in
 * isolation. Replaces the parent's regular header + tabs while active so
 * the user only sees event-relevant chrome. Use `← Esc` or the back
 * button to return to the parent details, and `↑↓` (or the chevron
 * buttons) to step through siblings.
 *
 * Mounting / unmounting is driven by the parent panel: when
 * `selectedEventIndex !== null` the parent renders this; otherwise it
 * renders its normal content. That means the keyboard listener installed
 * here is automatically scoped to the time the viewer is on screen.
 */
export function EventViewer({
  events,
  selectedIndex,
  onSelectIndex,
  onClose,
  parent,
}: EventViewerProps) {
  // Clamp the index defensively — callers should pass a valid index but
  // bumping the parent span (and thus its event list) under us is easy
  // to do by accident.
  const safeIndex = Math.min(Math.max(selectedIndex, 0), events.length - 1);
  const event = events[safeIndex];
  const canGoPrev = safeIndex > 0;
  const canGoNext = safeIndex < events.length - 1;

  const goPrev = () => {
    if (canGoPrev) onSelectIndex(safeIndex - 1);
  };
  const goNext = () => {
    if (canGoNext) onSelectIndex(safeIndex + 1);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't hijack typing in inputs / textareas / contenteditable —
      // the filter input lives in the same window and we want it to
      // keep its own arrow-key behaviour.
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowUp" && canGoPrev) {
        e.preventDefault();
        onSelectIndex(safeIndex - 1);
        return;
      }
      if (e.key === "ArrowDown" && canGoNext) {
        e.preventDefault();
        onSelectIndex(safeIndex + 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [safeIndex, canGoPrev, canGoNext, onClose, onSelectIndex]);

  const entries = useMemo(
    () => (event ? buildEventDetailEntries(event, parent) : []),
    [event, parent],
  );
  const attributeEntries = useMemo(() => (event ? buildEventAttributeEntries(event) : []), [event]);

  if (!event) {
    // Defensive fallback: parent told us to view an event but the array
    // is now empty. Bounce back to the parent rather than render a
    // broken panel.
    return null;
  }

  return (
    <>
      <EventViewerHeader
        canGoNext={canGoNext}
        canGoPrev={canGoPrev}
        onClose={onClose}
        onNext={goNext}
        onPrev={goPrev}
        position={safeIndex + 1}
        total={events.length}
      />
      <FieldsTab attributeEntries={attributeEntries} entries={entries} showNullValues={false} />
    </>
  );
}

interface EventViewerHeaderProps {
  readonly position: number;
  readonly total: number;
  readonly canGoPrev: boolean;
  readonly canGoNext: boolean;
  readonly onClose: () => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
}

function EventViewerHeader({
  position,
  total,
  canGoPrev,
  canGoNext,
  onClose,
  onPrev,
  onNext,
}: EventViewerHeaderProps) {
  // Mirror `LogDetailsHeader` (height, border, padding) so the header
  // doesn't visually shift when the viewer takes over the panel.
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2">
      <IconButtonTooltip label="Back to span details">
        <Button
          aria-label="Back to span details"
          className="desktop-no-drag shrink-0"
          onMouseDown={onClose}
          size="icon"
          variant="ghost"
        >
          <ArrowLeftIcon className="size-3.5" />
        </Button>
      </IconButtonTooltip>
      <span className="font-mono text-muted-foreground/80 text-xs">Event</span>
      <span className="min-w-0 flex-1 font-mono text-foreground text-xs tabular-nums">
        {position}
        <span className="text-muted-foreground/50"> / </span>
        {total}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButtonTooltip label="Previous event">
          <Button
            aria-label="Previous event"
            className="desktop-no-drag shrink-0"
            disabled={!canGoPrev}
            onMouseDown={onPrev}
            size="icon"
            variant="ghost"
          >
            <ChevronUpIcon className="size-3.5" />
          </Button>
        </IconButtonTooltip>
        <IconButtonTooltip label="Next event">
          <Button
            aria-label="Next event"
            className="desktop-no-drag shrink-0"
            disabled={!canGoNext}
            onMouseDown={onNext}
            size="icon"
            variant="ghost"
          >
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </IconButtonTooltip>
      </div>
    </div>
  );
}

interface EventsButtonProps {
  readonly count: number;
  readonly onClick: () => void;
}

/**
 * Inline button rendered in the Fields-tab `events` row. Visually it's a
 * compact secondary chip showing "Events <N>" — clicking it hands off to
 * the parent panel which opens the {@link EventViewer}. We intentionally
 * stop the table-row hover / copy affordance from trying to copy the
 * underlying array (handled in `FieldsTab` via the `renderValue` escape
 * hatch).
 */
export function EventsButton({ count, onClick }: EventsButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // The events row sits inside a hover-styled `<tr>`; preventing
    // event bubbling here keeps a future "click row to expand" gesture
    // from also firing.
    event.stopPropagation();
    onClick();
  };
  return (
    <Button
      onMouseDown={handleClick}
      size="xs"
      className="hover:bg-accent/60! font-normal group &:hover>.events-chevron-icon:text-foreground"
      type="button"
      variant="secondary"
    >
      Events
      <span className="text-secondary-foreground/60 tabular-nums">{count}</span>
      <ChevronRight className="size-3.5 text-secondary-foreground/60" />
    </Button>
  );
}
