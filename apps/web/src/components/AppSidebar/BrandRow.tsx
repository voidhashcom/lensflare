import { Logo } from "~/components/Logo";
import { cn } from "~/lib/utils";

/**
 * Sidebar brand row. On macOS desktop builds it reserves space for the
 * window traffic lights and becomes a drag region.
 */
export function BrandRow({ isMacDesktop }: { isMacDesktop: boolean }) {
  return (
    <div
      className={cn(
        "grid items-center",
        isMacDesktop
          ? "-ml-3 h-[var(--desktop-titlebar-height)] grid-cols-[var(--desktop-traffic-light-clearance)_minmax(0,1fr)] sm:-ml-4"
          : "grid-cols-[1fr]",
        !isMacDesktop && "min-h-8",
      )}
    >
      {isMacDesktop ? <div aria-hidden className="h-full" /> : null}
      <Logo
        aria-label="Lensflare"
        className="h-4.5 mt-1 w-auto max-w-[11.5rem] justify-self-center text-sidebar-foreground"
      />
    </div>
  );
}
