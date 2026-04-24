import type { FilterNode } from "@lensflare/contracts";
import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import { SearchIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandPanel,
} from "~/components/ui/command";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import type { TelemetryLogField } from "~/data/logApi";
import { cn } from "~/lib/utils";

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
  type ParsedPill,
} from "./syntax";

const PlainTextDocument = Document.extend({
  content: "paragraph",
});

interface FilterPillDecorationOptions {
  getFields: () => ReadonlyArray<TelemetryLogField>;
}

const FilterPillDecorations = Extension.create<FilterPillDecorationOptions>({
  name: "filterPillDecorations",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const source = state.doc.textContent;
            const parsed = parseFilterInput(source, source.length);
            const fields = this.options.getFields();
            const decorations = parsed.pills.map((pill) => {
              const field = resolvePillField(pill, fields);
              const className = cn(
                "filter-query-pill",
                field === null && "filter-query-pill--unknown",
                field?.kind === "enum" && "filter-query-pill--enum",
                field?.kind === "number" && "filter-query-pill--number",
                field?.kind === "string" && "filter-query-pill--string",
              );
              return Decoration.inline(pill.start + 1, pill.end + 1, {
                class: className,
                "data-filter-kind": field?.kind ?? "unknown",
              });
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

interface FilterQueryInputProps {
  projectId: string;
  datasetId: string;
  fields: ReadonlyArray<TelemetryLogField>;
  appliedSource: string;
  /** Fires when the user commits the applied filter source. */
  onAppliedSourceChange: (source: string, filter: FilterNode | null) => void;
}

/**
 * Spotlight-style dataset filter. The header renders a compact trigger while
 * the modal owns a plain-text Tiptap editor. `source` remains the canonical
 * string so the existing parser, suggestion splicers, and filter AST emission
 * keep the same behavior as the old inline control.
 */
export function FilterQueryInput({
  projectId,
  datasetId,
  fields,
  appliedSource,
  onAppliedSourceChange,
}: FilterQueryInputProps) {
  const [draftSource, setDraftSource] = useState(appliedSource);
  const [cursor, setCursor] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState<number | null>(null);
  const [suggestionCount, setSuggestionCount] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fieldsRef = useRef(fields);
  const suggestionCountRef = useRef(0);
  const suppressNextCloseResetRef = useRef(false);
  const appliedSourceRef = useRef(appliedSource);
  const draftSourceRef = useRef(draftSource);
  const editorId = useId();
  const suggestionsId = useId();

  fieldsRef.current = fields;
  appliedSourceRef.current = appliedSource;
  draftSourceRef.current = draftSource;

  const appliedParsed = useMemo(
    () => parseFilterInput(appliedSource, appliedSource.length),
    [appliedSource],
  );
  const parsed = useMemo(() => parseFilterInput(draftSource, cursor), [cursor, draftSource]);
  const cursorContextKey = useMemo(
    () => cursorContextToKey(parsed.cursorContext),
    [parsed.cursorContext],
  );
  const editor = useEditor({
    extensions: [
      PlainTextDocument,
      Paragraph,
      Text,
      FilterPillDecorations.configure({
        getFields: () => fieldsRef.current,
      }),
    ],
    content: textToDoc(""),
    editorProps: {
      attributes: {
        "aria-controls": suggestionsId,
        "aria-label": "Filter telemetry",
        class:
          "min-h-8 max-h-24 overflow-y-auto outline-none whitespace-pre-wrap break-words px-0 py-1.5 text-sm leading-6",
        id: editorId,
        spellcheck: "false",
      },
      transformPastedText(text) {
        return text.replace(/\s+/g, " ");
      },
      handleKeyDown(_view, event) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelAndClose();
          return true;
        }

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const count = suggestionCountRef.current;
          if (count <= 0) return false;
          event.preventDefault();
          setHighlightedSuggestionIndex((index) => {
            if (index === null) {
              return event.key === "ArrowDown" ? 0 : count - 1;
            }

            const nextIndex = event.key === "ArrowDown" ? index + 1 : index - 1;
            return nextIndex < 0 || nextIndex >= count ? null : nextIndex;
          });
          return true;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          if (suggestionCountRef.current > 0) {
            const active = document
              .getElementById(suggestionsId)
              ?.querySelector<HTMLButtonElement>("[data-filter-suggestion-active='true']");
            if (active) {
              active.click();
              return true;
            }
          }
          applyAndClose();
          return true;
        }

        return false;
      },
    },
    immediatelyRender: false,
    onSelectionUpdate({ editor: nextEditor }) {
      setCursor(getEditorTextOffset(nextEditor));
    },
    onUpdate({ editor: nextEditor }) {
      const nextSource = nextEditor.getText({ blockSeparator: " " });
      setDraftSource(nextSource);
      setCursor(getEditorTextOffset(nextEditor));
    },
  }, [editorId, suggestionsId]);
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor ?? null;

  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta("filterPillDecorations", "fields"));
  }, [editor, fields]);

  useEffect(() => {
    suggestionCountRef.current = suggestionCount;
  }, [suggestionCount]);

  useEffect(() => {
    setHighlightedSuggestionIndex(null);
  }, [cursorContextKey]);

  const syncDraftFromApplied = useCallback(
    (nextCursor = appliedSourceRef.current.length) => {
      const nextAppliedSource = appliedSourceRef.current;
      const safeCursor = clampTextOffset(nextCursor, nextAppliedSource);
      setDraftSource(nextAppliedSource);
      setCursor(safeCursor);
      const currentEditor = editorRef.current;
      if (currentEditor) {
        currentEditor.commands.setContent(textToDoc(nextAppliedSource), { emitUpdate: false });
        currentEditor.commands.setTextSelection(safeCursor + 1);
      }
    },
    [],
  );

  useEffect(() => {
    if (isOpen) return;
    syncDraftFromApplied();
  }, [appliedSource, isOpen, syncDraftFromApplied]);

  const openEditor = useCallback(() => {
    syncDraftFromApplied();
    setIsOpen(true);
  }, [syncDraftFromApplied]);

  const cancelAndClose = useCallback(() => {
    suppressNextCloseResetRef.current = true;
    syncDraftFromApplied();
    setIsOpen(false);
  }, [syncDraftFromApplied]);

  const applyAndClose = useCallback(() => {
    const nextAppliedSource =
      editorRef.current?.getText({ blockSeparator: " " }) ?? draftSourceRef.current;
    const nextAppliedParsed = parseFilterInput(nextAppliedSource, nextAppliedSource.length);
    const nextAppliedFilter = parsedToFilter(nextAppliedParsed, fieldsRef.current);
    suppressNextCloseResetRef.current = true;
    setDraftSource(nextAppliedSource);
    setCursor(clampTextOffset(nextAppliedSource.length, nextAppliedSource));
    onAppliedSourceChange(nextAppliedSource, nextAppliedFilter);
    setIsOpen(false);
  }, [onAppliedSourceChange]);

  const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      openEditor();
      return;
    }
    if (suppressNextCloseResetRef.current) {
      suppressNextCloseResetRef.current = false;
      return;
    }
    cancelAndClose();
  }, [cancelAndClose, openEditor]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key.toLowerCase() !== "k") return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;

      event.preventDefault();
      event.stopPropagation();
      if (isOpen) {
        cancelAndClose();
        return;
      }
      openEditor();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelAndClose, isOpen, openEditor]);

  useEffect(() => {
    if (!isOpen || !editor) return;
    const frame = window.requestAnimationFrame(() => {
      editor.commands.focus(Math.min(cursor + 1, editor.state.doc.content.size));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor, isOpen]);

  const updateDraftSource = useCallback(
    (nextSource: string, nextCursor: number) => {
      const safeCursor = clampTextOffset(nextCursor, nextSource);
      setDraftSource(nextSource);
      setCursor(safeCursor);
      if (editor) {
        editor.commands.setContent(textToDoc(nextSource), { emitUpdate: false });
        editor.commands.setTextSelection(safeCursor + 1);
        editor.commands.focus();
      }
    },
    [editor],
  );

  const handleClearDraft = useCallback(() => {
    updateDraftSource("", 0);
  }, [updateDraftSource]);

  const handleClearApplied = useCallback(() => {
    onAppliedSourceChange("", null);
    setDraftSource("");
    setCursor(0);
    if (editor) {
      editor.commands.setContent(textToDoc(""), { emitUpdate: false });
    }
  }, [editor, onAppliedSourceChange]);

  const handleRemovePill = useCallback(
    (index: number) => {
      const pill = parsed.pills[index];
      if (!pill) return;
      let removeEnd = pill.end;
      while (
        removeEnd < draftSource.length &&
        /\s/.test(draftSource[removeEnd] ?? "")
      ) {
        removeEnd += 1;
      }
      const nextSource =
        draftSource.slice(0, pill.start) + draftSource.slice(removeEnd);
      updateDraftSource(nextSource, pill.start);
    },
    [draftSource, parsed.pills, updateDraftSource],
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
        draftSource.slice(0, pill.start) + serialised + draftSource.slice(pill.end);
      const nextCursor = pill.start + serialised.length;
      updateDraftSource(nextSource, nextCursor);
    },
    [draftSource, parsed.pills, updateDraftSource],
  );

  const handleApplySuggestion = useCallback(
    (suggestion: FilterSuggestion) => {
      applySuggestion({
        suggestion,
        source: draftSource,
        parsed,
        commitSource: updateDraftSource,
      });
    },
    [draftSource, parsed, updateDraftSource],
  );

  const handleSuggestionCountChange = useCallback((count: number) => {
    setSuggestionCount(count);
    setHighlightedSuggestionIndex((index) =>
      count <= 0 || index === null ? null : Math.min(index, count - 1),
    );
  }, []);

  const hasDraftContent = parsed.pills.length > 0 || parsed.trailingText.length > 0;
  const hasAppliedContent =
    appliedParsed.pills.length > 0 || appliedParsed.trailingText.length > 0;
  const triggerLabel = hasAppliedContent ? appliedSource : "Filter telemetry";

  return (
    <CommandDialog onOpenChange={handleDialogOpenChange} open={isOpen}>
      <div className="relative min-w-0 flex-1">
        <button
          aria-label="Open telemetry filter"
          className={cn(
            "inline-flex h-8 min-w-0 w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-background/60 px-2.5 text-left text-sm text-foreground/80 shadow-xs/5 hover:bg-accent/50",
            hasAppliedContent ? "pr-9" : "pr-2.5",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/24",
          )}
          data-slot="filter-query-input"
          onClick={openEditor}
          ref={triggerRef}
          type="button"
        >
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/80" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              !hasAppliedContent && "text-muted-foreground/72",
            )}
          >
            {triggerLabel}
          </span>
          {!hasAppliedContent ? (
            <KbdGroup className="shrink-0 gap-0.5 max-sm:hidden">
              <Kbd className="h-4 min-w-4 px-1 text-[10px]">⌘</Kbd>
              <Kbd className="h-4 min-w-4 px-1 text-[10px]">K</Kbd>
            </KbdGroup>
          ) : null}
        </button>
        {hasAppliedContent ? (
          <button
            aria-label="Clear filters"
            className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground/80 hover:bg-accent/60 hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              handleClearApplied();
            }}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </div>

      <CommandDialogPopup
        aria-label="Dataset filter"
        className="max-h-[min(52rem,calc(100vh-2rem))] max-w-2xl overflow-hidden p-0"
        finalFocus={() => {
          triggerRef.current?.focus();
          return false;
        }}
      >
        <div className="shrink-0 border-b px-4 py-3">
          <div className="flex items-start gap-2">
            <SearchIcon className="mt-2 size-4 shrink-0 text-muted-foreground/80" />
            <div className="relative min-w-0 flex-1">
              {draftSource.length === 0 ? (
                <label
                  className="pointer-events-none absolute left-0 top-1.5 text-muted-foreground/72 text-sm leading-6"
                  htmlFor={editorId}
                >
                  Filter telemetry — try kind:span status:error
                </label>
              ) : null}
              <EditorContent
                className="min-w-0 [&_.ProseMirror_p]:m-0"
                editor={editor}
              />
            </div>
            {hasDraftContent ? (
              <button
                aria-label="Clear filters"
                className="mt-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/80 hover:bg-accent/60 hover:text-foreground"
                onClick={handleClearDraft}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              >
                <XIcon className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
        <CommandPanel className="min-h-0 flex-1 overflow-hidden rounded-none border-x-0 border-t-0 shadow-none [clip-path:none] before:hidden">
          <FilterSuggestionsPanel
            cursorContext={parsed.cursorContext}
            datasetId={datasetId}
            fields={fields}
            highlightedSuggestionIndex={highlightedSuggestionIndex}
            onApplySuggestion={handleApplySuggestion}
            onEditPill={handleEditPill}
            onRemovePill={handleRemovePill}
            onSuggestionCountChange={handleSuggestionCountChange}
            pills={parsed.pills}
            projectId={projectId}
            suggestionsId={suggestionsId}
          />
        </CommandPanel>
        <CommandFooter className="shrink-0 gap-3 max-sm:flex-col max-sm:items-start">
          <div className="flex items-center gap-3">
            <KbdGroup className="items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span className="text-muted-foreground/80">Navigate</span>
            </KbdGroup>
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Enter</Kbd>
              <span className="text-muted-foreground/80">Select / Apply</span>
            </KbdGroup>
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Esc</Kbd>
              <span className="text-muted-foreground/80">Cancel</span>
            </KbdGroup>
          </div>
        </CommandFooter>
      </CommandDialogPopup>
    </CommandDialog>
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

function textToDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: text.length > 0 ? [{ type: "text", text }] : [],
      },
    ],
  };
}

function getEditorTextOffset(editor: Editor): number {
  return clampTextOffset(editor.state.selection.from - 1, editor.getText({ blockSeparator: " " }));
}

function clampTextOffset(offset: number, text: string): number {
  return Math.max(0, Math.min(offset, text.length));
}

function cursorContextToKey(context: ReturnType<typeof parseFilterInput>["cursorContext"]): string {
  switch (context.kind) {
    case "field":
      return `field:${context.prefix}`;
    case "operator":
      return `operator:${context.fieldPath.join(".")}:${context.tokenPrefix}`;
    case "value":
      return `value:${context.fieldPath.join(".")}:${context.valuePrefix}`;
  }
}
