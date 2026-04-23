import type { FilterNode } from "@lensflare/contracts";
import { SearchIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import {
  Popover,
  PopoverPopup,
} from "~/components/ui/popover";
import type { TelemetryLogField } from "~/data/logApi";
import { cn } from "~/lib/utils";

import { FilterPillChip } from "./FilterPillChip";
import {
  FilterSuggestionsPanel,
  type FilterSuggestion,
  type PillMutation,
} from "./FilterSuggestionsPanel";
import {
  applyFieldSuggestion,
  applyOperatorSuggestion,
  applyValueSuggestion,
} from "./querySplicer";
import {
  parseFilterInput,
  parsedToFilter,
  resolvePillField,
  serialisePill,
  type OperatorSyntax,
  type ParsedPill,
} from "./syntax";

interface FilterQueryInputProps {
  projectId: string;
  datasetId: string;
  fields: ReadonlyArray<TelemetryLogField>;
  /** Fires with a committable `FilterNode` (or `null` when empty) whenever
   *  the pills/parser state changes. */
  onFilterChange: (filter: FilterNode | null) => void;
}

/**
 * Keyboard-first filter input. Owns `source` as its single source of truth
 * and renders parsed pills inline before a bare `<input>` holding the
 * trailing free text. The suggestions popover mirrors the parser's cursor
 * context — fields, operators, or values — and emits typed `FilterSuggestion`
 * accepts that this component splices back into `source`.
 *
 * Pitfalls handled:
 *   - IME composition: `Enter` / `Tab` / `Backspace` are ignored while
 *     `isComposing` is true so non-latin input methods compose cleanly.
 *   - Programmatic caret restoration: whenever we rewrite `source`
 *     (suggestion accept, pill edit, pill remove), the input's real caret
 *     is re-synced in a `useLayoutEffect` so keystrokes continue from the
 *     right position rather than jumping to the end.
 *   - Backspace-at-zero: with an empty trailing text, Backspace peels the
 *     last pill off `source` instead of being a no-op.
 */
export function FilterQueryInput({
  projectId,
  datasetId,
  fields,
  onFilterChange,
}: FilterQueryInputProps) {
  const [source, setSource] = useState("");
  const [cursor, setCursor] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverId = useId();

  // When `pendingCursorRef` is non-null, a layout effect below will
  // `setSelectionRange` the input to that absolute offset on the next
  // commit. Used for post-mutation caret restoration.
  const pendingCursorRef = useRef<number | null>(null);

  const parsed = useMemo(() => parseFilterInput(source, cursor), [source, cursor]);
  const filter = useMemo(
    () => parsedToFilter(parsed, fields),
    [parsed, fields],
  );

  // Dedup filter emissions via a stringified diff so the parent doesn't see
  // spurious re-notifications when parser output is shape-identical but
  // object-different (the parser allocates fresh nodes on every keystroke).
  // The sentinel starts at `"__unset__"` (not `"null"`) so the initial emit
  // goes through: `QueryBuilder` no longer accepts an `initialFilter`, which
  // means the parent must rely on this emission to learn the editor's state.
  const lastNotifiedRef = useRef<string>("__unset__");
  useEffect(() => {
    const key = filter === null ? "null" : JSON.stringify(filter);
    if (lastNotifiedRef.current === key) return;
    lastNotifiedRef.current = key;
    onFilterChange(filter);
  }, [filter, onFilterChange]);

  useLayoutEffect(() => {
    if (pendingCursorRef.current === null) return;
    const absolute = pendingCursorRef.current;
    const local = Math.max(
      0,
      Math.min(absolute - parsed.trailingStart, parsed.trailingText.length),
    );
    // Only reposition the caret when the outer input still owns focus.
    // If the mutation came from a nested surface (e.g. the row editor's
    // value input, or the pill's operator dropdown), stealing focus here
    // would yank the caret out of that surface mid-edit.
    if (document.activeElement === inputRef.current) {
      inputRef.current?.setSelectionRange(local, local);
    }
    pendingCursorRef.current = null;
    // `parsed` is derived from `source` (its trailingStart/length are pure
    // functions of the string), so re-triggering on every source change is
    // sufficient — no need to also list the derived fields as deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const commitSource = useCallback(
    (nextSource: string, nextCursor: number, { openPopover = true } = {}) => {
      pendingCursorRef.current = nextCursor;
      setSource(nextSource);
      setCursor(nextCursor);
      if (openPopover) setIsOpen(true);
    },
    [],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const tail = event.currentTarget.value;
      const nextSource = source.slice(0, parsed.trailingStart) + tail;
      const selection = event.currentTarget.selectionStart ?? nextSource.length;
      const nextCursor = parsed.trailingStart + selection;
      // Don't call setSelectionRange — the browser has already placed the
      // caret naturally for typed / pasted input.
      setSource(nextSource);
      setCursor(nextCursor);
      setIsOpen(true);
    },
    [parsed.trailingStart, source],
  );

  const handleInputSelect = useCallback(
    (event: React.SyntheticEvent<HTMLInputElement>) => {
      const target = event.currentTarget;
      const local = target.selectionStart ?? 0;
      setCursor(parsed.trailingStart + local);
    },
    [parsed.trailingStart],
  );

  const handleInputFocus = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (isComposing) return;

      if (event.key === "Escape") {
        setIsOpen(false);
        return;
      }

      if (event.key === "Backspace") {
        const selection = event.currentTarget.selectionStart ?? 0;
        const selectionEnd = event.currentTarget.selectionEnd ?? 0;
        const hasRange = selection !== selectionEnd;
        if (!hasRange && selection === 0 && parsed.pills.length > 0) {
          event.preventDefault();
          const lastPill = parsed.pills[parsed.pills.length - 1];
          if (!lastPill) return;
          // Drop the pill plus the whitespace right after it so there's no
          // leftover double-space in `source`.
          let removeEnd = lastPill.end;
          while (
            removeEnd < source.length &&
            /\s/.test(source[removeEnd] ?? "")
          ) {
            removeEnd += 1;
          }
          const nextSource =
            source.slice(0, lastPill.start) + source.slice(removeEnd);
          commitSource(nextSource, lastPill.start);
        }
      }
    },
    [commitSource, isComposing, parsed.pills, source],
  );

  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
  }, []);

  const handleClearAll = useCallback(() => {
    commitSource("", 0);
  }, [commitSource]);

  const handleRemovePill = useCallback(
    (index: number) => {
      const pill = parsed.pills[index];
      if (!pill) return;
      let removeEnd = pill.end;
      while (
        removeEnd < source.length &&
        /\s/.test(source[removeEnd] ?? "")
      ) {
        removeEnd += 1;
      }
      const nextSource =
        source.slice(0, pill.start) + source.slice(removeEnd);
      commitSource(nextSource, pill.start);
    },
    [commitSource, parsed.pills, source],
  );

  const handlePillOperatorChange = useCallback(
    (index: number, syntax: OperatorSyntax) => {
      const pill = parsed.pills[index];
      if (!pill) return;
      const nextPill: ParsedPill = {
        ...pill,
        operator: syntax.operator,
        operatorToken: syntax.token,
        negated: syntax.negated,
      };
      const serialised = serialisePill(nextPill);
      const nextSource =
        source.slice(0, pill.start) + serialised + source.slice(pill.end);
      const nextCursor = pill.start + serialised.length;
      commitSource(nextSource, nextCursor);
    },
    [commitSource, parsed.pills, source],
  );

  const handleEditPill = useCallback(
    (index: number, mutation: PillMutation) => {
      const pill = parsed.pills[index];
      if (!pill) return;
      const nextPill: ParsedPill = {
        fieldPath: mutation.fieldPath,
        operatorToken: mutation.operatorToken,
        operator: mutation.operator,
        negated: mutation.negated,
        rawValue: mutation.rawValue,
        valueWasQuoted: mutation.valueWasQuoted,
        start: pill.start,
        end: pill.end,
      };
      const serialised = serialisePill(nextPill);
      const nextSource =
        source.slice(0, pill.start) + serialised + source.slice(pill.end);
      const nextCursor = pill.start + serialised.length;
      commitSource(nextSource, nextCursor);
    },
    [commitSource, parsed.pills, source],
  );

  const handleApplySuggestion = useCallback(
    (suggestion: FilterSuggestion) => {
      applySuggestion({
        suggestion,
        source,
        parsed,
        commitSource,
      });
    },
    [commitSource, parsed, source],
  );

  const hasContent = parsed.pills.length > 0 || parsed.trailingText.length > 0;

  return (
    <div className="relative min-w-0 flex-1">
      <Popover modal={false} onOpenChange={setIsOpen} open={isOpen}>
        <div
          className={cn(
            "flex h-9 min-w-0 flex-1 items-center gap-1 rounded-md border border-input bg-background/60 px-2 text-sm shadow-xs/5 ring-ring/24 transition-shadow",
            "focus-within:border-ring focus-within:ring-[3px]",
          )}
          data-slot="filter-query-input"
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            // Clicking blank chrome should focus the input rather than
            // falling through to the page.
            if (event.target === event.currentTarget) {
              inputRef.current?.focus();
            }
          }}
          ref={containerRef}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-owns={popoverId}
        >
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/80" />
          {parsed.pills.map((pill, index) => (
            <FilterPillChip
              field={resolvePillField(pill, fields)}
              key={`${pill.start}-${pill.end}`}
              onChangeOperator={(syntax) => handlePillOperatorChange(index, syntax)}
              onRemove={() => handleRemovePill(index)}
              pill={pill}
            />
          ))}
          <input
            aria-autocomplete="list"
            aria-controls={popoverId}
            className="min-w-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/72"
            onChange={handleInputChange}
            onCompositionEnd={handleCompositionEnd}
            onCompositionStart={handleCompositionStart}
            onFocus={handleInputFocus}
            onKeyDown={handleKeyDown}
            onSelect={handleInputSelect}
            placeholder={hasContent ? "" : "Filter logs — try level:info"}
            ref={inputRef}
            type="text"
            value={parsed.trailingText}
          />
          {hasContent ? (
            <button
              aria-label="Clear filters"
              className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/80 hover:bg-accent/60 hover:text-foreground"
              onClick={handleClearAll}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
        <PopoverPopup
          align="start"
          anchor={containerRef}
          className="w-[min(100%,48rem)] max-w-[min(90vw,48rem)]"
          id={popoverId}
          side="bottom"
          sideOffset={6}
        >
          <FilterSuggestionsPanel
            cursorContext={parsed.cursorContext}
            datasetId={datasetId}
            fields={fields}
            onApplySuggestion={handleApplySuggestion}
            onEditPill={handleEditPill}
            onRemovePill={handleRemovePill}
            pills={parsed.pills}
            projectId={projectId}
          />
        </PopoverPopup>
      </Popover>
    </div>
  );
}

interface ApplySuggestionArgs {
  readonly suggestion: FilterSuggestion;
  readonly source: string;
  readonly parsed: ReturnType<typeof parseFilterInput>;
  readonly commitSource: (nextSource: string, nextCursor: number) => void;
}

/**
 * Dispatches a suggestion accept to the matching splice helper and commits
 * the resulting `{source, cursor}` tuple. All splicing rules live in
 * `./querySplicer` so they can be unit-tested without mounting the
 * component; this function just routes by `suggestion.kind`.
 */
function applySuggestion({
  suggestion,
  source,
  parsed,
  commitSource,
}: ApplySuggestionArgs): void {
  const ctx = {
    source,
    trailingStart: parsed.trailingStart,
    trailingText: parsed.trailingText,
  };

  switch (suggestion.kind) {
    case "field": {
      const result = applyFieldSuggestion(ctx, suggestion.field);
      commitSource(result.source, result.cursor);
      return;
    }
    case "operator": {
      const result = applyOperatorSuggestion(ctx, suggestion.syntax);
      if (result === null) return;
      commitSource(result.source, result.cursor);
      return;
    }
    case "value": {
      const result = applyValueSuggestion(ctx, suggestion.value);
      if (result === null) return;
      commitSource(result.source, result.cursor);
      return;
    }
  }
}
