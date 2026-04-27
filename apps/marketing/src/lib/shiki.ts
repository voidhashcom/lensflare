import { createHighlighter } from "shiki";

const HIGHLIGHTER_LANGS = ["bash", "json"] as const;

export const SHIKI_LIGHT_THEME = "github-light" as const;

let highlighterPromise: Promise<Awaited<ReturnType<typeof createHighlighter>>> | null = null;

/**
 * Marketing is light-only, so we only preload the GitHub light theme used
 * by the web app's highlighted snippets.
 */
export function loadHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [SHIKI_LIGHT_THEME],
      langs: [...HIGHLIGHTER_LANGS],
    }).catch((error: unknown) => {
      highlighterPromise = null;
      throw error;
    });
  }

  return highlighterPromise;
}
