import { Outlet, createRootRoute } from "@tanstack/react-router";

import { AppSidebar } from "~/components/AppSidebar";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "~/components/ui/sidebar";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const isMacDesktop =
    typeof document !== "undefined" &&
    document.documentElement.dataset.runtime === "electron" &&
    document.documentElement.dataset.platform === "macos";

  return (
    <SidebarProvider className="overflow-hidden bg-transparent" defaultOpen>
      <Sidebar
        className="border-r border-border/70 text-foreground"
        collapsible="offcanvas"
        side="left"
      >
        <AppSidebar />
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="overflow-hidden">
        {isMacDesktop ? (
          <div className="desktop-drag h-[var(--desktop-titlebar-height)] shrink-0 border-border/70 border-b bg-background" />
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
