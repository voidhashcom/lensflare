import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { renderTemplate } from "~/integrations/template";
import type { Snippet, TemplateVars } from "~/integrations/types";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/useTheme";

import { Button } from "../ui/button";
import {
  loadHighlighter,
  SHIKI_DARK_THEME,
  SHIKI_LIGHT_THEME,
} from "./shiki";

interface CodeBlockProps {
  snippet: Snippet;
  variables: TemplateVars;
  className?: string;
}

const COPY_FEEDBACK_MS = 1500;

/**
 * Render a single integration snippet with Shiki syntax highlighting and a
 * copy-to-clipboard button. The snippet's source is passed through
 * {@link renderTemplate} before both display and copy so the user always
 * copies exactly what they see (WYSIWYC).
 *
 * Shiki is loaded via dynamic `import("shiki")` so its ~1 MB bundle sits
 * in its own async chunk. While the bundle is loading we render the plain
 * substituted source, which means the guide stays useful even before Shiki
 * finishes booting (and on the unlikely chance it fails to load).
 */
export function CodeBlock({ snippet, variables, className }: CodeBlockProps) {
  const { resolvedTheme } = useTheme();
  const rendered = renderTemplate(snippet.code, variables);
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const theme = resolvedTheme === "dark" ? SHIKI_DARK_THEME : SHIKI_LIGHT_THEME;

    loadHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        try {
          setHtml(highlighter.highlight(rendered, snippet.lang, theme));
        } catch {
          // Highlighting a single snippet can fail (grammar throws on
          // malformed source, etc.) — keep the plain fallback rather than
          // crashing the whole guide. The raw `rendered` text still
          // renders below via the null-html branch.
          setHtml(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setHtml(null);
      });

    return () => {
      cancelled = true;
    };
  }, [rendered, snippet.lang, resolvedTheme]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(() => {
    // The copy always uses the freshly rendered text so slug renames
    // take effect immediately, even if the component hasn't re-rendered
    // (the `rendered` closure is captured at click time via the ref).
    void navigator.clipboard
      .writeText(rendered)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current !== null) {
          clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = setTimeout(() => {
          setCopied(false);
          copyTimerRef.current = null;
        }, COPY_FEEDBACK_MS);
      })
      .catch(() => {
        // Clipboard can reject if the document isn't focused (Firefox) or
        // the user denied permission. We silently ignore it — the snippet
        // is still selectable in the DOM so users can copy manually.
      });
  }, [rendered]);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted/40 not-dark:bg-clip-padding text-xs shadow-xs/5",
        className,
      )}
      data-slot="code-block"
    >
      {snippet.filename ? (
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/60 px-3 py-1.5 font-mono text-[10.5px] text-muted-foreground">
          <span className="truncate">{snippet.filename}</span>
          <span className="uppercase tracking-wide text-muted-foreground/70">
            {snippet.lang}
          </span>
        </div>
      ) : null}

      <div className="relative">
        {html !== null ? (
          <div
            // eslint-disable-next-line react/no-danger -- Shiki only emits
            // a fixed set of <pre>/<code>/<span> tags; the input `rendered`
            // is our own snippet text with slugs substituted in, not user
            // HTML, so this is safe from injection.
            dangerouslySetInnerHTML={{ __html: html }}
            className="[&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:overflow-x-auto [&_pre]:p-4 [&_pre]:text-[12px] [&_pre]:leading-relaxed"
          />
        ) : (
          <pre className="m-0 overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-foreground">
            <code>{rendered}</code>
          </pre>
        )}

        <Button
          aria-label={copied ? "Copied" : "Copy code"}
          className="absolute end-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[copied=true]:opacity-100"
          data-copied={copied}
          onClick={handleCopy}
          size="icon-xs"
          variant="outline"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}
