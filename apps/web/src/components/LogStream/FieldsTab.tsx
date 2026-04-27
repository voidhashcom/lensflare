import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { IconButtonTooltip } from "~/components/ui/tooltip";
import { copyTextToClipboard } from "~/lib/clipboard";
import { cn } from "~/lib/utils";

import { isNullLike, type LogDetailEntry, renderDetailValue } from "./logDetailsFormat";

interface FieldsTabProps {
  /** Canonical, ordered field/value pairs (kind, timestamp, span.id, …). */
  readonly entries: ReadonlyArray<LogDetailEntry>;
  /**
   * Free-form attribute pairs rendered under an `attributes` section header
   * after the canonical fields. Pass an empty array to omit the section.
   */
  readonly attributeEntries: ReadonlyArray<LogDetailEntry>;
  /**
   * When `false`, rows whose value is `null`, `undefined`, or `""` are
   * filtered out. Both panels default this to `false` to match the
   * convention used by the log-stream details panel; the trace explorer
   * does not currently expose a toggle for it.
   */
  readonly showNullValues: boolean;
}

/**
 * Shared "Fields" tab content used by both the log-stream details panel and
 * the trace explorer. The component takes already-built entries (rather
 * than a `TelemetryEntry` or `TraceSpan` directly) so each consumer can
 * project its own data shape into the table.
 */
export function FieldsTab({ entries, attributeEntries, showNullValues }: FieldsTabProps) {
  const visibleEntries = useMemo(
    () => (showNullValues ? entries : entries.filter((entry) => !isNullLike(entry.value))),
    [entries, showNullValues],
  );
  const visibleAttributeEntries = useMemo(
    () =>
      showNullValues
        ? attributeEntries
        : attributeEntries.filter((entry) => !isNullLike(entry.value)),
    [attributeEntries, showNullValues],
  );
  const hasContent = visibleEntries.length > 0 || visibleAttributeEntries.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-border/60 border-y bg-muted/30 text-[11px] text-muted-foreground/70 uppercase tracking-wide">
              <th className="w-[40%] px-4 py-2 text-left font-medium">Field</th>
              <th className="px-4 py-2 text-left font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {hasContent ? (
              <>
                {visibleEntries.map((entry) => (
                  // Prefix keys so a user-defined attribute that shares a
                  // name with a canonical field (e.g. `name`) can't collide
                  // with its sibling row.
                  <PropertyRow entry={entry} key={`std:${entry.field}`} />
                ))}
                {visibleAttributeEntries.length > 0 ? (
                  <>
                    <tr className="border-border/60 border-y bg-muted/30 text-[11px] text-muted-foreground/70 uppercase tracking-wide">
                      <td className="px-4 py-2 font-medium" colSpan={2}>
                        attributes
                      </td>
                    </tr>
                    {visibleAttributeEntries.map((entry) => (
                      <PropertyRow entry={entry} key={`attr:${entry.field}`} />
                    ))}
                  </>
                ) : null}
              </>
            ) : (
              <tr>
                <td className="px-4 py-6 text-center text-muted-foreground/60 text-xs" colSpan={2}>
                  No properties to display.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function PropertyRow({ entry }: { entry: LogDetailEntry }) {
  // Pre-compute the copy payload so we can suppress the button entirely
  // for null-like values — a copy button that would put `""` on the
  // clipboard isn't useful and just adds visual noise. We also skip the
  // copy affordance for entries with a custom `renderValue`: those rows
  // render an interactive control (e.g. the "Events" button) where
  // copying the underlying value isn't meaningful.
  const copyText = useMemo(
    () => (entry.renderValue !== undefined ? null : valueToCopyText(entry.value)),
    [entry.renderValue, entry.value],
  );
  return (
    <tr className="group border-border/40 border-b align-top last:border-b-0 hover:bg-foreground/[0.02]">
      <td className="w-[40%] break-all px-4 py-2.5 text-muted-foreground">{entry.field}</td>
      <td className="break-all px-4 py-2.5 leading-relaxed">
        <div className="flex items-start gap-2 font-mono">
          <div className="min-w-0 flex-1">
            {entry.renderValue !== undefined ? entry.renderValue : renderDetailValue(entry.value)}
          </div>
          {copyText !== null ? <CopyValueButton text={copyText} /> : null}
        </div>
      </td>
    </tr>
  );
}

const COPIED_FEEDBACK_MS = 1500;

/**
 * Tiny copy-to-clipboard button revealed on row hover (or keyboard focus).
 * Mirrors the `SpanDetailsHeader` copy affordance in `TraceExplorer.tsx`:
 * 1.5-second feedback window, swap the icon to a checkmark, then revert.
 */
function CopyValueButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  // Hold the timeout id in a ref so re-renders don't reset the feedback
  // window mid-flight, and so we can cancel it on unmount to avoid a
  // setState-after-unmount warning.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = () => {
    void copyTextToClipboard(text)
      .then((success) => {
        if (!success) return;
        setCopied(true);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, COPIED_FEEDBACK_MS);
      })
      .catch(() => {
        // Clipboard fallbacks already handled in `copyTextToClipboard` —
        // if both pathways failed we just leave the button silent rather
        // than surface an error toast for what is a best-effort utility.
      });
  };

  return (
    <IconButtonTooltip label={copied ? "Copied" : "Copy value"}>
      <button
        aria-label={copied ? "Copied" : "Copy value"}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-[color,background-color] hover:bg-foreground/[0.06] hover:text-foreground/90 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100",
          // Stay visible while the "Copied" feedback is on screen, even
          // if the cursor leaves the row — otherwise the checkmark
          // disappears the instant the user moves their mouse.
          copied && "text-success opacity-100",
        )}
        onClick={handleCopy}
        type="button"
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
    </IconButtonTooltip>
  );
}

/**
 * Serialises a field value to a clipboard-friendly string. Returns `null`
 * for null-like values so the caller can hide the button entirely. Objects
 * and arrays are pretty-printed with two-space indent so pasting into,
 * say, a Slack thread keeps the structure readable.
 */
function valueToCopyText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Fallback for exotic shapes (circular refs, BigInt nested in
    // objects, etc.) — better to drop the button than throw out of a
    // render.
    return null;
  }
}
