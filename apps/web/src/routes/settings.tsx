import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Layout route for the `/settings` section. It renders a header with the
 * page title and the active sub-panel via `<Outlet />`. The main app sidebar
 * swaps its content to a settings-specific nav whenever the pathname matches
 * this subtree (see `AppSidebar`), so this component intentionally does not
 * render a sidebar itself.
 */
export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings" || location.pathname === "/settings/") {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsLayout,
});

function SettingsLayout() {
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
        <Outlet />
      </div>
    </div>
  );
}
