import { useCallback, useEffect, useSyncExternalStore } from "react";
import { captureWebEvent } from "~/analytics";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeSnapshot {
  readonly theme: Theme;
  readonly systemDark: boolean;
}

const STORAGE_KEY = "lensflare:theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";
const DEFAULT_THEME: Theme = "system";
const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  theme: DEFAULT_THEME,
  systemDark: false,
};
const DYNAMIC_THEME_COLOR_SELECTOR = 'meta[name="theme-color"][data-dynamic-theme-color="true"]';

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let lastDesktopTheme: Theme | null = null;

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function hasThemeStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function getSystemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MEDIA_QUERY).matches;
}

function readStoredTheme(): Theme {
  if (!hasThemeStorage()) {
    return DEFAULT_THEME;
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") {
    return raw;
  }
  return DEFAULT_THEME;
}

function ensureThemeColorMetaTag(): HTMLMetaElement {
  let element = document.querySelector<HTMLMetaElement>(DYNAMIC_THEME_COLOR_SELECTOR);
  if (element) {
    return element;
  }

  element = document.createElement("meta");
  element.name = "theme-color";
  element.setAttribute("data-dynamic-theme-color", "true");
  document.head.append(element);
  return element;
}

function normalizeThemeColor(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)" ||
    normalized === "rgba(0 0 0 / 0)"
  ) {
    return null;
  }

  return value?.trim() ?? null;
}

function resolveBrowserChromeSurface(): HTMLElement {
  return (
    document.querySelector<HTMLElement>("main[data-slot='sidebar-inset']") ??
    document.querySelector<HTMLElement>("[data-slot='sidebar-inner']") ??
    document.body
  );
}

export function syncBrowserChromeTheme(): void {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return;
  }

  const surfaceColor = normalizeThemeColor(
    getComputedStyle(resolveBrowserChromeSurface()).backgroundColor,
  );
  const fallbackColor = normalizeThemeColor(getComputedStyle(document.body).backgroundColor);
  const backgroundColor = surfaceColor ?? fallbackColor;
  if (!backgroundColor) {
    return;
  }

  if (document.documentElement.dataset.runtime === "electron") {
    document.documentElement.style.backgroundColor = "transparent";
  } else {
    document.documentElement.style.backgroundColor = backgroundColor;
  }
  ensureThemeColorMetaTag().setAttribute("content", backgroundColor);
}

function syncDesktopTheme(theme: Theme): void {
  if (typeof window === "undefined") {
    return;
  }

  const bridge = window.desktopBridge ?? window.lensflareDesktop;
  if (!bridge || lastDesktopTheme === theme) {
    return;
  }

  lastDesktopTheme = theme;
  void bridge.setTheme(theme).catch(() => {
    if (lastDesktopTheme === theme) {
      lastDesktopTheme = null;
    }
  });
}

function applyTheme(theme: Theme, suppressTransitions = false): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }

  const isDark = theme === "dark" || (theme === "system" && getSystemDark());
  document.documentElement.classList.toggle("dark", isDark);
  syncBrowserChromeTheme();
  syncDesktopTheme(theme);

  if (suppressTransitions) {
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

if (typeof document !== "undefined" && hasThemeStorage()) {
  applyTheme(readStoredTheme());
}

function getSnapshot(): ThemeSnapshot {
  if (!hasThemeStorage()) {
    return DEFAULT_THEME_SNAPSHOT;
  }

  const theme = readStoredTheme();
  const systemDark = theme === "system" ? getSystemDark() : false;
  if (lastSnapshot && lastSnapshot.theme === theme && lastSnapshot.systemDark === systemDark) {
    return lastSnapshot;
  }

  lastSnapshot = { theme, systemDark };
  return lastSnapshot;
}

function getServerSnapshot(): ThemeSnapshot {
  return DEFAULT_THEME_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  listeners.push(listener);

  const mediaQuery = window.matchMedia(MEDIA_QUERY);
  const handleMediaChange = () => {
    if (readStoredTheme() === "system") {
      applyTheme("system", true);
    }
    emitChange();
  };
  mediaQuery.addEventListener("change", handleMediaChange);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      applyTheme(readStoredTheme(), true);
      emitChange();
    }
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners = listeners.filter((existing) => existing !== listener);
    mediaQuery.removeEventListener("change", handleMediaChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const theme = snapshot.theme;
  const resolvedTheme: ResolvedTheme =
    theme === "system" ? (snapshot.systemDark ? "dark" : "light") : theme;

  const setTheme = useCallback((next: Theme) => {
    if (!hasThemeStorage()) {
      return;
    }

    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next, true);
    captureWebEvent("theme_changed", {
      surface: document.documentElement.dataset.runtime === "electron" ? "desktop" : "web",
      theme: next,
    });
    emitChange();
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { resolvedTheme, setTheme, theme } as const;
}
