import { useCallback, useSyncExternalStore } from "react";

/**
 * Tailwind-aligned breakpoint map so callers can write `useMediaQuery("lg")`
 * instead of memorising pixel values. Keep this in sync with the handful of
 * custom breakpoints we rely on in CSS.
 */
const BREAKPOINTS = {
  "2xl": 1536,
  "3xl": 1600,
  lg: 1024,
  md: 768,
  sm: 640,
  xl: 1280,
} as const;

type Breakpoint = keyof typeof BREAKPOINTS;

type BreakpointQuery = Breakpoint | `max-${Breakpoint}` | `${Breakpoint}:max-${Breakpoint}`;

export type MediaQueryInput = {
  min?: Breakpoint | number;
  max?: Breakpoint | number;
};

function resolveMin(value: Breakpoint | number): string {
  const px = typeof value === "number" ? value : BREAKPOINTS[value];
  return `(min-width: ${px}px)`;
}

function resolveMax(value: Breakpoint | number): string {
  const px = typeof value === "number" ? value : BREAKPOINTS[value];
  return `(max-width: ${px - 1}px)`;
}

function parseQuery(query: BreakpointQuery | MediaQueryInput | (string & {})): string {
  if (typeof query !== "string") {
    const parts: Array<string> = [];
    if (query.min != null) parts.push(resolveMin(query.min));
    if (query.max != null) parts.push(resolveMax(query.max));
    if (parts.length === 0) return "(min-width: 0px)";
    return parts.join(" and ");
  }

  // Pass-through for raw media queries such as `(max-width: 1180px)`.
  if (query.startsWith("(")) return query;

  const parts: Array<string> = [];
  for (const segment of query.split(":")) {
    if (segment.startsWith("max-")) {
      const bp = segment.slice(4);
      if (bp in BREAKPOINTS) parts.push(resolveMax(bp as Breakpoint));
    } else if (segment in BREAKPOINTS) {
      parts.push(resolveMin(segment as Breakpoint));
    }
  }

  return parts.length > 0 ? parts.join(" and ") : query;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Reactive `window.matchMedia` wrapper powered by `useSyncExternalStore` so it
 * is safe during SSR and concurrent rendering. Accepts either a short token
 * (e.g. `"lg"`, `"max-md"`), a `{ min, max }` object, or a raw media query
 * string which is returned verbatim.
 */
export function useMediaQuery(query: BreakpointQuery | MediaQueryInput | (string & {})): boolean {
  const mediaQuery = parseQuery(query);

  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(mediaQuery);
      mql.addEventListener("change", callback);
      return () => {
        mql.removeEventListener("change", callback);
      };
    },
    [mediaQuery],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(mediaQuery).matches;
  }, [mediaQuery]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
