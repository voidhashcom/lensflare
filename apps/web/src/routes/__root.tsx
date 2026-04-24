import { Outlet, createRootRoute, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppSidebar } from "~/components/AppSidebar";
import { DatasetTabsTitlebar } from "~/components/LogStream/DatasetTabsTitlebar";
import { RpcConnectionModal } from "~/components/RpcConnectionModal";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import { syncBrowserChromeTheme, useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";

const APP_SIDEBAR_WIDTH_STORAGE_KEY = "app_sidebar_width";
const APP_SIDEBAR_MIN_WIDTH = 13 * 16;
const APP_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  useTheme();
  const isMacDesktop =
    typeof document !== "undefined" &&
    document.documentElement.dataset.runtime === "electron" &&
    document.documentElement.dataset.platform === "macos";
  const pathname = useLocation({ select: (location) => location.pathname });
  const isOnSettings = pathname.startsWith("/settings");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      syncBrowserChromeTheme();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return (
    <SidebarProvider className="overflow-hidden bg-transparent" defaultOpen>
      <Sidebar
        className="text-foreground"
        collapsible="offcanvas"
        resizable={{
          minWidth: APP_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ nextWidth, wrapper }) =>
            wrapper.clientWidth - nextWidth >= APP_MAIN_CONTENT_MIN_WIDTH,
          storageKey: APP_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
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
