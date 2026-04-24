import type { SnippetLang } from "~/integrations/types";

/**
 * Languages preloaded when the Shiki bundle is fetched. Keeping this list
 * in sync with {@link SnippetLang} means we never have to call
 * `loadLanguage` lazily for snippets rendered from the integration
 * registry — a single `createHighlighter` call is enough.
 */
const HIGHLIGHTER_LANGS = [
  "bash",
  "ts",
  "tsx",
  "js",
  "python",
  "go",
  "json",
] as const satisfies ReadonlyArray<SnippetLang>;

/**
 * Theme ids for Shiki. We load both light + dark themes upfront and then
 * pick the right one per render based on the live colour-scheme; this
 * avoids a second round-trip to the WASM bundle when the user toggles
 * their OS theme.
 */
export const SHIKI_LIGHT_THEME = "github-light" as const;
export const SHIKI_DARK_THEME = "github-dark-dimmed" as const;

/**
 * Minimal subset of the Shiki highlighter we actually use. Typed narrowly
 * so this module can import `shiki` purely from the dynamic import below —
 * the rest of the codebase never touches the Shiki types directly.
 */
export interface CodeHighlighter {
  highlight(
    code: string,
    lang: SnippetLang,
    theme: typeof SHIKI_LIGHT_THEME | typeof SHIKI_DARK_THEME,
  ): string;
}

let highlighterPromise: Promise<CodeHighlighter> | null = null;

/**
 * Lazily fetch the Shiki bundle and memoise the resulting highlighter for
 * the lifetime of the page. The `shiki` module itself is intentionally
 * dynamic-imported so Vite splits it into its own async chunk — the Empty
 * Dataset guide is the only current consumer and we don't want its
 * ~1 MB bundle to hit the initial page load.
 */
export function loadHighlighter(): Promise<CodeHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import("shiki");
      const shiki = await createHighlighter({
        themes: [SHIKI_LIGHT_THEME, SHIKI_DARK_THEME],
        langs: [...HIGHLIGHTER_LANGS],
      });
      const highlighter: CodeHighlighter = {
        highlight: (code, lang, theme) =>
          shiki.codeToHtml(code, { lang, theme }),
      };
      return highlighter;
    })().catch((error) => {
      // Reset so callers can retry after a transient network blip rather
      // than being wedged with a rejected singleton promise forever.
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
}
