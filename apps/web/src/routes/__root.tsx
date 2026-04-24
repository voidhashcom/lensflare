import { Outlet, createRootRoute, useLocation } from "@tanstack/react-router";

import { AppSidebar } from "~/components/AppSidebar";
import { DatasetTabsTitlebar } from "~/components/LogStream/DatasetTabsTitlebar";
import { RpcConnectionModal } from "~/components/RpcConnectionModal";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const isMacDesktop =
    typeof document !== "undefined" &&
    document.documentElement.dataset.runtime === "electron" &&
    document.documentElement.dataset.platform === "macos";
  const pathname = useLocation({ select: (location) => location.pathname });
  const isOnSettings = pathname.startsWith("/settings");

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
          <div
            className={cn(
              "desktop-drag flex h-[var(--desktop-titlebar-height)] shrink-0 items-stretch bg-background",
              !isOnSettings && "border-border/70 border-b",
            )}
          >
            <DatasetTabsTitlebar />
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
      </SidebarInset>
      <RpcConnectionModal />
    </SidebarProvider>
  );
}
