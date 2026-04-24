import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "../lib/utils";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "lensflare:theme";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // ignore — fall back to system default
  }
  return "system";
}

function applyTheme(theme: Theme): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", isDark);
}

/**
 * Cycles between light → dark → system. The pre-hydration inline script in
 * `BaseLayout.astro` has already applied the correct class before this island
 * hydrates, so first render is a no-op from the user's perspective.
 */
export function ThemeToggle(): ReactNode {
  const [theme, setTheme] = useState<Theme>("system");

  // Sync with the value the inline script already committed. Running inside an
  // effect (not during render) keeps SSR output deterministic.
  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  // Re-apply when the user's OS preference changes and the stored mode is
  // "system" — matches the behaviour of `apps/web`.
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [theme]);

  const cycle = () => {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // non-fatal — persistence just won't carry across reloads
    }
    applyTheme(next);
    setTheme(next);
  };

  const label =
    theme === "light" ? "Switch to dark theme" : theme === "dark" ? "Use system theme" : "Switch to light theme";

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center border border-foreground/15 bg-background text-foreground",
        "hover:border-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-0",
        "transition-colors",
      )}
    >
      {theme === "light" ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : theme === "dark" ? (
        <Moon className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Monitor className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
