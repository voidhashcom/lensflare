/**
 * Detects whether the app is running inside the Electron shell on macOS, which
 * enables title-bar drag regions and traffic-light clearance in the sidebar.
 * Safe to call during SSR (returns false when `document` is unavailable).
 */
export function detectMacDesktop(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const runtime = document.documentElement.dataset.runtime;
  const platform = document.documentElement.dataset.platform;
  return runtime === "electron" && platform === "macos";
}
