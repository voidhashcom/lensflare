import { Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { DesktopUpdateSettingsPanel } from "~/components/settings/DesktopUpdateSettingsPanel";

/**
 * Layout route for the `/settings` section. It renders a header with the
 * page title and the active sub-panel via `<Outlet />`. The main app sidebar
 * swaps its content to a settings-specific nav whenever the pathname matches
 * this subtree (see `AppSidebar`), so this component intentionally does not
 * render a sidebar itself.
 */
export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        window.history.back();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      <header className="border-border border-b px-3 py-2 sm:px-5">
        <div className="flex min-h-7 items-center gap-2 sm:min-h-6">
          <span className="font-medium text-foreground text-sm">Settings</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {pathname === "/settings" || pathname === "/settings/" ? (
          <DesktopUpdateSettingsPanel />
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  );
}
